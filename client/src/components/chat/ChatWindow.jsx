import MessageList from "./MessageList";
import InputBox from "./InputBox";

export default function ChatWindow({ currentChat, messages, onSend, isLoading, isInputDisabled, error }) {
  if (!currentChat) {
    return (
      <main className="flex h-full flex-1 items-center justify-center p-6">
        <div className="max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 text-center">
          <h2 className="text-2xl font-semibold text-zinc-100">Upload a project to start</h2>
          <p className="mt-3 text-sm text-zinc-400">
            Each chat is linked to one uploaded codebase and Q&A stays independent.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-1 flex-col">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-lg font-semibold text-zinc-100">{currentChat.name}</h1>
        <p className="mt-1 text-xs text-zinc-400">{currentChat.fileCount} files uploaded</p>
        {currentChat.status === "processing" ? (
          <p className="mt-1 text-xs text-amber-300">Processing codebase... preparing chunks and embeddings</p>
        ) : null}
      </header>

      <MessageList messages={messages} isLoading={isLoading} />

      <div className="border-t border-zinc-800 p-4">
        <InputBox onSend={onSend} disabled={isInputDisabled} loading={isLoading} />
        {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      </div>
    </main>
  );
}
