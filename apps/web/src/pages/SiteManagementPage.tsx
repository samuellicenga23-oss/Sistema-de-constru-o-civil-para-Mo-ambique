import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { boqApi, type Project, type SiteManagementOverview } from "../api/boq";
import Layout from "../components/Layout";
import GestaoTabs from "../components/GestaoTabs";
import PageSearch from "../components/PageSearch";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import { IconAlertTriangle, IconFolder } from "../components/icons";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";

function money(value: number, currency: string) {
  return `${value.toLocaleString("pt-MZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currency}`;
}

function healthLabel(overview?: SiteManagementOverview) {
  if (!overview || (overview.expectedProgress < 1 && overview.actualProgress < 1)) return { label: "Por iniciar", cls: "badge-gray" };
  if (overview.progressGap <= -10) return { label: "Atrasada", cls: "badge-red" };
  if (overview.progressGap >= 10) return { label: "Adiantada", cls: "badge-green" };
  return { label: "No prazo", cls: "badge-green" };
}

export default function SiteManagementPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [overview, setOverview] = useState<SiteManagementOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([boqApi.listProjectsReadyForSite(), boqApi.siteManagementOverview()])
      .then(([projectRows, overviewRows]) => { setProjects(projectRows); setOverview(overviewRows); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar as obras"))
      .finally(() => setLoading(false));
  }, []);

  const overviewByProject = useMemo(() => new Map(overview.map((item) => [item.projectId, item])), [overview]);
  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    return projects.filter((project) => !needle || `${project.name} ${project.client ?? ""}`.toLocaleLowerCase("pt").includes(needle));
  }, [projects, query]);
  const attentionCount = overview.filter((item) => item.alerts.some((alert) => alert.level === "critical" || alert.level === "warning")).length;
  const averageProgress = overview.length ? overview.reduce((sum, item) => sum + item.actualProgress, 0) / overview.length : 0;

  return (
    <Layout title="Gestão de obras" subtitle="Acompanhe cada obra e entre directamente no trabalho necessário">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <GestaoTabs />
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="card px-4 py-3"><span className="text-xs text-slate-500">Obras activas</span><strong className="mt-1 block text-2xl text-slate-950">{projects.length}</strong></div>
          <div className="card px-4 py-3"><span className="text-xs text-slate-500">Precisam de atenção</span><strong className={`mt-1 block text-2xl ${attentionCount ? "text-amber-700" : "text-emerald-700"}`}>{attentionCount}</strong></div>
          <div className="card px-4 py-3"><span className="text-xs text-slate-500">Execução média</span><strong className="mt-1 block text-2xl text-slate-950">{averageProgress.toFixed(0)}%</strong></div>
        </section>

        <section className="card p-3 sm:p-4">
          <PageSearch value={query} onChange={setQuery} placeholder="Pesquisar obra ou cliente…" resultLabel={`${visibleProjects.length} obra(s)`} />
        </section>

        {loading ? <LoadingState /> : visibleProjects.length === 0 ? (
          <div className="card p-6">
            <EmptyState
              icon={<IconFolder className="h-8 w-8" />}
              title="Nenhuma obra em gestão"
              description="As obras com orçamento aprovado aparecem aqui."
              action={<Link to="/orcamentos" className="btn btn-primary btn-sm">Ver orçamentos</Link>}
            />
          </div>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {visibleProjects.map((project) => {
              const health = overviewByProject.get(project.id);
              const status = healthLabel(health);
              const importantAlert = health?.alerts.find((alert) => alert.level === "critical") ?? health?.alerts.find((alert) => alert.level === "warning");
              const progress = Math.max(0, Math.min(100, health?.actualProgress ?? 0));
              return (
                <article key={project.id} className="card overflow-hidden">
                  <div className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-slate-950">{project.name}</h2>
                        <p className="mt-1 text-xs text-slate-500">{project.client || "Cliente por definir"}</p>
                      </div>
                      <span className={`badge ${status.cls}`}>{status.label}</span>
                    </div>

                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div><span className="text-xs text-slate-500">Execução</span><strong className="mt-0.5 block text-xl tabular-nums text-slate-950">{progress.toFixed(0)}%</strong></div>
                      {health && health.contractedValue > 0 && <div className="text-right"><span className="text-xs text-slate-500">Recebido</span><strong className="mt-0.5 block text-sm tabular-nums text-slate-900">{money(health.receivedValue, health.currency)}</strong></div>}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${progress}%` }} /></div>

                    {importantAlert && (
                      <Link to={importantAlert.href} className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 hover:bg-amber-100">
                        <IconAlertTriangle className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate"><strong>{importantAlert.title}</strong> · {importantAlert.detail}</span>
                        <span className="font-semibold">Resolver</span>
                      </Link>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                    <Link to={`/projectos/${project.id}?fase=gestao`} className="btn btn-secondary btn-sm">Visão geral</Link>
                    {(can(user, "diario.registar") || can(user, "diario.aprovar")) && <Link to={`/projectos/${project.id}/diario?fase=gestao`} className="btn btn-ghost btn-sm">Diário</Link>}
                    {(can(user, "cronograma.ver") || can(user, "cronograma.editar")) && <Link to={`/projectos/${project.id}/cronograma?fase=gestao`} className="btn btn-ghost btn-sm">Cronograma</Link>}
                    {(can(user, "materiais.ver") || can(user, "materiais.requisitar") || can(user, "materiais.aprovar")) && <Link to={`/projectos/${project.id}/compras?fase=gestao`} className="btn btn-ghost btn-sm">Compras</Link>}
                    {(can(user, "financeiro.ver") || can(user, "financeiro.lancar")) && <Link to={`/projectos/${project.id}/financeiro?fase=gestao`} className="btn btn-ghost btn-sm">Financeiro</Link>}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </Layout>
  );
}
