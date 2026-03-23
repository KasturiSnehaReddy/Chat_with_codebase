import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    fingerprint: { type: String },
    // metadata about where embeddings/index are stored (optional)
    indexPath: { type: String },
    status: {
      type: String,
      enum: ["processing", "ready", "failed"],
      default: "processing",
    },
    chunkCount: { type: Number, default: 0 },
    cacheHitOnPrepare: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Project = mongoose.model("Project", projectSchema);
