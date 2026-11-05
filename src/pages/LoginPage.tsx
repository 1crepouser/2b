import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("Неверный email или пароль");
    setBusy(false);
  }

  return (
    <main className="login">
      <h1>Объекты и задачи</h1>
      <form className="card form" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Вход…" : "Войти"}</button>
      </form>
    </main>
  );
}
