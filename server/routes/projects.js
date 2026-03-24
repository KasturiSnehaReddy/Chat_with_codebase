import express from "express";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import { fileURLToPath } from "url";
import { Project } from "../models/Project.js";
import { Message } from "../models/Message.js";
import { authMiddleware } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const isMemoryStore = () => !process.env.MONGO_URI;
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://127.0.0.1:8001";

// In-memory fallback stores
const memoryProjects = [];
const memoryMessages = {};

const upload = multer({ storage: multer.memoryStorage() });
const uploadsRoot = path.resolve(__dirname, "..", "uploads");
const RAG_TOP_K = 4;

function safeRelativePath(p) {
  const normalized = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

async function callRagServiceUpload(chatId, folderPath) {
  const response = await fetch(`${RAG_SERVICE_URL}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, folder_path: folderPath }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || "RAG upload failed");
  }
  return payload;
}

async function callRagServiceAsk(chatId, query, topK = RAG_TOP_K) {
  const response = await fetch(`${RAG_SERVICE_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, query, top_k: topK }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || "RAG ask failed");
  }
  return payload;
}

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name, description, fingerprint, indexPath } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });

    if (isMemoryStore()) {
      const proj = {
        _id: `mem-${Date.now()}`,
        name,
        description,
        fingerprint,
        indexPath,
        ownerId: req.user._id,
        createdAt: new Date().toISOString(),
      };
      memoryProjects.unshift(proj);
      memoryMessages[proj._id] = [];
      return res.status(201).json(proj);
    }

    const proj = await Project.create({
      name,
      description,
      fingerprint,
      indexPath,
      ownerId: req.user._id,
    });
    return res.status(201).json(proj);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create project", error: error.message });
  }
});

// Upload folder files and trigger one-time indexing for this chat
router.post("/upload", authMiddleware, upload.array("files"), async (req, res) => {
  try {
    const projectName = String(req.body.projectName || "").trim();
    const files = req.files || [];
    const relativePathsRaw = req.body.relativePaths;

    if (!projectName) {
      return res.status(400).json({ message: "projectName is required" });
    }
    if (!files.length) {
      return res.status(400).json({ message: "At least one file is required" });
    }

    const relativePaths = Array.isArray(relativePathsRaw)
      ? relativePathsRaw
      : relativePathsRaw
        ? [relativePathsRaw]
        : [];

    const projectSlug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projectDir = path.join(uploadsRoot, projectSlug);
    await fs.mkdir(projectDir, { recursive: true });

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const rel = safeRelativePath(relativePaths[i] || file.originalname || `file-${i}`);
      if (!rel) continue;

      const targetPath = path.join(projectDir, rel);
      if (!targetPath.startsWith(projectDir)) continue;

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, file.buffer);
    }

    if (isMemoryStore()) {
      const proj = {
        _id: `mem-${Date.now()}`,
        name: projectName,
        description: "Uploaded from UI",
        indexPath: projectDir,
        status: "processing",
        chunkCount: 0,
        cacheHitOnPrepare: false,
        ownerId: req.user._id,
        createdAt: new Date().toISOString(),
      };
      memoryProjects.unshift(proj);
      memoryMessages[proj._id] = [];

      // One-time preprocessing for this chat/project.
      try {
        const rag = await callRagServiceUpload(proj._id, projectDir);
        proj.status = "ready";
        proj.chunkCount = Number(rag.chunk_count || 0);
        proj.cacheHitOnPrepare = !!rag.cache_hit;
      } catch (error) {
        proj.status = "failed";
        return res.status(500).json({
          ...proj,
          fileCount: files.length,
          message: "Upload succeeded but RAG preparation failed",
          error: error.message,
        });
      }

      return res.status(201).json({ ...proj, fileCount: files.length });
    }

    const proj = await Project.create({
      name: projectName,
      description: "Uploaded from UI",
      indexPath: projectDir,
      status: "processing",
      ownerId: req.user._id,
    });

    try {
      const rag = await callRagServiceUpload(String(proj._id), projectDir);
      proj.status = "ready";
      proj.chunkCount = Number(rag.chunk_count || 0);
      proj.cacheHitOnPrepare = !!rag.cache_hit;
      await proj.save();
    } catch (error) {
      proj.status = "failed";
      await proj.save();
      return res.status(500).json({
        ...proj.toObject(),
        fileCount: files.length,
        message: "Upload succeeded but RAG preparation failed",
        error: error.message,
      });
    }

    return res.status(201).json({ ...proj.toObject(), fileCount: files.length });
  } catch (error) {
    return res.status(500).json({ message: "Upload failed", error: error.message });
  }
});

router.get("/", authMiddleware, async (_req, res) => {
  try {
    if (isMemoryStore()) {
      const userProjects = memoryProjects.filter((p) => p.ownerId === _req.user._id);
      return res.json(userProjects);
    }
    const projects = await Project.find({ ownerId: _req.user._id }).sort({ createdAt: -1 }).lean();
    return res.json(projects);
  } catch (error) {
    return res.status(500).json({ message: "Failed to list projects", error: error.message });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (isMemoryStore()) {
      const proj = memoryProjects.find((p) => p._id === id && p.ownerId === req.user._id);
      if (!proj) return res.status(404).json({ message: "project not found" });
      return res.json(proj);
    }

    const proj = await Project.findOne({ _id: id, ownerId: req.user._id }).lean();
    if (!proj) return res.status(404).json({ message: "project not found" });
    return res.json(proj);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch project", error: error.message });
  }
});

