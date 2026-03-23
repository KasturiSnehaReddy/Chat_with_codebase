import { useEffect, useMemo, useState } from "react";

export default function Dashboard({
  user,
  form,
  setForm,
  submitForm,
  error,
  fetchHighlights,
  loading,
  highlights,
  logout,
}) {
  const [activeProject, setActiveProject] = useState("");
  const [projectFolderLabel, setProjectFolderLabel] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const knownProjects = Array.from(
      new Set(highlights.map((item) => item.tag).filter(Boolean))
    );

    if (!knownProjects.length) {
      setActiveProject("");
      return;
    }

    if (!knownProjects.includes(activeProject)) {
      setActiveProject(knownProjects[0]);
    }
  }, [highlights, activeProject]);

  const projects = useMemo(
    () => Array.from(new Set(highlights.map((item) => item.tag).filter(Boolean))),
    [highlights]
  );

  const projectChats = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    return highlights
      .filter((item) => item.tag === activeProject)
      .slice()
      .reverse();
  }, [highlights, activeProject]);

  const currentProjectLabel = activeProject || projectFolderLabel || "No project selected";

  const pendingProjectMessage = useMemo(() => {
    if (!projectFolderLabel) {
      return "Folder upload is UI-only for now. Backend ingestion can be connected next.";
    }

    if (!projects.includes(projectFolderLabel)) {
      return `Selected folder: ${projectFolderLabel}. Ask the first question to create this project window.`;
    }

    return `Selected folder: ${projectFolderLabel}`;
  }, [projectFolderLabel, projects]);

  const handleSend = (event) => {
    const question = form.title.trim();
    if (!question) {
      event.preventDefault();
      return;
    }

    const tag = activeProject || projectFolderLabel || "General Project";
    submitForm(event, {
      title: question,
      description: question,
      tag,
    });

    if (!activeProject && tag) {
      setActiveProject(tag);
    }
  };

  const startProjectFromFolder = () => {
    if (!projectFolderLabel) {
      return;
    }
    setActiveProject(projectFolderLabel);
  };

  const handleNewProject = () => {
    setActiveProject("");
    setProjectFolderLabel("");
    setForm((prev) => ({ ...prev, title: "", description: "", tag: "" }));
  };

  const handleFolderPick = (event) => {
    const picked = event.target.files;
    if (!picked || !picked.length) {
      setProjectFolderLabel("");
      return;
    }

    const first = picked[0];
    const relative = first.webkitRelativePath || first.name;
    const folder = relative.includes("/") ? relative.split("/")[0] : relative;
    setProjectFolderLabel(folder);
    if (!activeProject) {
      setActiveProject(folder);
    }
  };

  return (
    <main className={sidebarOpen ? "gpt-shell" : "gpt-shell sidebar-collapsed"}>
      <aside className="gpt-sidebar">
        <div className="gpt-sidebar-top">
          <div className="gpt-brand-row">
            <p className="gpt-brand">Project Assistant</p>
            <button
              type="button"
              className="ghost gpt-sidebar-toggle"
              onClick={() => setSidebarOpen(false)}
            >
              Hide
            </button>
          </div>
          <button type="button" className="ghost gpt-nav-btn" onClick={handleNewProject}>
            New chat
          </button>
          <button type="button" className="ghost gpt-nav-btn" onClick={fetchHighlights}>
            Search chats
          </button>
          <button type="button" className="ghost gpt-nav-btn" onClick={fetchHighlights}>
            Projects
          </button>
        </div>

        <div className="gpt-history-head">Your project windows</div>
        <div className="gpt-history-list">
          {projects.map((project) => {
            const active = project === activeProject;
            const count = highlights.filter((item) => item.tag === project).length;
            return (
              <button
                key={project}
                type="button"
                className={active ? "gpt-history-item active" : "gpt-history-item"}
                onClick={() => setActiveProject(project)}
              >
                <span>{project}</span>
                <small>{count} chat{count === 1 ? "" : "s"}</small>
              </button>
            );
          })}

          {!loading && !projects.length ? (
            <p className="empty">No project windows yet.</p>
          ) : null}
        </div>

        <div className="gpt-sidebar-footer">
          <span className="session-pill">{user?.name || user?.email}</span>
          <button type="button" className="ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <section className="gpt-main">
        <section className="gpt-stage">
          {!sidebarOpen ? (
            <button
              type="button"
              className="ghost gpt-open-sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              Open sidebar
            </button>
          ) : null}

          <h1 className="gpt-title">Ready when you are.</h1>
          <p className="gpt-subtitle">{currentProjectLabel}</p>

          <div className="gpt-chat-window">
            {!projectChats.length ? (
              <div className="bubble system-bubble">
                {currentProjectLabel === "No project selected"
                  ? "Choose or upload a project folder, then ask your first question."
                  : `No chats yet for ${currentProjectLabel}. Ask your first question below.`}
              </div>
            ) : (
              projectChats.map((chat, index) => (
                <div key={chat._id || `${chat.title}-${index}`} className="chat-pair">
                  <div className="bubble user-bubble">{chat.title}</div>
                  <div className="bubble assistant-bubble">
                    <p>{chat.description}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSend} className="gpt-composer">
            <label htmlFor="projectFolder" className="gpt-attach-btn" title="Upload project folder">
              +
            </label>
            <input
              id="projectFolder"
              type="file"
              className="hidden-folder-input"
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderPick}
            />

            <textarea
              required
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Ask anything about your selected project..."
              rows={2}
            />

            <button type="submit" className="gpt-send-btn">
              Send
            </button>
          </form>

          <p className="upload-hint">{pendingProjectMessage}</p>

          {projectFolderLabel && !projects.includes(projectFolderLabel) ? (
            <button type="button" className="ghost" onClick={startProjectFromFolder}>
              Create window for {projectFolderLabel}
            </button>
          ) : null}

          {error ? <p className="error">{error}</p> : null}
        </section>
      </section>
    </main>
  );
}
