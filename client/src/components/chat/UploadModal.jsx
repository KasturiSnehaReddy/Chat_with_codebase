import { useEffect, useMemo, useRef, useState } from "react";

export default function UploadModal({ open, onClose, onSubmit, isUploading }) {
  const [projectName, setProjectName] = useState("");
  const [files, setFiles] = useState([]);
  const folderInputRef = useRef(null);

  const fileCount = files.length;
  const fileNames = useMemo(() => files.slice(0, 3).map((file) => file.name), [files]);

  useEffect(() => {
    if (!open || !folderInputRef.current) return;
    // Ensure non-standard directory attributes are present in all browsers that support them.
    folderInputRef.current.setAttribute("webkitdirectory", "");
    folderInputRef.current.setAttribute("directory", "");
  }, [open]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (!projectName.trim() || !files.length || isUploading) return;
    await onSubmit({
      projectName: projectName.trim(),
      files,
    });
    setProjectName("");
    setFiles([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-zinc-100">New Chat</h2>
        <p className="mt-1 text-sm text-zinc-400">Upload a codebase folder and set project name.</p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm text-zinc-300">
            Project Name
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Payments Service"
              className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400"
              required
            />
          </label>

          <label className="block text-sm text-zinc-300">
            Upload Folder
            <input
              ref={folderInputRef}
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                setFiles(picked);
              }}
              className="mt-1 block w-full cursor-pointer rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300"
              required
            />
          </label>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
            <p>Files selected: {fileCount}</p>
            {fileNames.length ? <p className="mt-1">Sample: {fileNames.join(", ")}</p> : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading || !projectName.trim() || !files.length}
              className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            >
              {isUploading ? "Processing..." : "Create Chat"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
