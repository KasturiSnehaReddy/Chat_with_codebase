import { useEffect, useRef } from "react";

export default function MessageList({ messages, isLoading }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  return (
    <section className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {!messages.length ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
            Ask your first question about this codebase.
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-emerald-500/90 text-zinc-900"
                  : "border border-zinc-800 bg-zinc-900 text-zinc-100"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">
              {message.text}
              </div>
            </div>
          </div>
        ))}

        {isLoading ? (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
              Thinking...
            </div>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>
    </section>
  );
}
