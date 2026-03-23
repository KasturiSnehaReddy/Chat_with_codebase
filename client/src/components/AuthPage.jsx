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
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-5 text-center">
          <p className="text-xs uppercase tracking-widest text-zinc-400">Chat with Codebase</p>
          <h1 className="mt-2 text-2xl font-semibold">{authMode === "signup" ? "Create account" : "Welcome back"}</h1>
        </div>

        <div className="mb-4 flex rounded-xl border border-zinc-800 bg-zinc-950 p-1">
          <button
            type="button"
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              authMode === "login" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
            }`}
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
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              authMode === "signup" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
            }`}
            onClick={() => {
              setAuthMode("signup");
              setAuthError("");
              setAuthSuccess("");
            }}
          >
            Signup
          </button>
        </div>

        <form onSubmit={submitAuth} className="space-y-3">
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

        {authSuccess ? <p className="mt-4 text-sm text-emerald-300">{authSuccess}</p> : null}
        {authError ? <p className="mt-4 text-sm text-red-300">{authError}</p> : null}
      </section>
    </main>
  );
}
