import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardApi, type DashboardData, type CurrencyTotals } from "../api/dashboard";
import Layout from "../components/Layout";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";
import AlertBanner from "../components/AlertBanner";
import { IconFolder, IconDoc, IconClipboard, IconMap, IconPlus } from "../components/icons";

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function MoneyByCurrency({ totals }: { totals: CurrencyTotals }) {
  const entries = Object.entries(totals);
  if (entries.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <>
      {entries.map(([currency, value], i) => (
        <span key={currency}>
          {i > 0 && " · "}
          {money(value, currency)}
        </span>
      ))}
    </>
  );
}

const CERT_STATUS_LABELS: Record<string, string> = { rascunho: "Rascunho", submetido: "Submetido", aprovado: "Aprovado" };
const CERT_STATUS_TONE: Record<string, string> = { rascunho: "badge-gray", submetido: "badge-yellow", aprovado: "badge-green" };

const OPERATION_FLOW = [
  { step: "01", label: "Medir", detail: "Plantas e quantidades", to: "/medicoes" },
  { step: "02", label: "Orçamentar", detail: "Composições e margem", to: "/orcamentos" },
  { step: "03", label: "Planear", detail: "Cronograma", to: "/orcamentos" },
  { step: "04", label: "Comprar", detail: "Stock e campo", to: "/fornecedores" },
  { step: "05", label: "Certificar", detail: "Autos e financeiro", to: "/orcamentos" },
];

