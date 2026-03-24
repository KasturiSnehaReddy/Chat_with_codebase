import express from "express";
import crypto from "crypto";
import { User } from "../models/User.js";

const router = express.Router();
const isMemoryStore = () => !process.env.MONGO_URI;

const memoryUsers = [];

// Auth middleware: extract userId from X-User-Id header and attach to req.user
export const authMiddleware = (req, res, next) => {
  const userId = req.headers["x-user-id"];
  if (!userId) {
    return res.status(401).json({ message: "Authentication required. Send X-User-Id header." });
  }
  req.user = { _id: userId };
  next();
};

const hashPassword = (password) =>
  crypto.createHash("sha256").update(password).digest("hex");

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email, and password are required." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const passwordHash = hashPassword(password);

    if (isMemoryStore()) {
      const exists = memoryUsers.some((item) => item.email === normalizedEmail);
      if (exists) {
        return res.status(409).json({ message: "User already exists." });
      }

      const created = {
        _id: `mem-user-${Date.now()}`,
        name: String(name).trim(),
        email: normalizedEmail,
        passwordHash,
      };
      memoryUsers.push(created);

      return res.status(201).json({
        user: { _id: created._id, name: created.name, email: created.email },
      });
    }

    const exists = await User.findOne({ email: normalizedEmail }).lean();
    if (exists) {
      return res.status(409).json({ message: "User already exists." });
    }

    const created = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
    });

    return res.status(201).json({
      user: { _id: created._id, name: created.name, email: created.email },
    });
  } catch (error) {
    return res.status(500).json({ message: "Signup failed.", error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required." });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const passwordHash = hashPassword(password);

    if (isMemoryStore()) {
      const found = memoryUsers.find((item) => item.email === normalizedEmail);
      if (!found || found.passwordHash !== passwordHash) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      return res.json({ user: { _id: found._id, name: found.name, email: found.email } });
    }

    const found = await User.findOne({ email: normalizedEmail }).lean();
    if (!found || found.passwordHash !== passwordHash) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    return res.json({ user: { _id: found._id, name: found.name, email: found.email } });
  } catch (error) {
    return res.status(500).json({ message: "Login failed.", error: error.message });
  }
});

export default router;
