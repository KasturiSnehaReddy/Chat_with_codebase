import { useState } from "react";

export default function InputBox({ onSend, disabled, loading }) {
  const [query, setQuery] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const text = query.trim();
    if (!text || disabled || loading) return;
    setQuery("");
    await onSend(text);
  };

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-4xl items-end gap-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-3">
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled || loading}
        placeholder={disabled ? "Upload/select a project first" : "Ask anything about this codebase..."}
        rows={2}
        className="max-h-36 min-h-[44px] flex-1 resize-none bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
      />

      <button
        type="submit"
        disabled={disabled || loading || !query.trim()}
        className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        {loading ? "Sending..." : "Send"}
      </button>
    </form>
  );
}
