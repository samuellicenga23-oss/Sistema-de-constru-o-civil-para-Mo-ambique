import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { IconArrowRight, IconBuilding, IconClipboard, IconSparkle } from "../components/icons";
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

const PIPELINE_STAGES: Array<{ status: QuoteRequestStatus; label: string; color: string }> = [
  { status: "enviado", label: "Por responder", color: "var(--orange)" },
  { status: "respondido", label: "Respondido", color: "var(--teal)" },
  { status: "aceite", label: "Aceite", color: "#22c55e" },
];

function initialsOf(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function DashboardSkeleton() {
  return (
    <main className="portal-main">
      <div className="skeleton" style={{ height: "9rem", borderRadius: "1.25rem" }} />
      <div className="stat-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: "6.5rem" }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: "12rem" }} />
    </main>
  );
}

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

  const pending = useMemo(() => requests.filter((r) => r.status === "enviado"), [requests]);
  const rest = useMemo(() => requests.filter((r) => r.status !== "enviado"), [requests]);
  const acceptedCount = useMemo(() => requests.filter((r) => r.status === "aceite").length, [requests]);

  const pipelineCounts = useMemo(() => {
    const total = requests.length || 1;
    return PIPELINE_STAGES.map((stage) => ({ ...stage, count: requests.filter((r) => r.status === stage.status).length, pct: (requests.filter((r) => r.status === stage.status).length / total) * 100 }));
  }, [requests]);

  if (loading || !account) {
    return (
      <AppShell accountName={account?.name ?? "…"} pendingCount={0}>
        <DashboardSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell accountName={account.name} pendingCount={pending.length}>
      <main className="portal-main">
        <section className="hero-panel fade-up">
          <div className="hero-panel-content">
            <p className="hero-eyebrow">Portal do Fornecedor</p>
            <h1 className="hero-title">Olá, {account.name.split(" ")[0]}</h1>
            <p className="hero-subtitle">
              {pending.length > 0
                ? `Tem ${pending.length} pedido${pending.length === 1 ? "" : "s"} de cotação à espera de resposta. Responda depressa para não perder a obra.`
                : "Está tudo em dia — sem pedidos pendentes neste momento. Aproveite para manter os seus preços actualizados."}
            </p>
          </div>
        </section>

        <div className="stat-grid stagger">
          <div className="stat-tile">
            <span className="stat-tile-icon tone-orange"><IconClipboard size={17} /></span>
            <strong className="stat-tile-value">{pending.length}</strong>
            <span className="stat-tile-label">Por responder</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-icon tone-teal"><IconBuilding size={17} /></span>
            <strong className="stat-tile-value">{companies.length}</strong>
            <span className="stat-tile-label">Empresas ligadas</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-icon tone-green"><IconSparkle size={17} /></span>
            <strong className="stat-tile-value">{acceptedCount}</strong>
            <span className="stat-tile-label">Cotações aceites</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-icon tone-slate"><IconClipboard size={17} /></span>
            <strong className="stat-tile-value">{requests.length}</strong>
            <span className="stat-tile-label">Pedidos no total</span>
          </div>
        </div>

        {requests.length > 0 && (
          <section className="card card-pad fade-up delay-1">
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "0.9rem", fontWeight: 700 }}>Estado dos pedidos</h2>
            <div className="pipeline-bar" style={{ marginTop: "0.85rem" }}>
              {pipelineCounts.map((stage) => (
                <div key={stage.status} className="pipeline-seg" style={{ width: `${stage.pct}%`, background: stage.color }} title={`${stage.label}: ${stage.count}`} />
              ))}
            </div>
            <div className="pipeline-legend">
              {pipelineCounts.map((stage) => (
                <span key={stage.status} className="pipeline-legend-item">
                  <span className="pipeline-dot" style={{ background: stage.color }} />
                  {stage.label} ({stage.count})
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="card overflow-hidden fade-up delay-1">
          <div className="card-header">
            <h2>Empresas ligadas</h2>
            <p>Empresas SIGO que já lhe pediram cotação</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "1.1rem 1.25rem" }}>
            {companies.map((c) => (
              <span key={c.companyId} className="badge badge-neutral">
                {c.companyName}
              </span>
            ))}
            {companies.length === 0 && (
              <div className="empty-state" style={{ width: "100%", padding: "1.25rem 0" }}>
                <p style={{ margin: 0 }}>Ainda nenhuma empresa o convidou — quando pedirem uma cotação, aparecem aqui automaticamente.</p>
              </div>
            )}
          </div>
        </section>

        <section className="card overflow-hidden fade-up delay-2">
          <div className="card-header">
            <h2>Pedidos por responder ({pending.length})</h2>
            <p>Abra um pedido para indicar os seus preços</p>
          </div>
          <div className="stagger">
            {pending.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-icon"><IconClipboard size={22} /></span>
                <h3>Está tudo em dia</h3>
                <p>Não há pedidos pendentes neste momento — respire fundo, já volta a haver.</p>
              </div>
            ) : (
              pending.map((r) => {
                const isNew = Date.now() - new Date(r.createdAt).getTime() < 48 * 60 * 60 * 1000;
                return (
                  <Link key={r.id} to={`/pedidos/${r.id}`} className="rich-row">
                    <span className="rich-row-avatar">{initialsOf(r.companyName)}</span>
                    <div className="rich-row-body">
                      <p className="list-row-title">
                        {r.title}
                        {isNew && <span className="badge badge-brand" style={{ marginLeft: "0.5rem" }}>Novo</span>}
                      </p>
                      <p className="list-row-sub">
                        {r.companyName}
                        {r.projectName ? ` · ${r.projectName}` : ""}
                        {r.deadlineDate ? ` · Prazo: ${new Date(r.deadlineDate).toLocaleDateString("pt-PT")}` : ""}
                      </p>
                    </div>
                    <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    <IconArrowRight size={16} className="text-muted-sm" />
                  </Link>
                );
              })
            )}
          </div>
        </section>

        {rest.length > 0 && (
          <section className="card overflow-hidden fade-up delay-2">
            <div className="card-header">
              <h2>Histórico</h2>
            </div>
            <div className="stagger">
              {rest.map((r) => (
                <Link key={r.id} to={`/pedidos/${r.id}`} className="rich-row">
                  <span className="rich-row-avatar">{initialsOf(r.companyName)}</span>
                  <div className="rich-row-body">
                    <p className="list-row-title">{r.title}</p>
                    <p className="list-row-sub">{r.companyName}</p>
                  </div>
                  <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                  <IconArrowRight size={16} className="text-muted-sm" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
