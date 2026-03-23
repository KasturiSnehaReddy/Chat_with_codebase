import mongoose from "mongoose";

const highlightSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 90,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    tag: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },
  },
  { timestamps: true }
);

export const Highlight = mongoose.model("Highlight", highlightSchema);
