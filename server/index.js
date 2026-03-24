import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import highlightsRouter from "./routes/highlights.js";
import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer server/.env. If missing, fallback to server/.env.example.
dotenv.config({ path: path.join(__dirname, ".env") });
if (!process.env.MONGO_URI) {
  dotenv.config({ path: path.join(__dirname, ".env.example") });
}

const app = express();
const port = process.env.PORT || 5001;

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", mode: process.env.MONGO_URI ? "mongo" : "memory" });
});

app.use("/api/auth", authRouter);
app.use("/api/highlights", highlightsRouter);
app.use("/api/projects", projectsRouter);

const startServer = async () => {
  if (process.env.MONGO_URI) {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("Connected to MongoDB.");
    } catch (error) {
      console.error("Mongo connection failed, continuing with memory mode:", error.message);
    }
  } else {
    console.log("MONGO_URI missing. Using in-memory fallback.");
  }

  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
};

startServer();
