import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";

export default function AuthPage({
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  submitAuth,
  authLoading,
  authError,
  authSuccess,
  setAuthError,
  setAuthSuccess,
}) {
  return (
    <main className="page auth-page">
      <section className="hero auth-hero">
        <p className="eyebrow">MERN Aesthetic Studio</p>
        <h1>{authMode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="subtitle">
          {authMode === "signup"
            ? "Start curating high-impact project highlights in a polished workspace."
            : "Sign in to manage your highlights and keep your demo portfolio updated."}
        </p>
      </section>

      <section className="panel auth-panel">
        <div className="auth-switch">
          <button
            type="button"
            className={authMode === "login" ? "tab active" : "tab"}
            onClick={() => {
              setAuthMode("login");
              setAuthError("");
              setAuthSuccess("");
            }}
          >
            Login
          </button>
          <button
            type="button"
            className={authMode === "signup" ? "tab active" : "tab"}
            onClick={() => {
              setAuthMode("signup");
              setAuthError("");
              setAuthSuccess("");
            }}
          >
            Signup
          </button>
        </div>

        <form onSubmit={submitAuth} className="form-grid auth-form">
          {authMode === "signup" ? (
            <SignupForm
              authForm={authForm}
              setAuthForm={setAuthForm}
              authLoading={authLoading}
            />
          ) : (
            <LoginForm
              authForm={authForm}
              setAuthForm={setAuthForm}
              authLoading={authLoading}
            />
          )}
        </form>

        {authSuccess ? <p className="success">{authSuccess}</p> : null}
        {authError ? <p className="error">{authError}</p> : null}
      </section>
    </main>
  );
}
