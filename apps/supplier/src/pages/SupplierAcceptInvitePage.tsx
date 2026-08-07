import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supplierPortalAuthApi } from "../api/supplierPortal";

export default function SupplierAcceptInvitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
      <div className="centered-screen">
        <div className="card card-pad auth-card" style={{ textAlign: "center" }}>
          <p className="text-error">Link de convite inválido. Peça à empresa para reenviar o convite.</p>
          <Link to="/login" style={{ fontWeight: 600, color: "var(--brand-700)" }}>Já tenho conta — entrar</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="centered-screen">
      <div className="card card-pad auth-card">
        <div className="auth-card-header">
          <p className="portal-eyebrow">SIGO</p>
          <h1 className="portal-title">Bem-vindo ao Portal do Fornecedor</h1>
          <p className="portal-subtitle">Defina a sua palavra-passe para começar a ver e responder a pedidos de cotação.</p>
        </div>
        {error && <p className="text-error">{error}</p>}
        <form onSubmit={handleSubmit} className="stack">
          <div>
            <label className="label">Nova palavra-passe</label>
            <input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" autoFocus />
          </div>
          <div>
            <label className="label">Confirmar palavra-passe</label>
            <input required minLength={8} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%" }}>
            {loading ? "A activar..." : "Activar conta"}
          </button>
        </form>
      </div>
    </div>
  );
}
