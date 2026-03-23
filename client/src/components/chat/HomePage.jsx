import { useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import ChatWindow from "./ChatWindow";
import UploadModal from "./UploadModal";

const CHAT_STORAGE_KEY = "cwcb-chats";
const MESSAGE_STORAGE_KEY = "cwcb-messages";

function mockUpload(payload) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        upload_id: `upl-${Date.now()}`,
        file_count: payload.files.length,
      });
    }, 600);
  });
}

function mockAsk({ chat_id, query, projectName, fileCount }) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        chat_id,
        answer: `I checked ${projectName} (${fileCount} files). Fresh answer for: "${query}". This response is stateless and does not depend on previous questions.`,
      });
    }, 900);
  });
}

export default function HomePage({ user, logout, apiBase }) {
  const [chats, setChats] = useState(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [messagesByChat, setMessagesByChat] = useState(() => {
    try {
      const raw = localStorage.getItem(MESSAGE_STORAGE_KEY);
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
          const res = await fetch(`${apiBase}/projects/${chat.backendId}/status`);
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
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(messagesByChat));
  }, [messagesByChat]);

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
      // Keep tiny visual delay so upload state is visible in UI.
      await mockUpload({ projectName, files });

      // Real API: upload selected folder files and create project with server-side storage path.
      const formData = new FormData();
      formData.append("projectName", projectName);
      files.forEach((file) => {
        formData.append("files", file);
        formData.append("relativePaths", file.webkitRelativePath || file.name);
      });

      const projectRes = await fetch(`${apiBase}/projects/upload`, {
        method: "POST",
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
      let response;
      if (currentChat.backendId) {
        const res = await fetch(`${apiBase}/projects/${currentChat.backendId}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryText.trim() }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.message || "Backend RAG request failed");
        }
        response = await res.json();
      } else {
        // Legacy local chats without backend project id fallback to mock response.
        response = await mockAsk({
          chat_id: currentChat.id,
          query: queryText.trim(),
          projectName: currentChat.name,
          fileCount: currentChat.fileCount,
        });
      }

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
    <div className="h-screen w-full bg-zinc-950 text-zinc-100">
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
