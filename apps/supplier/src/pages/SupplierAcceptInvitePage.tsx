import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { supplierPortalAuthApi } from "../api/supplierPortal";

export default function SupplierAcceptInvitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Activar conta — Portal do Fornecedor SIGO";
    return () => {
      document.title = "Portal do Fornecedor — SIGO";
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (password !== confirm) {
      setError("As palavras-passe não coincidem");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await supplierPortalAuthApi.acceptInvite(token, password);
      navigate("/painel", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao activar a conta");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        eyebrow="Portal do Fornecedor"
        footer={
          <Link to="/login" className="link-strong">
            Já tenho conta — entrar
          </Link>
        }
      >
        <div className="auth-card">
          <div className="auth-card-intro">
            <h1 className="auth-title">Convite inválido</h1>
            <p className="auth-subtitle">Este link expirou ou está incompleto. Peça à empresa para reenviar o convite.</p>
          </div>
          <Link to="/login" className="btn-login" style={{ textDecoration: "none" }}>
            Ir para o início de sessão
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Portal do Fornecedor"
      footer={
        <p>
          Já activou a conta?{" "}
          <Link to="/login" className="link-strong">
            Entrar
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate aria-busy={loading} className="auth-card">
        <div className="auth-card-intro">
          <h1 className="auth-title">Activar a sua conta</h1>
          <p className="auth-subtitle">Defina uma palavra-passe para começar a responder a pedidos de cotação.</p>
        </div>

        <div className="field-stack">
          <div>
            <label className="field-label" htmlFor={passwordId}>
              Nova palavra-passe
            </label>
            <input
              id={passwordId}
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              disabled={loading}
              className="field-input"
              placeholder="Mínimo 8 caracteres"
              autoFocus
            />
          </div>
          <div>
            <label className="field-label" htmlFor={confirmId}>
              Confirmar palavra-passe
            </label>
            <input
              id={confirmId}
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (error) setError(null);
              }}
              disabled={loading}
              aria-describedby={error ? errorId : undefined}
              className="field-input"
              placeholder="Repita a palavra-passe"
            />
          </div>
        </div>

        <div id={errorId} aria-live="polite" className="auth-alert-slot">
          {error && <div className="auth-alert">{error}</div>}
        </div>

        <button type="submit" className="btn-login" disabled={loading}>
          {loading ? (
            <>
              <span className="btn-spinner" aria-hidden="true" />
              A activar...
            </>
          ) : (
            "Activar conta"
          )}
        </button>
      </form>
    </AuthLayout>
  );
}
