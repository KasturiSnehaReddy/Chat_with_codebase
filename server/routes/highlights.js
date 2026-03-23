import express from "express";
import { Highlight } from "../models/Highlight.js";

const router = express.Router();

// Small in-memory fallback so UI still works without Mongo configured.
const memoryHighlights = [
  {
    _id: "mem-1",
    title: "Adaptive Dashboard",
    description: "Real-time widgets with role-aware visibility and optimistic UI updates.",
    tag: "Frontend",
    createdAt: new Date().toISOString(),
  },
  {
    _id: "mem-2",
    title: "Search Intelligence",
    description: "Semantic + reranked retrieval pipeline with cache-aware indexing.",
    tag: "RAG",
    createdAt: new Date().toISOString(),
  },
];

const useMemoryStore = !process.env.MONGO_URI;

router.get("/", async (_req, res) => {
  try {
    if (useMemoryStore) {
      return res.json(memoryHighlights);
    }

    const highlights = await Highlight.find().sort({ createdAt: -1 }).lean();
    return res.json(highlights);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch highlights.", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { title, description, tag } = req.body;

    if (!title || !description || !tag) {
      return res.status(400).json({ message: "title, description, and tag are required." });
    }

    if (useMemoryStore) {
      const item = {
        _id: `mem-${Date.now()}`,
        title,
        description,
        tag,
        createdAt: new Date().toISOString(),
      };
      memoryHighlights.unshift(item);
      return res.status(201).json(item);
    }

    const item = await Highlight.create({ title, description, tag });
    return res.status(201).json(item);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create highlight.", error: error.message });
  }
});

export default router;
