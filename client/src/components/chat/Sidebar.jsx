function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Sidebar({
  chats,
  currentChatId,
  onSelectChat,
  onDeleteChat,
  onNewChat,
  user,
  logout,
}) {
  return (
    <aside className="flex h-full w-80 flex-col border-r border-zinc-800 bg-zinc-900/70 p-4">
      <button
        type="button"
        onClick={onNewChat}
        className="mb-4 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-left text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700"
      >
        + New Chat
      </button>

      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Your codebases</div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group rounded-xl border p-3 transition ${
              currentChatId === chat.id
                ? "border-emerald-500/50 bg-zinc-800"
                : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800/70"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelectChat(chat.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-semibold text-zinc-100">{chat.name}</p>
                <p className="mt-1 text-xs text-zinc-400">{formatDate(chat.createdAt)}</p>
                <p className="mt-1 text-xs text-zinc-500">{chat.fileCount} files</p>
                {chat.status === "processing" ? (
                  <p className="mt-1 text-xs text-amber-300">Processing...</p>
                ) : null}
                {chat.status === "ready" && typeof chat.chunkCount === "number" ? (
                  <p className="mt-1 text-xs text-emerald-300">Ready • {chat.chunkCount} chunks</p>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => onDeleteChat(chat.id)}
                className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-700 hover:text-red-300"
                aria-label={`Delete ${chat.name}`}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {!chats.length ? (
          <div className="rounded-xl border border-dashed border-zinc-700 p-4 text-sm text-zinc-400">
            No chats yet. Create one with + New Chat.
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <p className="truncate text-sm font-medium text-zinc-200">{user?.name || user?.email || "User"}</p>
        <button
          type="button"
          onClick={logout}
          className="mt-2 w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
