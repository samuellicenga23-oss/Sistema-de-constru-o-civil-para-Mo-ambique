import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { supplierPortalAuthApi, type SupplierAccount } from "../api/supplierPortal";
import { supplierProcurementApi, type SupplierProcurementOpportunity } from "../api/procurement";

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export default function SupplierOpportunitiesPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [rows, setRows] = useState<SupplierProcurementOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([supplierPortalAuthApi.me(), supplierProcurementApi.opportunities()])
      .then(([me, data]) => { setAccount(me); setRows(data); })
      .catch(() => navigate("/login", { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);

  const pending = rows.filter((r) => r.status === "aberta" && r.invitationStatus !== "respondido");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return rows;
    return rows.filter((r) => `${r.reference} ${r.title} ${r.companyName} ${r.projectName}`.toLocaleLowerCase("pt").includes(needle));
  }, [rows, query]);

  if (loading || !account) return <div className="portal-main">A carregar...</div>;

  return (
    <AppShell accountName={account.name} pendingCount={pending.length}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content"><p className="hero-eyebrow">Procurement</p><h1 className="hero-title">Oportunidades</h1><p className="hero-subtitle">Pedidos formais enviados a vários fornecedores. A sua proposta é privada e comparada apenas dentro da mesma RFQ.</p></div>
        </section>
        <div className="card" style={{ padding: "1rem" }}><input className="input" placeholder="Pesquisar empresa, obra ou RFQ…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <section className="card">
          <div className="card-header"><div><h2>Pedidos recebidos</h2><p>{pending.length} por responder</p></div></div>
          <div className="stagger">
            {visible.map((row) => (
              <Link key={row.id} to={`/oportunidades/${row.id}`} className="rich-row">
                <div className="rich-row-main"><strong>{row.reference} · {row.title}</strong><span>{row.companyName} · {row.projectName}</span><small>Responder até {dateLabel(row.deadlineDate)} · necessário {dateLabel(row.requiredByDate)}</small></div>
                <div className="rich-row-side"><span className={`badge ${row.invitationStatus === "respondido" ? "badge-success" : "badge-brand"}`}>{row.invitationStatus === "respondido" ? "Proposta enviada" : "Por responder"}</span></div>
              </Link>
            ))}
            {!visible.length && <div className="text-muted-sm">Sem oportunidades neste momento.</div>}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