router.get("/:id/status", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (isMemoryStore()) {
      const proj = memoryProjects.find((p) => p._id === id && p.ownerId === req.user._id);
      if (!proj) return res.status(404).json({ message: "project not found" });
      return res.json({
        status: proj.status || "ready",
        chunkCount: proj.chunkCount || 0,
        cacheHitOnPrepare: !!proj.cacheHitOnPrepare,
      });
    }

    const proj = await Project.findOne({ _id: id, ownerId: req.user._id }).lean();
    if (!proj) return res.status(404).json({ message: "project not found" });
    return res.json({
      status: proj.status || "ready",
      chunkCount: proj.chunkCount || 0,
      cacheHitOnPrepare: !!proj.cacheHitOnPrepare,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch status", error: error.message });
  }
});

router.post("/:id/messages", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, text, sources, modelMeta, fallback } = req.body;
    if (!role || !text) return res.status(400).json({ message: "role and text are required" });

    if (isMemoryStore()) {
      const proj = memoryProjects.find((p) => p._id === id && p.ownerId === req.user._id);
      if (!proj) return res.status(404).json({ message: "project not found" });
      if (!memoryMessages[id]) memoryMessages[id] = [];

      const msg = {
        _id: `memmsg-${Date.now()}`,
        projectId: id,
        role,
        text,
        sources: sources || [],
        modelMeta: modelMeta || {},
        fallback: !!fallback,
        createdAt: new Date().toISOString(),
      };
      memoryMessages[id].push(msg);
      return res.status(201).json(msg);
    }

    const proj = await Project.findOne({ _id: id, ownerId: req.user._id }).lean();
    if (!proj) return res.status(404).json({ message: "project not found" });

    const message = await Message.create({
      projectId: id,
      role,
      text,
      sources: sources || [],
      modelMeta: modelMeta || {},
      fallback: !!fallback,
    });
    return res.status(201).json(message);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create message", error: error.message });
  }
});

// Fast query-time path: query embedding + retrieval + rerank + LLM only
router.post("/:id/ask", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { query } = req.body;
    if (!query) return res.status(400).json({ message: "query is required" });

    if (isMemoryStore()) {
      const proj = memoryProjects.find((p) => p._id === id && p.ownerId === req.user._id);
      if (!proj) return res.status(404).json({ message: "project not found" });
      if (proj.status !== "ready") {
        return res.status(409).json({ message: "Project is still processing. Please wait." });
      }
      if (!memoryMessages[id]) memoryMessages[id] = [];
      memoryMessages[id].push({
        _id: `memmsg-${Date.now()}-u`,
        projectId: id,
        role: "user",
        text: query,
        createdAt: new Date().toISOString(),
      });

      const rag = await callRagServiceAsk(id, query, RAG_TOP_K);
      const msg = {
        _id: `memmsg-${Date.now()}-a`,
        projectId: id,
        role: "assistant",
        text: rag.answer || "",
        sources: rag.sources || [],
        createdAt: new Date().toISOString(),
      };
      memoryMessages[id].push(msg);
      return res.json({ answer: msg.text, sources: msg.sources, saved: msg });
    }

    const proj = await Project.findOne({ _id: id, ownerId: req.user._id }).lean();
    if (!proj) return res.status(404).json({ message: "project not found" });
    if (proj.status !== "ready") {
      return res.status(409).json({ message: "Project is still processing. Please wait." });
    }

    await Message.create({ projectId: id, role: "user", text: query });

    const rag = await callRagServiceAsk(id, query, RAG_TOP_K);
    const saved = await Message.create({
      projectId: id,
      role: "assistant",
      text: rag.answer || "",
      sources: rag.sources || [],
    });

    return res.json({ answer: saved.text, sources: saved.sources, saved });
  } catch (error) {
    return res.status(500).json({ message: "Failed to run query", error: error.message });
  }
});

router.get("/:id/messages", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, parseInt(req.query.limit || "50", 10));
    const skip = (page - 1) * limit;

    if (isMemoryStore()) {
      const proj = memoryProjects.find((p) => p._id === id && p.ownerId === req.user._id);
      if (!proj) return res.status(404).json({ message: "project not found" });

      const msgs = memoryMessages[id] || [];
      const pageItems = msgs.slice(-1 * (page * limit)).slice(0, limit);
      return res.json({ items: pageItems, page, limit, total: msgs.length });
    }

    const proj = await Project.findOne({ _id: id, ownerId: req.user._id }).lean();
    if (!proj) return res.status(404).json({ message: "project not found" });

    const total = await Message.countDocuments({ projectId: id });
    const items = await Message.find({ projectId: id })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({ items, page, limit, total });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list messages", error: error.message });
  }
});

export default router;
