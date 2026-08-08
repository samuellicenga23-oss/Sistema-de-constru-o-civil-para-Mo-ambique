import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { boqApi, type Project, type SiteManagementOverview } from "../api/boq";
import Layout from "../components/Layout";
import GestaoTabs from "../components/GestaoTabs";
import PageSearch from "../components/PageSearch";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import { IconClipboard, IconFolder, IconAlertTriangle } from "../components/icons";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";
import PortfolioTimeline from "../components/PortfolioTimeline";

const ALERT_LEVEL_STYLE: Record<string, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

const ALERT_LEVEL_WEIGHT: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const ALERT_LEVEL_LABELS: Record<string, string> = { critical: "Crítico", warning: "Aviso", info: "Info" };
const ALERT_LEVEL_CHIP_ACTIVE: Record<string, string> = {
  all: "border-slate-900 bg-slate-900 text-white",
  critical: "border-red-600 bg-red-600 text-white",
  warning: "border-amber-500 bg-amber-500 text-white",
  info: "border-slate-500 bg-slate-500 text-white",
};

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currency}`;
}

export default function SiteManagementPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [overview, setOverview] = useState<SiteManagementOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [alertLevelFilter, setAlertLevelFilter] = useState<"all" | "critical" | "warning" | "info">("all");
  const [alertQuery, setAlertQuery] = useState("");

  useEffect(() => {
    boqApi
      .listProjectsReadyForSite()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar obras"))
      .finally(() => setLoading(false));
    boqApi
      .siteManagementOverview()
      .then(setOverview)
      .catch(() => {})
      .finally(() => setOverviewLoading(false));
  }, []);

  const overviewByProject = useMemo(() => {
    const map = new Map<string, SiteManagementOverview>();
    overview.forEach((o) => map.set(o.projectId, o));
    return map;
  }, [overview]);

  const allAlerts = useMemo(() => {
    const projectById = new Map(projects.map((p) => [p.id, p]));
    return overview
      .flatMap((o) => o.alerts.map((alert) => ({ ...alert, project: projectById.get(o.projectId) })))
      .filter((a) => a.project)
      .sort((a, b) => ALERT_LEVEL_WEIGHT[a.level] - ALERT_LEVEL_WEIGHT[b.level]);
  }, [overview, projects]);

  const alertCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    allAlerts.forEach((a) => { counts[a.level as "critical" | "warning" | "info"]++; });
    return counts;
  }, [allAlerts]);

  const visibleAlerts = useMemo(() => {
    const needle = alertQuery.trim().toLocaleLowerCase("pt");
    return allAlerts.filter((a) => {
      if (alertLevelFilter !== "all" && a.level !== alertLevelFilter) return false;
      if (needle && !a.project!.name.toLocaleLowerCase("pt").includes(needle)) return false;
      return true;
    });
  }, [allAlerts, alertLevelFilter, alertQuery]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return projects;
    return projects.filter((project) =>
      `${project.name} ${project.client ?? ""}`.toLocaleLowerCase("pt").includes(needle),
    );
  }, [projects, query]);

  function defaultHref(projectId: string) {
    if (can(user, "materiais.requisitar") || can(user, "materiais.ver") || can(user, "materiais.aprovar")) {
      return `/projectos/${projectId}/compras?fase=gestao`;
    }
    if (can(user, "diario.registar") || can(user, "diario.aprovar")) {
      return `/projectos/${projectId}/diario?fase=gestao`;
    }
    if (can(user, "cronograma.ver") || can(user, "cronograma.editar")) {
      return `/projectos/${projectId}/cronograma?fase=gestao`;
    }
    if (can(user, "financeiro.ver") || can(user, "financeiro.lancar")) {
      return `/projectos/${projectId}/financeiro?fase=gestao`;
    }
    return `/projectos/${projectId}?fase=gestao`;
  }

  return (
    <Layout
      title="Gestão da obra"
      subtitle="Diário, cronograma, compras, cotações e financeiro — fornecedores respondem no Portal SIGO Fornecedores"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <GestaoTabs />
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <strong className="text-slate-950">{projects.length} obra(s) pronta(s)</strong>
          <span className="text-slate-500">Só entram obras com orçamento aprovado</span>
        </section>

        {!overviewLoading && allAlerts.length > 0 && (
          <section className="card overflow-hidden border-amber-200">
            <div className="border-b border-amber-100 bg-amber-50/60 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <IconAlertTriangle className="h-4 w-4 text-amber-700" />
                <h2 className="section-title text-base text-amber-900">Precisa de atenção</h2>
                <span className="text-xs text-amber-700">{allAlerts.length} alerta(s) nas obras em gestão</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAlertLevelFilter("all")}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    alertLevelFilter === "all" ? ALERT_LEVEL_CHIP_ACTIVE.all : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  Todos ({allAlerts.length})
                </button>
                {(["critical", "warning", "info"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setAlertLevelFilter(level)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                      alertLevelFilter === level ? ALERT_LEVEL_CHIP_ACTIVE[level] : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {ALERT_LEVEL_LABELS[level]} ({alertCounts[level]})
                  </button>
                ))}
                <input
                  type="search"
                  value={alertQuery}
                  onChange={(e) => setAlertQuery(e.target.value)}
                  placeholder="Filtrar por obra…"
                  className="input input-sm ml-auto w-full max-w-[220px]"
                />
              </div>
            </div>
            {visibleAlerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400 sm:px-5">Nenhum alerta corresponde ao filtro.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visibleAlerts.map((alert, idx) => (
                  <li key={`${alert.project!.id}-${alert.code}-${idx}`}>
                    <Link
                      to={alert.href}
                      className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50 sm:px-5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ALERT_LEVEL_STYLE[alert.level]}`}>
                            {alert.title}
                          </span>
                          <span className="truncate text-xs font-medium text-slate-600">{alert.project!.name}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{alert.detail}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-brand-700">Resolver →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!overviewLoading && <PortfolioTimeline items={overview} />}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <IconClipboard className="h-4 w-4 text-brand-700" />
              <div>
                <h2 className="section-title text-base">Obras em gestão</h2>
                <p className="mt-0.5 text-xs text-slate-500">Execução física vs. prazo e situação financeira, de relance.</p>
              </div>
            </div>
            <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar obra ou cliente…" />
          </div>

          {loading ? (
            <LoadingState />
          ) : !filtered.length ? (
            <div className="p-6">
              <EmptyState
                icon={<IconFolder className="h-8 w-8" />}
                title="Nenhuma obra em gestão"
                description="Aprove um orçamento em Orçamentos para a obra aparecer aqui."
                action={
                  <Link to="/orcamentos" className="btn btn-primary btn-sm">
                    Ir a Orçamentos
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((project) => {
                const health = overviewByProject.get(project.id);
                const gap = health?.progressGap ?? 0;
                const gapLabel =
                  !health || (health.expectedProgress < 1 && health.actualProgress < 1)
                    ? null
                    : gap <= -10
                      ? `Atrasada ${Math.abs(gap).toFixed(0)} pts`
                      : gap >= 10
                        ? `Adiantada ${gap.toFixed(0)} pts`
                        : "No prazo";
                const gapClass =
                  !gapLabel || gapLabel === "No prazo"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : gap <= -10
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-teal-200 bg-teal-50 text-teal-800";
                const criticalCount = health?.alerts.filter((a) => a.level === "critical").length ?? 0;
                const totalAlertCount = health?.alerts.length ?? 0;
                const alertBadgeClass = criticalCount > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800";

                return (
                  <li key={project.id}>
                    <Link
                      to={defaultHref(project.id)}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-sm text-slate-950">{project.name}</strong>
                          {gapLabel && (
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${gapClass}`}>{gapLabel}</span>
                          )}
                          {totalAlertCount > 0 && (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${alertBadgeClass}`}>
                              <IconAlertTriangle className="h-3 w-3" /> {totalAlertCount}
                            </span>
                          )}
                        </div>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {project.client || "Cliente por definir"} · {project.currency}
                        </span>
                        {health && health.contractedValue > 0 && (
                          <span className="mt-1 block text-xs text-slate-500">
                            Recebido {money(health.receivedValue, health.currency)} de {money(health.contractedValue, health.currency)}
                            {" · "}
                            Execução real {health.actualProgress.toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-brand-700">Abrir →</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
}
