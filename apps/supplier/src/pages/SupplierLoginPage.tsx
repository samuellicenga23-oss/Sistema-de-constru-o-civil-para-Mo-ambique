import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supplierPortalAuthApi } from "../api/supplierPortal";

export default function SupplierLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await supplierPortalAuthApi.login(email.trim(), password);
      navigate("/painel", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="centered-screen">
      <div className="card card-pad auth-card">
        <div className="auth-card-header">
          <p className="portal-eyebrow">SIGO</p>
          <h1 className="portal-title">Portal do Fornecedor</h1>
          <p className="portal-subtitle">Veja e responda a pedidos de cotação das empresas com quem trabalha.</p>
        </div>
        {error && <p className="text-error">{error}</p>}
        <form onSubmit={handleSubmit} className="stack">
          <div>
            <label className="label">Email</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" autoFocus />
          </div>
          <div>
            <label className="label">Palavra-passe</label>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%" }}>
            {loading ? "A entrar..." : "Entrar"}
          </button>
        </form>
        <p className="text-muted-sm" style={{ textAlign: "center", marginTop: "1.25rem" }}>
          Recebeu um convite por email? <Link to="/aceitar-convite" style={{ fontWeight: 600, color: "var(--brand-700)" }}>Definir palavra-passe</Link>
        </p>
      </div>
    </div>
  );
}
