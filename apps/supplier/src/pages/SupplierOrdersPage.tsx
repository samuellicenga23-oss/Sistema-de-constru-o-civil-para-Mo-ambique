import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { supplierPortalAuthApi, type SupplierAccount } from "../api/supplierPortal";
import { fulfillmentApi, type SupplierOrder, type SupplierPerformance } from "../api/fulfillment";

const FULFILLMENT_LABEL: Record<SupplierOrder["fulfillmentStatus"], string> = {
  aguarda_confirmacao: "A confirmar",
  confirmado: "Confirmada",
  em_preparacao: "Em preparação",
  pronto_expedir: "Pronta a expedir",
  em_transito: "Em trânsito",
  parcialmente_recebido: "Recepção parcial",
  recebido: "Recebida",
  fechado: "Fechada",
};

function pct(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

export default function SupplierOrdersPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [performance, setPerformance] = useState<SupplierPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    document.title = "Ordens de Compra — SIGO Fornecedores";
    supplierPortalAuthApi.me().then(async (me) => {
      setAccount(me);
      const [rows, stats] = await Promise.all([fulfillmentApi.orders(), fulfillmentApi.performance().catch(() => null)]);
      setOrders(rows);
      setPerformance(stats);
    }).catch(() => navigate("/login", { replace: true })).finally(() => setLoading(false));
    return () => { document.title = "Portal do Fornecedor — SIGO"; };
  }, [navigate]);

  const needle = query.trim().toLocaleLowerCase("pt");
  const visible = useMemo(() => orders.filter((order) => !needle || `${order.companyName} ${order.projectName} ${order.fulfillmentStatus} ${order.supplierConfirmationStatus}`.toLocaleLowerCase("pt").includes(needle)), [orders, needle]);
  const pending = orders.filter((order) => order.status === "aprovado" && order.supplierConfirmationStatus === "pendente").length;

  if (loading || !account) return <AppShell accountName={account?.name ?? "…"}><main className="portal-main"><div className="skeleton" style={{ height: "15rem" }} /></main></AppShell>;

  return (
    <AppShell accountName={account.name} pendingCount={pending}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">Execução comercial</p>
            <h1 className="hero-title">Ordens de Compra</h1>
            <p className="hero-subtitle">Confirmar, preparar e expedir.</p>
          </div>
        </section>

        <div className="stat-grid">
          <div className="stat-tile"><span className="text-muted-sm">Por confirmar</span><strong>{pending}</strong></div>
          <div className="stat-tile"><span className="text-muted-sm">Score</span><strong>{performance?.score == null ? "—" : `${performance.score.toFixed(0)}/100`}</strong></div>
          <div className="stat-tile"><span className="text-muted-sm">OTIF</span><strong>{pct(performance?.otifPct ?? null)}</strong></div>
          <div className="stat-tile"><span className="text-muted-sm">Aceitação</span><strong>{pct(performance?.acceptanceRatePct ?? null)}</strong></div>
          <div className="stat-tile"><span className="text-muted-sm">Atraso vs promessa</span><strong>{performance?.averageDelayDays == null ? "—" : `${performance.averageDelayDays.toFixed(1)} d`}</strong></div>
          <div className="stat-tile"><span className="text-muted-sm">Chega até necessidade</span><strong>{pct(performance?.needByHitRatePct ?? null)}</strong></div>
        </div>

        <div className="card card-pad">
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar empresa, obra ou estado…" />
        </div>

        <div className="stagger" style={{ display: "grid", gap: "0.75rem" }}>
          {visible.map((order) => {
            const lateRisk = order.requiredByDate && order.promisedDeliveryDate && order.promisedDeliveryDate > order.requiredByDate && order.fulfillmentStatus !== "recebido";
            return (
              <Link key={order.id} to={`/ordens/${order.id}`} className="card card-pad" style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 800 }}>{order.companyName}</p>
                    <p className="text-muted-sm" style={{ marginTop: "0.2rem" }}>{order.projectName}</p>
                  </div>
                  <span className={`badge ${order.fulfillmentStatus === "recebido" ? "badge-success" : lateRisk ? "badge-danger" : "badge-neutral"}`}>{FULFILLMENT_LABEL[order.fulfillmentStatus]}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "0.75rem", marginTop: "1rem" }}>
                  <div><span className="text-muted-sm">Necessário</span><strong style={{ display: "block" }}>{order.requiredByDate ?? "—"}</strong></div>
                  <div><span className="text-muted-sm">Prometido</span><strong style={{ display: "block" }}>{order.promisedDeliveryDate ?? "—"}</strong></div>
                  <div><span className="text-muted-sm">Aceite</span><strong style={{ display: "block" }}>{order.summary.fillRatePct.toFixed(1)}%</strong></div>
                </div>
                {lateRisk && <p style={{ margin: "0.75rem 0 0", color: "#b42318", fontWeight: 700, fontSize: "0.8rem" }}>Prazo prometido posterior à necessidade da obra.</p>}
              </Link>
            );
          })}
          {!visible.length && <div className="card card-pad text-muted-sm">Sem ordens de compra neste estado.</div>}
        </div>
      </main>
    </AppShell>
  );
}
