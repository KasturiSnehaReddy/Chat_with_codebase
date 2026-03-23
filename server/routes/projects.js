import express from "express";
import { Project } from "../models/Project.js";
import { Message } from "../models/Message.js";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const useMemoryStore = !process.env.MONGO_URI;

// In-memory stores for fallback
const memoryProjects = [];
const memoryMessages = {}; // projectId -> [messages]
const upload = multer({ storage: multer.memoryStorage() });
const uploadsRoot = path.resolve(__dirname, "..", "uploads");

function safeRelativePath(p) {
  const normalized = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;

  // Some Python libraries print logs before JSON. Parse the last non-empty line.
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;

  return JSON.parse(lines[lines.length - 1]);
}

function runRagCli(cliPath, folder, query) {
  const runners = [
    { cmd: "python", args: [cliPath, folder, query] },
    { cmd: "py", args: ["-3", cliPath, folder, query] },
  ];

  return new Promise((resolve, reject) => {
    const tryRunner = (idx) => {
      if (idx >= runners.length) {
        reject(new Error("No Python runner worked. Ensure python/py is installed and on PATH."));
        return;
      }

      const { cmd, args } = runners[idx];
      execFile(cmd, args, { timeout: 2 * 60 * 1000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          tryRunner(idx + 1);
          return;
        }
        resolve({ stdout, stderr });
      });
    };

    tryRunner(0);
  });
}

function runPythonScript(scriptPath, args) {
  const runners = [
    { cmd: "python", args: [scriptPath, ...args] },
    { cmd: "py", args: ["-3", scriptPath, ...args] },
  ];

  return new Promise((resolve, reject) => {
    const tryRunner = (idx) => {
      if (idx >= runners.length) {
        reject(new Error("No Python runner worked. Ensure python/py is installed and on PATH."));
        return;
      }

      const { cmd, args: fullArgs } = runners[idx];
      execFile(cmd, fullArgs, { timeout: 10 * 60 * 1000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          tryRunner(idx + 1);
          return;
        }
        resolve({ stdout, stderr });
      });
    };

    tryRunner(0);
  });
}

// Create project
router.post("/", async (req, res) => {
  try {
    const { name, description, fingerprint, indexPath } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });

    if (useMemoryStore) {
      const proj = { _id: `mem-${Date.now()}`, name, description, fingerprint, indexPath, createdAt: new Date().toISOString() };
      memoryProjects.unshift(proj);
      memoryMessages[proj._id] = [];
      return res.status(201).json(proj);
    }

    const proj = await Project.create({ name, description, fingerprint, indexPath });
    return res.status(201).json(proj);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create project", error: error.message });
  }
});

// Upload project files from browser folder input and create a project
router.post("/upload", upload.array("files"), async (req, res) => {
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

    // Prepare chunks/index immediately so future asks are fast (cache already built).
    const prepareScript = path.resolve(__dirname, "..", "..", "rag_prepare.py");
    let prepareResult = { cacheHit: false, chunkCount: 0 };
    try {
      const { stdout } = await runPythonScript(prepareScript, [projectDir]);
      const parsed = parseJsonFromStdout(stdout) || {};
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      prepareResult = {
        cacheHit: !!parsed.cacheHit,
        chunkCount: Number(parsed.chunkCount || 0),
      };
    } catch (error) {
      return res.status(500).json({
        message: "Upload succeeded but RAG preparation failed",
        error: error.message,
      });
    }

    if (useMemoryStore) {
      const proj = {
        _id: `mem-${Date.now()}`,
        name: projectName,
        description: "Uploaded from UI",
        indexPath: projectDir,
        status: "ready",
        chunkCount: prepareResult.chunkCount,
        cacheHitOnPrepare: prepareResult.cacheHit,
        createdAt: new Date().toISOString(),
      };
      memoryProjects.unshift(proj);
      memoryMessages[proj._id] = [];
      return res.status(201).json({ ...proj, fileCount: files.length });
    }

    const proj = await Project.create({
      name: projectName,
      description: "Uploaded from UI",
      indexPath: projectDir,
      status: "ready",
      chunkCount: prepareResult.chunkCount,
      cacheHitOnPrepare: prepareResult.cacheHit,
    });

    return res.status(201).json({ ...proj.toObject(), fileCount: files.length });
  } catch (error) {
    return res.status(500).json({ message: "Upload failed", error: error.message });
  }
});

// List projects
router.get("/", async (_req, res) => {
  try {
    if (useMemoryStore) return res.json(memoryProjects);
    const projects = await Project.find().sort({ createdAt: -1 }).lean();
    return res.json(projects);
  } catch (error) {
    return res.status(500).json({ message: "Failed to list projects", error: error.message });
  }
});

// Get project
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (useMemoryStore) {
      const proj = memoryProjects.find((p) => p._id === id);
      if (!proj) return res.status(404).json({ message: "project not found" });
      return res.json(proj);
    }
    const proj = await Project.findById(id).lean();
    if (!proj) return res.status(404).json({ message: "project not found" });
    return res.json(proj);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch project", error: error.message });
  }
});

