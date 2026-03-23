import mongoose from "mongoose";

const sourceSchema = new mongoose.Schema(
  {
    chunkId: { type: String },
    filePath: { type: String },
    startLine: { type: Number },
    endLine: { type: Number },
    score: { type: Number },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: { type: String, required: true },
    sources: { type: [sourceSchema], default: [] },
    modelMeta: { type: Object, default: {} },
    fallback: { type: Boolean, default: false },
    feedback: { type: Object, default: null },
  },
  { timestamps: true }
);

export const Message = mongoose.model("Message", messageSchema);
