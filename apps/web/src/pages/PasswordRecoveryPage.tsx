import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AlertBanner from "../components/AlertBanner";
import { Logo } from "../components/landing/brand/Logo";

function AccountShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-surface px-4 py-10 text-ink sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <Link to="/" className="mx-auto flex w-fit" aria-label="SIGO — início"><Logo size={54} /></Link>
        <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-raised sm:p-7">
          <h1 className="font-display text-2xl font-black">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          <div className="mt-6">{children}</div>
        </section>
        <Link to="/login" className="mx-auto mt-5 block w-fit text-sm font-semibold text-teal-700 hover:underline">← Voltar ao login</Link>
      </div>
    </main>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.title = "Recuperar acesso — SIGO"; }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível enviar o pedido");
      setMessage(data.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o pedido");
    } finally { setSubmitting(false); }
  }

  return (
    <AccountShell title="Recuperar acesso" description="Indique o email da conta. Se estiver registado, enviaremos um link válido por 60 minutos.">
      {message ? <AlertBanner tone="success">{message}</AlertBanner> : (
        <form onSubmit={submit} className="space-y-4">
          {error && <AlertBanner tone="error">{error}</AlertBanner>}
          <div><label className="label">Email</label><input className="input" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn btn-primary w-full" disabled={submitting}>{submitting ? "A enviar..." : "Enviar link"}</button>
        </form>
      )}
    </AccountShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.title = "Nova palavra-passe — SIGO"; }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setError("As palavras-passe não coincidem"); return; }
    setSubmitting(true); setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível alterar a palavra-passe");
      navigate("/login?password_reset=1", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível alterar a palavra-passe");
    } finally { setSubmitting(false); }
  }

  return (
    <AccountShell title="Escolher nova palavra-passe" description="Use pelo menos 8 caracteres. Ao confirmar, as sessões antigas serão encerradas.">
      {!token ? <AlertBanner tone="error">Link incompleto. Peça um novo link de recuperação.</AlertBanner> : (
        <form onSubmit={submit} className="space-y-4">
          {error && <AlertBanner tone="error">{error}</AlertBanner>}
          <div><label className="label">Nova palavra-passe</label><input className="input" type="password" minLength={8} autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div><label className="label">Confirmar palavra-passe</label><input className="input" type="password" minLength={8} autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></div>
          <button className="btn btn-primary w-full" disabled={submitting}>{submitting ? "A guardar..." : "Guardar e entrar"}</button>
        </form>
      )}
    </AccountShell>
  );
}