// Get project status
router.get("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    if (useMemoryStore) {
      const proj = memoryProjects.find((p) => p._id === id);
      if (!proj) return res.status(404).json({ message: "project not found" });
      return res.json({
        status: proj.status || "ready",
        chunkCount: proj.chunkCount || 0,
        cacheHitOnPrepare: !!proj.cacheHitOnPrepare,
      });
    }

    const proj = await Project.findById(id).lean();
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

// Create message under project
router.post("/:id/messages", async (req, res) => {
  try {
    const { id } = req.params;
    const { role, text, sources, modelMeta, fallback } = req.body;
    if (!role || !text) return res.status(400).json({ message: "role and text are required" });

    if (useMemoryStore) {
      if (!memoryMessages[id]) return res.status(404).json({ message: "project not found" });
      const msg = { _id: `memmsg-${Date.now()}`, projectId: id, role, text, sources: sources || [], modelMeta: modelMeta || {}, fallback: !!fallback, createdAt: new Date().toISOString() };
      memoryMessages[id].push(msg);
      return res.status(201).json(msg);
    }

    const message = await Message.create({ projectId: id, role, text, sources: sources || [], modelMeta: modelMeta || {}, fallback: !!fallback });
    return res.status(201).json(message);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create message", error: error.message });
  }
});

// Ask a query against a project's folder/index and persist assistant reply
router.post("/:id/ask", async (req, res) => {
  try {
    const { id } = req.params;
    const { query, folderPath } = req.body;
    if (!query) return res.status(400).json({ message: "query is required" });

    // resolve folder to use: project's indexPath or provided folderPath
    let folder = folderPath;
    if (!folder) {
      if (useMemoryStore) {
        const proj = memoryProjects.find((p) => p._id === id);
        if (!proj) return res.status(404).json({ message: "project not found" });
        folder = proj.indexPath;
      } else {
        const proj = await Project.findById(id).lean();
        if (!proj) return res.status(404).json({ message: "project not found" });
        folder = proj.indexPath;
      }
    }

    if (!folder) return res.status(400).json({ message: "No folderPath available for project" });

    if (useMemoryStore) {
      const memProj = memoryProjects.find((p) => p._id === id);
      if (memProj?.status && memProj.status !== "ready") {
        return res.status(409).json({ message: "Project is still processing. Please wait." });
      }
    } else {
      const proj = await Project.findById(id).lean();
      if (!proj) return res.status(404).json({ message: "project not found" });
      if (proj.status && proj.status !== "ready") {
        return res.status(409).json({ message: "Project is still processing. Please wait." });
      }
    }

    // Persist user question first
    if (useMemoryStore) {
      if (!memoryMessages[id]) return res.status(404).json({ message: "project not found" });
      memoryMessages[id].push({
        _id: `memmsg-${Date.now()}-u`,
        projectId: id,
        role: "user",
        text: query,
        createdAt: new Date().toISOString(),
      });
    } else {
      await Message.create({ projectId: id, role: "user", text: query });
    }

    // Call the Python RAG CLI from repo root
    const cli = path.resolve(__dirname, "..", "..", "rag_query.py");
    const { stdout, stderr } = await runRagCli(cli, folder, query);

    let parsed;
    try {
      parsed = parseJsonFromStdout(stdout);
    } catch {
      return res.status(500).json({ message: "Invalid JSON from RAG process", raw: stdout, stderr });
    }

    if (!parsed) {
      return res.status(500).json({ message: "Empty response from RAG process", stderr });
    }

    if (parsed.error) {
      return res.status(500).json({ message: parsed.error, stderr });
    }

    // Save assistant message
    const assistantText = parsed.answer || "";
    if (useMemoryStore) {
      const msg = {
        _id: `memmsg-${Date.now()}-a`,
        projectId: id,
        role: "assistant",
        text: assistantText,
        sources: parsed.sources || [],
        createdAt: new Date().toISOString(),
      };
      memoryMessages[id].push(msg);
      return res.json({ answer: assistantText, sources: parsed.sources || [], saved: msg });
    }

    const saved = await Message.create({
      projectId: id,
      role: "assistant",
      text: assistantText,
      sources: parsed.sources || [],
    });
    return res.json({ answer: assistantText, sources: parsed.sources || [], saved });
  } catch (error) {
    return res.status(500).json({ message: "Failed to run query", error: error.message });
  }
});

// List messages for a project (paginated)
router.get("/:id/messages", async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, parseInt(req.query.limit || "50", 10));
    const skip = (page - 1) * limit;

    if (useMemoryStore) {
      const msgs = memoryMessages[id] || [];
      const pageItems = msgs.slice(-1 * (page * limit)).slice(0, limit); // simple last-N semantics
      return res.json({ items: pageItems, page, limit, total: msgs.length });
    }

    const total = await Message.countDocuments({ projectId: id });
    const items = await Message.find({ projectId: id }).sort({ createdAt: 1 }).skip(skip).limit(limit).lean();
    return res.json({ items, page, limit, total });
  } catch (error) {
    return res.status(500).json({ message: "Failed to list messages", error: error.message });
  }
});

export default router;
