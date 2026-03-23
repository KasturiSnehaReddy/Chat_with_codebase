export default function SignupForm({ authForm, setAuthForm, authLoading }) {
  return (
    <>
      <label className="full-width">
        Name
        <input
          required
          value={authForm.name}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Sneha"
        />
      </label>

      <label className="full-width">
        Email
        <input
          required
          type="email"
          value={authForm.email}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
          placeholder="you@example.com"
        />
      </label>

      <label className="full-width">
        Password
        <input
          required
          type="password"
          minLength={6}
          value={authForm.password}
          onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
          placeholder="At least 6 characters"
        />
      </label>

      <button type="submit" disabled={authLoading}>
        {authLoading ? "Please wait..." : "Create account"}
      </button>
    </>
  );
}
