export default function LoginForm({ authForm, setAuthForm, authLoading }) {
  return (
    <>
      <label className="block text-sm text-zinc-300">
        Email
        <input
          required
          type="email"
          value={authForm.email}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
          placeholder="you@example.com"
          className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400"
        />
      </label>

      <label className="block text-sm text-zinc-300">
        Password
        <input
          required
          type="password"
          minLength={6}
          value={authForm.password}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
          placeholder="At least 6 characters"
          className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-400"
        />
      </label>

      <button
        type="submit"
        disabled={authLoading}
        className="mt-2 w-full rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        {authLoading ? "Please wait..." : "Login"}
      </button>
    </>
  );
}
