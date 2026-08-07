import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { publicApi, supplierPortalAuthApi, type PriceZone } from "../api/supplierPortal";

export default function SupplierRegisterPage() {
  const navigate = useNavigate();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const phoneId = useId();
  const nuitId = useId();
  const zoneId2 = useId();

  const [zones, setZones] = useState<PriceZone[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [nuit, setNuit] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Registar fornecedor — SIGO Fornecedores";
    publicApi.zones().then((rows) => {
      setZones(rows);
      if (rows.length) setZoneId(rows[0].id);
    }).catch(() => {});
    return () => {
      document.title = "Portal do Fornecedor — SIGO";
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!zoneId) {
      setError("Indique a zona onde opera");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await supplierPortalAuthApi.register({ name: name.trim(), email: email.trim(), password, phone: phone.trim() || undefined, nuit: nuit.trim() || undefined, zoneId });
      navigate("/painel", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="SIGO Fornecedores"
      footer={
        <p>
          Já tem conta?{" "}
          <Link to="/login" className="link-strong">Entrar</Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate aria-busy={loading} className="auth-card">
        <div className="auth-card-intro">
          <h1 className="auth-title">Registe a sua empresa</h1>
          <p className="auth-subtitle">Junte-se ao marketplace nacional de fornecedores do SIGO — coloque os seus preços de materiais, mão-de-obra e máquinas e receba pedidos de cotação directamente.</p>
        </div>

        <div className="field-stack">
          <div>
            <label className="field-label" htmlFor={nameId}>Nome da empresa/fornecedor</label>
            <input id={nameId} required value={name} onChange={(e) => setName(e.target.value)} disabled={loading} className="field-input" placeholder="Ex: Cimentos do Sul Lda" autoFocus />
          </div>
          <div>
            <label className="field-label" htmlFor={emailId}>Email</label>
            <input id={emailId} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} className="field-input" placeholder="nome@fornecedor.co.mz" autoComplete="username" />
          </div>
          <div>
            <label className="field-label" htmlFor={passwordId}>Palavra-passe</label>
            <input id={passwordId} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} className="field-input" placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
          </div>
          <div>
            <label className="field-label" htmlFor={zoneId2}>Zona onde opera</label>
            <select id={zoneId2} required value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={loading} className="field-input">
              {zones.length === 0 && <option value="">A carregar zonas...</option>}
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor={phoneId}>Telefone (opcional)</label>
            <input id={phoneId} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={loading} className="field-input" placeholder="+258 8..." />
          </div>
          <div>
            <label className="field-label" htmlFor={nuitId}>NUIT (opcional)</label>
            <input id={nuitId} value={nuit} onChange={(e) => setNuit(e.target.value)} disabled={loading} className="field-input" />
          </div>
        </div>

        <div className="auth-alert-slot">
          {error && <div className="auth-alert">{error}</div>}
        </div>

        <button type="submit" className="btn-login" disabled={loading}>
          {loading ? (
            <>
              <span className="btn-spinner" aria-hidden="true" />
              A registar...
            </>
          ) : (
            "Criar conta de fornecedor"
          )}
        </button>
      </form>
    </AuthLayout>
  );
}
