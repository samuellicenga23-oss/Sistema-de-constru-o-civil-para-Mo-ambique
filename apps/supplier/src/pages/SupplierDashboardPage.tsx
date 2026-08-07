import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  }, [navigate]);

  async function handleLogout() {
    await supplierPortalAuthApi.logout();
    navigate("/login", { replace: true });
  }

  if (loading) {
    return <div className="centered-screen text-muted-sm">A carregar...</div>;
  }

  const pending = requests.filter((r) => r.status === "enviado");
  const rest = requests.filter((r) => r.status !== "enviado");

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-inner">
          <div>
            <p className="portal-eyebrow">Portal do Fornecedor</p>
            <h1 className="portal-title">Olá, {account?.name}</h1>
          </div>
          <button onClick={handleLogout} className="btn btn-secondary">Sair</button>
        </div>
      </header>

      <main className="portal-main">
        <section className="card">
          <div className="card-header"><h2>Empresas ligadas à sua conta</h2></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "1rem 1.25rem" }}>
            {companies.map((c) => (
              <span key={c.companyId} className="badge badge-neutral">{c.companyName}</span>
            ))}
            {companies.length === 0 && <p className="text-muted-sm">Ainda nenhuma empresa o convidou.</p>}
          </div>
        </section>

        <section className="card">
          <div className="card-header"><h2>Pedidos por responder ({pending.length})</h2></div>
          <div>
            {pending.map((r) => (
              <Link key={r.id} to={`/pedidos/${r.id}`} className="list-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="list-row-title">{r.title}</p>
                  <p className="list-row-sub">
                    {r.companyName}{r.projectName ? ` · ${r.projectName}` : ""}
                    {r.deadlineDate ? ` · Prazo: ${new Date(r.deadlineDate).toLocaleDateString("pt-PT")}` : ""}
                  </p>
                </div>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
              </Link>
            ))}
            {pending.length === 0 && <p className="empty">Sem pedidos pendentes — está tudo em dia.</p>}
          </div>
        </section>

        {rest.length > 0 && (
          <section className="card">
            <div className="card-header"><h2>Histórico</h2></div>
            <div>
              {rest.map((r) => (
                <Link key={r.id} to={`/pedidos/${r.id}`} className="list-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="list-row-title">{r.title}</p>
                    <p className="list-row-sub">{r.companyName}{r.projectName ? ` · ${r.projectName}` : ""}</p>
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
