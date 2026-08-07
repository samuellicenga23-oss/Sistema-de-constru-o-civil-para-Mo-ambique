import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogoMark } from "../components/Logo";
import { supplierPortalApi, supplierPortalAuthApi, type QuoteRequestStatus, type SupplierAccount, type SupplierPortalCompany, type SupplierQuoteRequest } from "../api/supplierPortal";

const STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  enviado: "Por responder",
  respondido: "Respondido",
  aceite: "Aceite",
  recusado: "Recusado",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

const STATUS_BADGE: Record<QuoteRequestStatus, string> = {
  enviado: "badge-brand",
  respondido: "badge-neutral",
  aceite: "badge-success",
  recusado: "badge-danger",
  expirado: "badge-neutral",
  cancelado: "badge-neutral",
};

export default function SupplierDashboardPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [companies, setCompanies] = useState<SupplierPortalCompany[]>([]);
  const [requests, setRequests] = useState<SupplierQuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Painel — Portal do Fornecedor SIGO";
    supplierPortalAuthApi
      .me()
      .then(async (me) => {
        setAccount(me);
        const [c, r] = await Promise.all([supplierPortalApi.companies(), supplierPortalApi.quoteRequests()]);
        setCompanies(c);
        setRequests(r);
      })
      .catch(() => navigate("/login", { replace: true }))
      .finally(() => setLoading(false));
    return () => {
      document.title = "Portal do Fornecedor — SIGO";
    };
  }, [navigate]);

  async function handleLogout() {
    try {
      await supplierPortalAuthApi.logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  if (loading) {
    return <div className="centered-screen text-muted-sm">A carregar o portal...</div>;
  }

  const pending = requests.filter((r) => r.status === "enviado");
  const rest = requests.filter((r) => r.status !== "enviado");

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-brand">
            <LogoMark size={32} />
            <div className="portal-brand-text">
              <p className="portal-eyebrow">Portal do Fornecedor</p>
              <h1 className="portal-title">Olá, {account?.name}</h1>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="btn btn-secondary">
            Sair
          </button>
        </div>
      </header>

      <main className="portal-main">
        <div className="stat-strip">
          <div className="stat-card">
            <strong>{pending.length}</strong>
            <span>Por responder</span>
          </div>
          <div className="stat-card">
            <strong>{companies.length}</strong>
            <span>Empresas ligadas</span>
          </div>
          <div className="stat-card">
            <strong>{requests.length}</strong>
            <span>Pedidos no total</span>
          </div>
        </div>

        <section className="card">
          <div className="card-header">
            <h2>Empresas ligadas</h2>
            <p>Empresas SIGO que o convidaram para este portal</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "1rem 1.25rem" }}>
            {companies.map((c) => (
              <span key={c.companyId} className="badge badge-neutral">
                {c.companyName}
              </span>
            ))}
            {companies.length === 0 && <p className="text-muted-sm">Ainda nenhuma empresa o convidou.</p>}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Pedidos por responder ({pending.length})</h2>
            <p>Abra um pedido para indicar os seus preços</p>
          </div>
          <div>
            {pending.length === 0 ? (
              <div className="empty">Não há pedidos pendentes neste momento.</div>
            ) : (
              pending.map((r) => (
                <Link key={r.id} to={`/pedidos/${r.id}`} className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="list-row-title">{r.title}</p>
                    <p className="list-row-sub">
                      {r.companyName}
                      {r.projectName ? ` · ${r.projectName}` : ""}
                    </p>
                  </div>
                  <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                </Link>
              ))
            )}
          </div>
        </section>

        {rest.length > 0 && (
          <section className="card">
            <div className="card-header">
              <h2>Histórico</h2>
            </div>
            <div>
              {rest.map((r) => (
                <Link key={r.id} to={`/pedidos/${r.id}`} className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="list-row-title">{r.title}</p>
                    <p className="list-row-sub">{r.companyName}</p>
                  </div>
                  <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
