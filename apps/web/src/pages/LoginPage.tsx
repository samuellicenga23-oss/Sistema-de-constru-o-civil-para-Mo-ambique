import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth, ApiError } from "../auth/AuthContext";
import { SIGO_WHATSAPP_NUMBER } from "../commercialPlans";
import { LogoFull } from "../components/Logo";
import AlertBanner from "../components/AlertBanner";

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_nao_configurado: "O login com Google não está disponível neste momento.",
  falha_google: "Não foi possível confirmar a sua conta Google. Tente novamente.",
  email_google_nao_verificado: "O seu email Google não está verificado.",
  conta_google_nao_encontrada: "Não existe nenhuma conta SIGO com este email. Peça ao administrador da sua empresa para a criar primeiro.",
  conta_desactivada: "Esta conta foi desactivada. Contacte o administrador da sua empresa.",
  subscricao_suspensa: "A subscrição da sua empresa está suspensa. Contacte o suporte.",
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    document.title = "Entrar — SIGO";
    return () => {
      document.title = "SIGO — Sistema Integrado de Gestão de Obras";
    };
  }, []);

  useEffect(() => {
    const code = searchParams.get("error");
    if (code) setError(GOOGLE_ERROR_MESSAGES[code] ?? "Não foi possível entrar com Google.");
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((res) => res.json())
      .then((data) => setGoogleEnabled(Boolean(data.googleEnabled)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => emailRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const loggedInUser = await login(email.trim(), password);
      navigate(loggedInUser.mustChangePassword ? "/perfil?password=required" : loggedInUser.role === "super_admin" ? "/admin" : "/painel");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao entrar");
      window.setTimeout(() => document.getElementById(passwordId)?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f3f6f8] text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(42rem_28rem_at_50%_-10%,rgba(26,173,180,0.16),transparent_60%),radial-gradient(28rem_22rem_at_100%_100%,rgba(237,108,34,0.08),transparent_55%)]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center px-5 py-12">
        <header className="page-enter text-center">
          <Link
            to="/"
            className="inline-flex rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            aria-label="SIGO — voltar ao site"
          >
            <LogoFull tagline={false} className="mx-auto h-12 sm:h-14" />
          </Link>
          <p className="mx-auto mt-5 max-w-[22ch] font-display text-[1.35rem] font-semibold leading-snug tracking-[-0.02em] text-slate-900 sm:text-[1.5rem]">
            Entrar
          </p>
          <p className="mt-2 text-[14px] leading-5 text-slate-500">
            Email e palavra-passe da sua empresa.
          </p>
        </header>

        <main className="mt-8">
          <form
            onSubmit={handleSubmit}
            noValidate
            aria-busy={submitting}
            className="page-enter space-y-5"
            style={{ animationDelay: "40ms" }}
          >
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor={emailId}>Email</label>
                <input
                  ref={emailRef}
                  id={emailId}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={submitting}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  className="input min-h-11 bg-white"
                  placeholder="nome@empresa.co.mz"
                />
              </div>

              <div>
                <label className="label" htmlFor={passwordId}>Palavra-passe</label>
                <div className="relative">
                  <input
                    id={passwordId}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={submitting}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : undefined}
                    className="input min-h-11 bg-white pr-12"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    disabled={submitting}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-400 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
                    aria-label={showPassword ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div id={errorId} aria-live="polite" className="min-h-0">
              {error && (
                <AlertBanner tone="error" onDismiss={() => setError(null)}>
                  {error}
                </AlertBanner>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary w-full min-h-11 !py-3 text-[15px]"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  A entrar...
                </>
              ) : (
                "Entrar"
              )}
            </button>

            {googleEnabled && (
              <div className="space-y-4 pt-1">
                <div className="flex items-center gap-3" role="separator" aria-label="ou">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">ou</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <a
                  href="/api/auth/google/start"
                  aria-disabled={submitting}
                  onClick={(event) => {
                    if (submitting) event.preventDefault();
                  }}
                  className={`btn btn-secondary w-full min-h-11 !py-3 bg-white ${submitting ? "pointer-events-none opacity-50" : ""}`}
                >
                  <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.87.92 7.53 2.56 10.78z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  Continuar com Google
                </a>
              </div>
            )}
          </form>
        </main>

        <footer
          className="page-enter mt-10 flex flex-wrap items-center justify-center gap-x-1 text-[13px] text-slate-400"
          style={{ animationDelay: "80ms" }}
        >
          <Link to="/" className="rounded-md px-2 py-1 font-medium text-slate-500 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35">
            Site
          </Link>
          <span aria-hidden className="text-slate-300">·</span>
          <Link to="/#planos" className="rounded-md px-2 py-1 font-medium text-slate-500 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35">
            Planos
          </Link>
          <span aria-hidden className="text-slate-300">·</span>
          <a
            href={`https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${encodeURIComponent("Olá. Gostaria de uma demonstração do SIGO.")}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-2 py-1 font-medium text-slate-500 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
          >
            Pedir demonstração
          </a>
        </footer>
      </div>
    </div>
  );
}
