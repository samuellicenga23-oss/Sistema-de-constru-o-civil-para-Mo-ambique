import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { supplierPortalAuthApi, supplierPortalApi, type SupplierAccount, type SupplierQuoteRequest } from "../api/supplierPortal";
import { supplierProcurementApi, type SupplierProcurementOpportunity } from "../api/procurement";

type InboxRow = {
  key: string;
  href: string;
  title: string;
  subtitle: string;
  meta: string;
  pending: boolean;
  badge: string;
  createdAt: string;
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function toInboxFromLegacy(row: SupplierQuoteRequest): InboxRow {
  const pending = row.status === "enviado";
  return {
    key: `legacy-${row.id}`,
    href: `/pedidos/${row.id}`,
    title: row.title,
    subtitle: `${row.companyName}${row.projectName ? ` · ${row.projectName}` : ""}`,
    meta: pending ? `Responder até ${dateLabel(row.deadlineDate)}` : `Recebido ${dateLabel(row.createdAt.slice(0, 10))}`,
    pending,
    badge: pending ? "Por responder" : row.status === "respondido" ? "Proposta enviada" : row.status === "aceite" ? "Aceite" : "Fechado",
    createdAt: row.createdAt,
  };
}

function toInboxFromProcurement(row: SupplierProcurementOpportunity): InboxRow {
  const pending = row.status === "aberta" && row.invitationStatus !== "respondido";
  return {
    key: `rfq-${row.id}`,
    href: `/oportunidades/${row.id}`,
    title: `${row.reference} · ${row.title}`,
    subtitle: `${row.companyName} · ${row.projectName}`,
    meta: `Responder até ${dateLabel(row.deadlineDate)} · necessário ${dateLabel(row.requiredByDate)}`,
    pending,
    badge: pending ? "Por responder" : row.invitationStatus === "respondido" ? "Proposta enviada" : "Fechado",
    createdAt: row.createdAt,
  };
}

export default function SupplierOpportunitiesPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [legacy, setLegacy] = useState<SupplierQuoteRequest[]>([]);
  const [rfqs, setRfqs] = useState<SupplierProcurementOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);

  useEffect(() => {
    document.title = "Pedidos — Portal do Fornecedor SIGO";
    Promise.all([
      supplierPortalAuthApi.me(),
      supplierPortalApi.quoteRequests().catch(() => [] as SupplierQuoteRequest[]),
      supplierProcurementApi.opportunities().catch(() => [] as SupplierProcurementOpportunity[]),
    ])
      .then(([me, quotes, opportunities]) => {
        setAccount(me);
        setLegacy(quotes);
        setRfqs(opportunities);
      })
      .catch(() => navigate("/login", { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);

  const rows = useMemo(() => {
    const merged = [
      ...legacy.map(toInboxFromLegacy),
      ...rfqs.map(toInboxFromProcurement),
    ].sort((a, b) => Number(b.pending) - Number(a.pending) || b.createdAt.localeCompare(a.createdAt));
    const needle = query.trim().toLocaleLowerCase("pt");
    return merged.filter((row) => {
      if (onlyPending && !row.pending) return false;
      if (!needle) return true;
      return `${row.title} ${row.subtitle}`.toLocaleLowerCase("pt").includes(needle);
    });
  }, [legacy, rfqs, query, onlyPending]);

  const pendingCount = useMemo(
    () => legacy.filter((r) => r.status === "enviado").length + rfqs.filter((r) => r.status === "aberta" && r.invitationStatus !== "respondido").length,
    [legacy, rfqs],
  );

  if (loading || !account) return <div className="portal-main">A carregar...</div>;

  return (
    <AppShell accountName={account.name} pendingCount={pendingCount}>
      <main className="portal-main">
        <section className="page-intro fade-up">
          <div>
            <p className="hero-eyebrow">Caixa de entrada</p>
            <h1 className="page-title">Pedidos de cotação</h1>
            <p className="page-subtitle">
              {pendingCount > 0
                ? `${pendingCount} pedido${pendingCount === 1 ? "" : "s"} à espera da sua proposta.`
                : "Sem pedidos por responder neste momento."}
            </p>
          </div>
        </section>

        <div className="toolbar-row">
          <input
            className="input"
            placeholder="Pesquisar empresa, obra ou pedido…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`chip-toggle ${onlyPending ? "active" : ""}`}
            onClick={() => setOnlyPending((value) => !value)}
          >
            {onlyPending ? "Só por responder" : "Todos"}
          </button>
        </div>

        <section className="card">
          <div className="stagger">
            {rows.map((row) => (
              <Link key={row.key} to={row.href} className={`rich-row ${row.pending ? "rich-row-emphasis" : ""}`}>
                <div className="rich-row-main">
                  <strong>{row.title}</strong>
                  <span>{row.subtitle}</span>
                  <small>{row.meta}</small>
                </div>
                <div className="rich-row-side">
                  <span className={`badge ${row.pending ? "badge-brand" : "badge-success"}`}>{row.badge}</span>
                </div>
              </Link>
            ))}
            {!rows.length && (
              <div className="empty-panel">
                <strong>{onlyPending ? "Nada por responder" : "Sem pedidos"}</strong>
                <p>Quando uma empresa pedir cotação nos materiais que vende, o pedido aparece aqui com destaque.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
