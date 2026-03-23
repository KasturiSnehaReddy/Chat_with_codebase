import { useEffect, useMemo, useState } from "react";
import AuthPage from "./components/AuthPage";
import Dashboard from "./components/Dashboard";

const API_BASE = "http://localhost:5000/api";
const SESSION_KEY = "mern-ui-user";

export default function App() {
  const [highlights, setHighlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", description: "", tag: "" });
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const stats = useMemo(() => {
    const tagSet = new Set(highlights.map((item) => item.tag));
    return {
      cards: highlights.length,
      tags: tagSet.size,
    };
  }, [highlights]);

  const fetchHighlights = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/highlights`);
      if (!response.ok) {
        throw new Error("Could not fetch highlights.");
      }
      const data = await response.json();
      setHighlights(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err.message || "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchHighlights();
    }
  }, [user]);

  const submitAuth = async (event) => {
    event.preventDefault();
    try {
      setAuthLoading(true);
      const path = authMode === "signup" ? "signup" : "login";
      const payload =
        authMode === "signup"
          ? authForm
          : { email: authForm.email, password: authForm.password };

      const response = await fetch(`${API_BASE}/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Authentication failed.");
      }

      setAuthError("");

      if (authMode === "signup") {
        setAuthSuccess("Account created successfully. Please login.");
        setAuthMode("login");
        setAuthForm((prev) => ({
          name: "",
          email: prev.email,
          password: "",
        }));
      } else {
        setUser(data.user || null);
        localStorage.setItem(SESSION_KEY, JSON.stringify(data.user || null));
        setAuthSuccess("");
        setAuthForm({ name: "", email: "", password: "" });
      }
    } catch (err) {
      setAuthError(err.message || "Unexpected error.");
      setAuthSuccess("");
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setHighlights([]);
    localStorage.removeItem(SESSION_KEY);
  };

  const submitForm = async (event, overrides = {}) => {
    event.preventDefault();
    try {
      const baseTitle = overrides.title ?? form.title;
      const baseDescription = overrides.description ?? form.description;
      const baseTag = overrides.tag ?? form.tag;

      const cleanedTitle = String(baseTitle || "").trim();
      const payload = {
        title: cleanedTitle,
        description: String(baseDescription || cleanedTitle).trim(),
        tag: String(baseTag || "General Project").trim(),
      };

      const response = await fetch(`${API_BASE}/highlights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Could not add highlight.");
      }

      setForm({ title: "", description: "", tag: "" });
      await fetchHighlights();
      setError("");
    } catch (err) {
      setError(err.message || "Unexpected error.");
    }
  };

  if (!user) {
    return (
      <AuthPage
        authMode={authMode}
        setAuthMode={setAuthMode}
        authForm={authForm}
        setAuthForm={setAuthForm}
        submitAuth={submitAuth}
        authLoading={authLoading}
        authError={authError}
        authSuccess={authSuccess}
        setAuthError={setAuthError}
        setAuthSuccess={setAuthSuccess}
      />
    );
  }

  return (
    <Dashboard
      user={user}
      stats={stats}
      form={form}
      setForm={setForm}
      submitForm={submitForm}
      error={error}
      fetchHighlights={fetchHighlights}
      loading={loading}
      highlights={highlights}
      logout={logout}
    />
  );
}
