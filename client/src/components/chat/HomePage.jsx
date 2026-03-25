import { useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import ChatWindow from "./ChatWindow";
import UploadModal from "./UploadModal";

const CHAT_STORAGE_KEY_BASE = "cwcb-chats";
const MESSAGE_STORAGE_KEY_BASE = "cwcb-messages";

export default function HomePage({ user, logout, apiBase }) {
  const chatStorageKey = `${CHAT_STORAGE_KEY_BASE}:${user._id}`;
  const messageStorageKey = `${MESSAGE_STORAGE_KEY_BASE}:${user._id}`;

  const [chats, setChats] = useState(() => {
    try {
      const raw = localStorage.getItem(chatStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [messagesByChat, setMessagesByChat] = useState(() => {
    try {
      const raw = localStorage.getItem(messageStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [currentChatId, setCurrentChatId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Poll status only for chats that are still processing.
    const pending = chats.filter((chat) => chat.backendId && chat.status === "processing");
    if (!pending.length) return undefined;

    const interval = setInterval(async () => {
      for (const chat of pending) {
        try {
          const res = await fetch(`${apiBase}/projects/${chat.backendId}/status`, {
            headers: { "X-User-Id": user._id },
          });
          if (!res.ok) continue;
          const statusPayload = await res.json();
          if (!statusPayload?.status) continue;

          setChats((prev) =>
            prev.map((item) =>
              item.id === chat.id
                ? {
                    ...item,
                    status: statusPayload.status,
                    uploadComplete: statusPayload.status === "ready",
                    chunkCount: statusPayload.chunkCount ?? item.chunkCount,
                  }
                : item
            )
          );
        } catch {
          // Ignore transient polling failures.
        }
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [chats, apiBase]);

  useEffect(() => {
    localStorage.setItem(chatStorageKey, JSON.stringify(chats));
  }, [chats, chatStorageKey]);

  useEffect(() => {
    localStorage.setItem(messageStorageKey, JSON.stringify(messagesByChat));
  }, [messagesByChat, messageStorageKey]);

  useEffect(() => {
    if (!chats.length) {
      setCurrentChatId("");
      return;
    }
    if (!currentChatId || !chats.some((chat) => chat.id === currentChatId)) {
      setCurrentChatId(chats[0].id);
    }
  }, [chats, currentChatId]);

  const currentChat = useMemo(
    () => chats.find((chat) => chat.id === currentChatId) || null,
    [chats, currentChatId]
  );

  const currentMessages = useMemo(
    () => messagesByChat[currentChatId] || [],
    [messagesByChat, currentChatId]
  );

  const createChat = async ({ projectName, files }) => {
    setError("");
    setIsUploading(true);

    const tempId = `chat-temp-${Date.now()}`;
    const tempChat = {
      id: tempId,
      backendId: null,
      name: projectName,
      createdAt: new Date().toISOString(),
      fileCount: files.length,
      files: files.map((file) => file.name),
      serverFolderPath: "",
      uploadComplete: false,
      status: "processing",
      chunkCount: 0,
    };

    // Show chat immediately in sidebar as processing.
    setChats((prev) => [tempChat, ...prev]);
    setMessagesByChat((prev) => ({ ...prev, [tempId]: [] }));
    setCurrentChatId(tempId);
    setIsModalOpen(false);

    try {
      // Real API: upload selected folder files and create project with server-side storage path.
      const formData = new FormData();
      formData.append("projectName", projectName);
      files.forEach((file) => {
        formData.append("files", file);
        formData.append("relativePaths", file.webkitRelativePath || file.name);
      });

      const projectRes = await fetch(`${apiBase}/projects/upload`, {
        method: "POST",
        headers: { "X-User-Id": user._id },
        body: formData,
      });

      if (!projectRes.ok) {
        throw new Error("Could not create project in backend");
      }

      const project = await projectRes.json();

      const newChat = {
        id: tempId,
        backendId: project._id,
        name: projectName,
        createdAt: project.createdAt || new Date().toISOString(),
        fileCount: files.length,
        files: files.map((file) => file.name),
        serverFolderPath: project.indexPath,
        uploadComplete: project.status === "ready",
        status: project.status || "ready",
        chunkCount: project.chunkCount || 0,
      };

      setChats((prev) => prev.map((chat) => (chat.id === tempId ? newChat : chat)));
    } catch {
      setError("Upload failed. Please retry.");
      // Remove the optimistic chat on failure.
      setChats((prev) => prev.filter((chat) => chat.id !== tempId));
      setMessagesByChat((prev) => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
      setCurrentChatId("");
    } finally {
      setIsUploading(false);
    }
  };

  const sendQuery = async (queryText) => {
    if (!currentChat || !queryText.trim()) return;

    const userMessage = {
      id: `m-${Date.now()}`,
      role: "user",
      text: queryText.trim(),
      createdAt: new Date().toISOString(),
    };

    setMessagesByChat((prev) => ({
      ...prev,
      [currentChat.id]: [...(prev[currentChat.id] || []), userMessage],
    }));

    setIsAsking(true);
    setError("");

    try {
      // Fresh API call for every query (stateless Q&A) against real RAG backend.
      if (!currentChat.backendId) {
        throw new Error("This chat is not linked to backend. Create a new chat.");
      }

      const res = await fetch(`${apiBase}/projects/${currentChat.backendId}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": user._id,
        },
        body: JSON.stringify({ query: queryText.trim() }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || "Backend RAG request failed");
      }
      const response = await res.json();

      const assistantMessage = {
        id: `m-${Date.now()}-ai`,
        role: "assistant",
        text: response.answer || "No answer returned.",
        createdAt: new Date().toISOString(),
      };

      setMessagesByChat((prev) => ({
        ...prev,
        [currentChat.id]: [...(prev[currentChat.id] || []), assistantMessage],
      }));

      // Mark chat as ready if backend indicates successful processing.
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === currentChat.id
            ? { ...chat, uploadComplete: true, status: "ready" }
            : chat
        )
      );
    } catch (e) {
      setError(e.message || "Could not get response. Please retry.");
    } finally {
      setIsAsking(false);
    }
  };

  const deleteChat = (chatId) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    setMessagesByChat((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    if (currentChatId === chatId) {
      setCurrentChatId("");
    }
  };

  return (
    <div className="relative h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none absolute right-5 top-4 z-20 rounded-full border border-emerald-400/30 bg-zinc-900/80 px-3 py-1 backdrop-blur-sm">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-emerald-300">CodeRAG</span>
      </div>
      <div className="mx-auto flex h-full max-w-[1600px]">
        <Sidebar
          chats={chats}
          currentChatId={currentChatId}
          onSelectChat={setCurrentChatId}
          onDeleteChat={deleteChat}
          onNewChat={() => setIsModalOpen(true)}
          user={user}
          logout={logout}
        />

        <ChatWindow
          currentChat={currentChat}
          messages={currentMessages}
          onSend={sendQuery}
          isLoading={isAsking}
          isInputDisabled={!currentChat || !currentChat.uploadComplete || isUploading || isAsking}
          error={error}
        />
      </div>

      <UploadModal
        open={isModalOpen}
        onClose={() => !isUploading && setIsModalOpen(false)}
        onSubmit={createChat}
        isUploading={isUploading}
      />
    </div>
  );
}
