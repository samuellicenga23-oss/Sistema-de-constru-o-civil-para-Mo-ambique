import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  IconArrowRight,
  IconBuilding,
  IconCheck,
  IconClipboard,
  IconLightbulb,
  IconMapPin,
  IconPackage,
  IconSparkle,
  IconTag,
  IconUser,
} from "../components/icons";
import {
  marketplaceApi,
  supplierPortalApi,
  supplierPortalAuthApi,
  type MarketplaceMaterialPrice,
  type MarketplaceProfile,
  type QuoteRequestStatus,
  type SupplierAccount,
  type SupplierPortalCompany,
  type SupplierQuoteRequest,
} from "../api/supplierPortal";

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

function daysAgoLabel(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} dias`;
}

function DashboardSkeleton() {
  return (
    <main className="portal-main">
      <div className="skeleton" style={{ height: "9rem", borderRadius: "1.25rem" }} />
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => (
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
  const [profile, setProfile] = useState<MarketplaceProfile | null>(null);
  const [pricedCount, setPricedCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Painel — Portal do Fornecedor SIGO";
    supplierPortalAuthApi
      .me()
      .then(async (me) => {
        setAccount(me);
        const [c, r, p] = await Promise.all([
          supplierPortalApi.companies(),
          supplierPortalApi.quoteRequests(),
          marketplaceApi.profile().catch(() => null),
        ]);
        setCompanies(c);
        setRequests(r);
        setProfile(p);

        if (p) {
          const priceLists: Array<Promise<(MarketplaceMaterialPrice | { id: string | null })[]>> = [];
          if (p.offersMaterials) priceLists.push(marketplaceApi.listMaterials().catch(() => []));
          if (p.offersLabour) priceLists.push(marketplaceApi.listLabour().catch(() => []));
          if (p.offersEquipment) priceLists.push(marketplaceApi.listEquipment().catch(() => []));
          const lists = await Promise.all(priceLists);
          const flat = lists.flat();
          setCatalogCount(flat.length);
          setPricedCount(flat.filter((row) => row.id != null).length);
        }
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
  const responseRate = useMemo(() => {
    const closed = requests.filter((r) => r.status !== "enviado" && r.status !== "cancelado").length;
    const answered = requests.filter((r) => ["respondido", "aceite", "recusado"].includes(r.status)).length;
    if (!closed && !answered) return null;
    const base = Math.max(closed, answered, 1);
    return Math.round((answered / base) * 100);
  }, [requests]);

  const pipelineCounts = useMemo(() => {
    const total = requests.length || 1;
    return PIPELINE_STAGES.map((stage) => ({
      ...stage,
      count: requests.filter((r) => r.status === stage.status).length,
      pct: (requests.filter((r) => r.status === stage.status).length / total) * 100,
    }));
  }, [requests]);

  const companyStats = useMemo(() => {
    return companies.map((c) => {
      const rows = requests.filter((r) => r.companyId === c.companyId);
      return {
        ...c,
        total: rows.length,
        pending: rows.filter((r) => r.status === "enviado").length,
        accepted: rows.filter((r) => r.status === "aceite").length,
        lastAt: rows.map((r) => r.createdAt).sort().at(-1) ?? null,
      };
    });
  }, [companies, requests]);

  const checklist = useMemo(() => {
    const hasZone = Boolean(profile?.zoneId);
    const hasOffer = Boolean(profile && (profile.offersMaterials || profile.offersLabour || profile.offersEquipment) && !profile.needsOfferSetup);
    const hasPrices = pricedCount > 0;
    const inboxClear = pending.length === 0;
    return [
      { id: "perfil", done: hasZone, label: "Completar ficha e zona", href: "/perfil", hint: "As empresas filtram por região" },
      { id: "oferta", done: hasOffer, label: "Definir o que vende", href: "/oferta", hint: "Materiais, mão-de-obra ou máquinas" },
      { id: "precos", done: hasPrices, label: "Publicar pelo menos um preço", href: "/precos", hint: catalogCount ? `${pricedCount}/${catalogCount} com preço` : "Atualize o catálogo" },
      { id: "pedidos", done: inboxClear, label: pending.length ? `Responder ${pending.length} pedido(s)` : "Caixa de pedidos em dia", href: pending[0] ? `/pedidos/${pending[0].id}` : "/painel", hint: "Respostas rápidas fecham mais negócios" },
    ];
  }, [profile, pricedCount, catalogCount, pending]);

  const checklistDone = checklist.filter((c) => c.done).length;

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
                ? `Tem ${pending.length} pedido${pending.length === 1 ? "" : "s"} de cotação à espera. Responda depressa para não perder a obra.`
                : "Está tudo em dia — sem pedidos pendentes. Aproveite para reforçar preços e a sua ficha no marketplace."}
            </p>
            {profile?.location && (
              <p className="hero-meta">
                <IconMapPin size={14} /> {profile.location}
                {profile.offersMaterials || profile.offersLabour || profile.offersEquipment ? (
                  <span>
                    {" · "}
                    {[profile.offersMaterials && "Materiais", profile.offersLabour && "Mão-de-obra", profile.offersEquipment && "Máquinas"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </p>
            )}
          </div>
        </section>

        <div className="action-grid stagger">
          <Link to="/precos" className="action-tile">
            <span className="stat-tile-icon tone-teal"><IconTag size={17} /></span>
            <strong>Meus preços</strong>
            <span>{pricedCount > 0 ? `${pricedCount} preço(s) publicados` : "Publique preços para aparecer nas pesquisas"}</span>
          </Link>
          <Link to="/oferta" className="action-tile">
            <span className="stat-tile-icon tone-orange"><IconPackage size={17} /></span>
            <strong>O que vendo</strong>
            <span>Escolha produtos do catálogo nacional ou crie os seus</span>
          </Link>
          <Link to="/perfil" className="action-tile">
            <span className="stat-tile-icon tone-slate"><IconUser size={17} /></span>
            <strong>Perfil público</strong>
            <span>Nome, contacto, NUIT e zona de operação</span>
          </Link>
          {pending[0] ? (
            <Link to={`/pedidos/${pending[0].id}`} className="action-tile action-tile-accent">
              <span className="stat-tile-icon tone-orange"><IconClipboard size={17} /></span>
              <strong>Responder agora</strong>
              <span>Abrir o pedido mais recente por responder</span>
            </Link>
          ) : (
            <div className="action-tile action-tile-static">
              <span className="stat-tile-icon tone-green"><IconCheck size={17} /></span>
              <strong>Sem pendentes</strong>
              <span>Quando uma empresa pedir cotação, aparece aqui</span>
            </div>
          )}
        </div>

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
            <span className="stat-tile-icon tone-slate"><IconTag size={17} /></span>
            <strong className="stat-tile-value">{pricedCount}</strong>
            <span className="stat-tile-label">Preços no ar</span>
          </div>
        </div>

        <div className="two-col fade-up delay-1">
          <section className="card overflow-hidden">
            <div className="card-header">
              <h2>Como estar pronto ({checklistDone}/{checklist.length})</h2>
              <p>Complete estes passos para receber mais pedidos</p>
            </div>
            <div className="checklist">
              {checklist.map((item) => (
                <Link key={item.id} to={item.href} className={`checklist-item ${item.done ? "done" : ""}`}>
                  <span className="checklist-mark">{item.done ? <IconCheck size={13} /> : null}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.hint}</span>
                  </div>
                  <IconArrowRight size={14} className="text-muted-sm" />
                </Link>
              ))}
            </div>
          </section>

          <section className="card card-pad tips-card">
            <div className="card-inline-title">
              <span className="stat-tile-icon tone-orange"><IconLightbulb size={17} /></span>
              <div>
                <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 700 }}>Dicas rápidas</h2>
                <p className="text-muted-sm" style={{ margin: "0.15rem 0 0" }}>Para vender mais no SIGO</p>
              </div>
            </div>
            <ul className="tips-list">
              <li>Responda a pedidos em menos de 48 h — empresas fecham obras depressa.</li>
              <li>Indique stock e prazo nas notas da cotação (ex.: «disponível em Maputo, 3 dias»).</li>
              <li>Mantenha preços actualizados por zona; o marketplace filtra por região da obra.</li>
              <li>Use «O que vendo» para criar produtos que faltam no catálogo nacional.</li>
            </ul>
            {responseRate != null && (
              <p className="tips-foot">Taxa de resposta estimada: <strong>{responseRate}%</strong> · {requests.length} pedido(s) no histórico</p>
            )}
          </section>
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
            <p>Quem já lhe pediu cotação — com resumo por empresa</p>
          </div>
          {companyStats.length === 0 ? (
            <div className="empty-state" style={{ padding: "1.5rem" }}>
              <span className="empty-state-icon"><IconBuilding size={22} /></span>
              <h3>Ainda sem empresas</h3>
              <p>Quando pedirem cotação, ficam listadas aqui com o histórico de pedidos.</p>
            </div>
          ) : (
            <div className="stagger">
              {companyStats.map((c) => (
                <div key={c.companyId} className="rich-row rich-row-static">
                  <span className="rich-row-avatar">{initialsOf(c.companyName)}</span>
                  <div className="rich-row-body">
                    <p className="list-row-title">{c.brandName || c.companyName}</p>
                    <p className="list-row-sub">
                      {c.total} pedido{c.total === 1 ? "" : "s"}
                      {c.pending ? ` · ${c.pending} por responder` : ""}
                      {c.accepted ? ` · ${c.accepted} aceite(s)` : ""}
                      {c.lastAt ? ` · último ${daysAgoLabel(c.lastAt)}` : ""}
                    </p>
                  </div>
                  {c.pending > 0 && <span className="badge badge-brand">{c.pending} pendente(s)</span>}
                </div>
              ))}
            </div>
          )}
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
                        {r.deadlineDate ? (() => {
                          const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.deadlineDate);
                          const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(r.deadlineDate);
                          return ` · Prazo: ${d.toLocaleDateString("pt-PT")}`;
                        })() : ""}
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
              <p>Pedidos já respondidos ou encerrados</p>
            </div>
            <div className="stagger">
              {rest.map((r) => (
                <Link key={r.id} to={`/pedidos/${r.id}`} className="rich-row">
                  <span className="rich-row-avatar">{initialsOf(r.companyName)}</span>
                  <div className="rich-row-body">
                    <p className="list-row-title">{r.title}</p>
                    <p className="list-row-sub">
                      {r.companyName}
                      {r.respondedAt ? ` · respondido ${daysAgoLabel(r.respondedAt)}` : ` · ${daysAgoLabel(r.createdAt)}`}
                    </p>
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