function StatCard({ label, value, icon, tint }: { label: string; value: string | number; icon: ReactNode; tint: string }) {
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tint}`}>{icon}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadDashboard() {
    setLoading(true);
    setError(null);
    dashboardApi
      .get()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (user?.role === "super_admin") return;
    loadDashboard();
  }, [user?.role]);

  if (user?.role === "super_admin") {
    return (
      <Layout title="Painel">
        <div className="card card-pad max-w-md">
          <p className="text-sm text-slate-600">
            Sessão de plataforma. Gerir empresas e subscrições em{" "}
            <Link to="/admin" className="font-medium text-brand-700 hover:underline">
              Painel da Plataforma
            </Link>
            .
          </p>
        </div>
      </Layout>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const todayLabel = new Intl.DateTimeFormat("pt-MZ", { weekday: "long", day: "2-digit", month: "long" }).format(new Date());

  return (
    <Layout
      title={`${greeting}, ${user?.name?.split(" ")[0] ?? ""}`}
      subtitle={`${todayLabel} · estado das obras e decisões pendentes`}
      actions={
        <Link to="/medicoes" className="btn btn-primary btn-sm">
          <IconPlus className="w-3.5 h-3.5" />
          Nova obra
        </Link>
      }
    >
      <div className="space-y-5 md:space-y-6">
        {error && <ErrorState message={error} onRetry={loadDashboard} />}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Fluxo da obra</p>
            <h2 className="mt-1 text-sm font-semibold text-slate-900">Do preço ao resultado</h2>
          </div>
          <div className="flex snap-x gap-px overflow-x-auto bg-slate-200 [scrollbar-width:thin] md:grid md:grid-cols-5 md:overflow-visible">
            {OPERATION_FLOW.map((item) => (
              <Link
                key={item.step}
                to={item.to}
                className="group relative w-[170px] shrink-0 snap-start bg-white px-4 py-3.5 transition hover:bg-blue-50/60 md:w-auto"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black text-accent">{item.step}</span>
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-slate-200 text-xs text-brand-700 transition group-hover:border-brand-300 group-hover:bg-white">
                    →
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-900">{item.label}</p>
                <p className="mt-1 text-[10px] text-slate-500">{item.detail}</p>
              </Link>
            ))}
          </div>
        </section>

        {loading && !data && <LoadingState skeleton />}

        {data && (
          <>
            {data.contasVencidas > 0 && (
              <AlertBanner tone="warning">
                <span className="font-semibold">{data.contasVencidas}</span> conta(s) vencida(s) — verifique o Financeiro de cada projecto.
              </AlertBanner>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Projectos" value={data.totalProjects} tint="bg-blue-50 text-blue-700" icon={<IconFolder className="w-5 h-5" />} />
              <StatCard label="Mapas" value={data.totalDocuments} tint="bg-cyan-50 text-cyan-700" icon={<IconDoc className="w-5 h-5" />} />
              <StatCard label="Certificados" value={data.totalCertificates} tint="bg-orange-50 text-orange-700" icon={<IconClipboard className="w-5 h-5" />} />
              <StatCard label="Plantas" value={data.totalPlants} tint="bg-slate-100 text-slate-700" icon={<IconMap className="w-5 h-5" />} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <section className="card card-pad">
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Desempenho</p>
                  <h2 className="section-title mt-1 text-base">Resumo financeiro</h2>
                </div>
                <dl className="grid grid-cols-2 gap-y-3 text-sm">
                  <dt className="text-slate-500">Recebido</dt>
                  <dd className="text-right font-medium text-slate-900"><MoneyByCurrency totals={data.valorRecebido} /></dd>
                  <dt className="text-slate-500">Despesas</dt>
                  <dd className="text-right font-medium text-slate-900"><MoneyByCurrency totals={data.despesas} /></dd>
                  <dt className="text-slate-500">A receber</dt>
                  <dd className="text-right font-medium text-slate-900"><MoneyByCurrency totals={data.contasAReceber} /></dd>
                  <dt className="text-slate-500">A pagar</dt>
                  <dd className="text-right font-medium text-slate-900"><MoneyByCurrency totals={data.contasAPagar} /></dd>
                </dl>
              </section>

              <section className="card card-pad">
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Actividade</p>
                  <h2 className="section-title mt-1 text-base">Certificados recentes</h2>
                </div>
                {data.recentCertificates.length === 0 ? (
                  <EmptyState title="Ainda não há certificados de obra." description="Aprove um orçamento e registe o avanço físico por período." />
                ) : (
                  <ul className="space-y-2">
                    {data.recentCertificates.map((c) => (
                      <li key={c.id}>
                        <Link to={`/autos/${c.id}`} className="clickable-row flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2.5 text-sm hover:text-brand-700">
                          <span className="truncate">Auto {c.number} — {c.projectName}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className={`badge ${CERT_STATUS_TONE[c.status]}`}>{CERT_STATUS_LABELS[c.status]}</span>
                            <span aria-hidden="true">→</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {data.ordensCompraPendentes > 0 && (
                  <p className="muted mt-3 border-t border-slate-100 pt-3">
                    {data.ordensCompraPendentes} ordem(ns) de compra pendente(s).
                  </p>
                )}
              </section>
            </div>

            <section className="card">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 pt-4 pb-2">
                <h2 className="section-title text-base">Projectos por valor</h2>
                <Link to="/orcamentos" className="action-link">Ver todos →</Link>
              </div>
              {data.projects.length === 0 ? (
                <EmptyState
                  title="Ainda não há projectos."
                  description="Crie a primeira obra para começar a orçamentar."
                  action={
                    <Link to="/medicoes" className="btn btn-primary">
                      <IconPlus className="w-4 h-4" />
                      Criar projecto
                    </Link>
                  }
                />
              ) : (
                <ul>
                  {data.projects.map((p) => {
                    const max = Math.max(...data.projects.map((x) => x.total), 1);
                    return (
                      <li key={p.id} className="table-row clickable-row">
                        <Link to={`/projectos/${p.id}`} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-900">{p.name}</p>
                            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100">
                              <div className="h-1.5 rounded-full bg-brand-600 transition-all" style={{ width: `${((p.total / max) * 100).toFixed(1)}%` }} />
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-semibold tabular-nums text-slate-900">{money(p.total, p.currency)}</p>
                            <p className="muted">{p.documentCount} doc.</p>
                          </div>
                          <span className="text-brand-700" aria-hidden="true">→</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
