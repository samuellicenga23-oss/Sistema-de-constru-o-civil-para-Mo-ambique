import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { dashboardApi, type DashboardData, type CurrencyTotals } from "../api/dashboard";
import Layout from "../components/Layout";
import { IconFolder, IconDoc, IconClipboard, IconMap, IconPlus } from "../components/icons";

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

// Uma empresa pode ter projectos em MZN e USD ao mesmo tempo — nunca soma as duas moedas
// num único número, mostra uma linha por moeda presente.
function MoneyByCurrency({ totals }: { totals: CurrencyTotals }) {
  const entries = Object.entries(totals);
  if (entries.length === 0) return <span className="text-gray-400">—</span>;
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

function StatCard({ label, value, icon, tint }: { label: string; value: string | number; icon: ReactNode; tint: string }) {
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tint}`}>{icon}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === "super_admin") return;
    dashboardApi
      .get()
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user?.role]);

  if (user?.role === "super_admin") {
    return (
      <Layout title="Painel">
        <div className="card card-pad max-w-md">
          <p className="text-sm text-gray-600">
            Sessão de plataforma. Gerir empresas e subscrições em{" "}
            <Link to="/admin" className="text-brand-700 font-medium hover:underline">
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

  return (
    <Layout
      title="Visão geral"
      actions={
        <Link to="/projectos" className="btn btn-primary btn-sm">
          <IconPlus className="w-3.5 h-3.5" />
          Novo projecto
        </Link>
      }
    >
      <div className="space-y-7 max-w-[1500px] mx-auto">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <p className="text-2xl font-bold tracking-tight text-slate-900">
                {greeting}, {user?.name?.split(" ")[0]}
              </p>
              <p className="mt-1 text-sm text-slate-500">Resumo das obras e actividades da empresa.</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Hoje</p>
              <p className="mt-0.5 text-sm font-medium text-slate-700 capitalize">
                {new Intl.DateTimeFormat("pt-MZ", { weekday: "long", day: "2-digit", month: "long" }).format(new Date())}
              </p>
            </div>
        </div>

        {data && (
          <>
            {data.contasVencidas > 0 && (
              <div className="card card-pad border-red-200 bg-red-50 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-red-800">
                  <span className="font-semibold">{data.contasVencidas}</span> conta(s) a pagar/receber vencida(s) — verifique o Financeiro de cada projecto.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard label="Projectos" value={data.totalProjects} tint="bg-blue-50 text-blue-700" icon={<IconFolder className="w-5 h-5" />} />
              <StatCard label="Mapas de quantidades" value={data.totalDocuments} tint="bg-cyan-50 text-cyan-700" icon={<IconDoc className="w-5 h-5" />} />
              <StatCard label="Autos de medição" value={data.totalCertificates} tint="bg-orange-50 text-orange-700" icon={<IconClipboard className="w-5 h-5" />} />
              <StatCard label="Plantas" value={data.totalPlants} tint="bg-slate-100 text-slate-700" icon={<IconMap className="w-5 h-5" />} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <section className="card card-pad">
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Desempenho</p>
                  <h2 className="section-title mt-1 text-base">Resumo financeiro</h2>
                </div>
                <dl className="grid grid-cols-2 gap-y-3 text-sm">
                  <dt className="text-gray-500">Recebido</dt>
                  <dd className="text-right font-medium text-gray-900">
                    <MoneyByCurrency totals={data.valorRecebido} />
                  </dd>
                  <dt className="text-gray-500">Despesas</dt>
                  <dd className="text-right font-medium text-gray-900">
                    <MoneyByCurrency totals={data.despesas} />
                  </dd>
                  <dt className="text-gray-500">Contas a receber</dt>
                  <dd className="text-right font-medium text-gray-900">
                    <MoneyByCurrency totals={data.contasAReceber} />
                  </dd>
                  <dt className="text-gray-500">Contas a pagar</dt>
                  <dd className="text-right font-medium text-gray-900">
                    <MoneyByCurrency totals={data.contasAPagar} />
                  </dd>
                </dl>
              </section>

              <section className="card card-pad">
                <div className="mb-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Actividade recente</p>
                  <h2 className="section-title mt-1 text-base">Autos de medição</h2>
                </div>
                {data.recentCertificates.length === 0 ? (
                  <p className="text-sm text-gray-400">Ainda não há autos de medição.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.recentCertificates.map((c) => (
                      <li key={c.id}>
                        <Link to={`/autos/${c.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-brand-700">
                          <span className="truncate">
                            Auto {c.number} — {c.projectName}
                          </span>
                          <span className={`badge ${CERT_STATUS_TONE[c.status]} shrink-0`}>{CERT_STATUS_LABELS[c.status]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {data.ordensCompraPendentes > 0 && (
                  <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
                    {data.ordensCompraPendentes} ordem(ns) de compra pendente(s) de aprovação/recepção.
                  </p>
                )}
              </section>
            </div>

            <section className="card">
              <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-gray-100">
                <h2 className="section-title text-base">Projectos por valor orçamentado</h2>
                <Link to="/projectos" className="text-sm text-brand-700 font-medium hover:underline">
                  Ver todos →
                </Link>
              </div>
              {data.projects.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-gray-500 mb-3">Ainda não há projectos.</p>
                  <Link to="/projectos" className="btn btn-primary">
                    <IconPlus className="w-4 h-4" />
                    Criar o primeiro projecto
                  </Link>
                </div>
              ) : (
                <ul>
                  {data.projects.map((p) => {
                    const max = Math.max(...data.projects.map((x) => x.total), 1);
                    return (
                      <li key={p.id} className="table-row">
                        <Link to={`/projectos/${p.id}`} className="flex items-center gap-4 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate">{p.name}</p>
                            <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1.5">
                              <div className="bg-brand-600 h-1.5 rounded-full" style={{ width: `${((p.total / max) * 100).toFixed(1)}%` }} />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-semibold text-gray-900 tabular-nums">{money(p.total, p.currency)}</p>
                            <p className="muted">{p.documentCount} documento(s)</p>
                          </div>
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
