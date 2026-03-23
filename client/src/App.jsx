import { useState } from "react";
import AuthPage from "./components/AuthPage";
import HomePage from "./components/chat/HomePage";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001/api";
const SESSION_KEY = "mern-ui-user";

export default function App() {
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
    localStorage.removeItem(SESSION_KEY);
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

  return <HomePage user={user} logout={logout} apiBase={API_BASE} />;
}
