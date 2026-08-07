import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { supplierPortalAuthApi } from "../api/supplierPortal";

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" className="eye-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5 0-9.27-3.11-11-8 1.02-2.87 2.93-5.1 5.35-6.42" />
        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.5 11.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <path d="M1 1l22 22" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="eye-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function SupplierLoginPage() {
  const navigate = useNavigate();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Entrar — Portal do Fornecedor SIGO";
    const t = window.setTimeout(() => emailRef.current?.focus(), 80);
    return () => {
      window.clearTimeout(t);
      document.title = "Portal do Fornecedor — SIGO";
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await supplierPortalAuthApi.login(email.trim(), password);
      navigate("/painel", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao entrar");
      window.setTimeout(() => document.getElementById(passwordId)?.focus(), 0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Portal do Fornecedor"
      footer={
        <>
          <p>
            Recebeu um convite?{" "}
            <Link to="/aceitar-convite" className="link-strong">
              Definir palavra-passe
            </Link>
          </p>
          <a href="/login" className="link-muted">
            ← Entrar no painel da empresa
          </a>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate aria-busy={loading} className="auth-card">
        <div className="auth-card-intro">
          <h1 className="auth-title">Bem-vindo de volta</h1>
          <p className="auth-subtitle">Veja e responda aos pedidos de cotação das empresas com quem trabalha.</p>
        </div>

        <div className="field-stack">
          <div>
            <label className="field-label" htmlFor={emailId}>
              Email
            </label>
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
              disabled={loading}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className="field-input"
              placeholder="nome@empresa.co.mz"
            />
          </div>

          <div>
            <label className="field-label" htmlFor={passwordId}>
              Palavra-passe
            </label>
            <div className="field-password">
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
                disabled={loading}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className="field-input field-input-password"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="field-eye"
                onClick={() => setShowPassword((v) => !v)}
                disabled={loading}
                aria-label={showPassword ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
                aria-pressed={showPassword}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>
        </div>

        <div id={errorId} aria-live="polite" className="auth-alert-slot">
          {error && <div className="auth-alert">{error}</div>}
        </div>

        <button type="submit" className="btn-login" disabled={loading}>
          {loading ? (
            <>
              <span className="btn-spinner" aria-hidden="true" />
              A entrar...
            </>
          ) : (
            "Entrar"
          )}
        </button>
      </form>
    </AuthLayout>
  );
}
