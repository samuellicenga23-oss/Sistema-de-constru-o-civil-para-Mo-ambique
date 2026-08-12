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
  if (!overview) return { label: "Por iniciar", cls: "badge-gray" };
  if (overview.operations.criticalCount > 0) return { label: "Bloqueio", cls: "badge-red" };
  if (overview.operations.warningCount > 0) return { label: "Atenção", cls: "badge-yellow" };
  if (overview.expectedProgress < 1 && overview.actualProgress < 1) return { label: "Por iniciar", cls: "badge-gray" };
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
              const nextAction = health?.operations.nextAction;
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

                    <div className="mt-5 grid grid-cols-3 gap-3">
                      <div><span className="text-xs text-slate-500">Previsto</span><strong className="mt-0.5 block text-lg tabular-nums text-slate-950">{(health?.expectedProgress ?? 0).toFixed(0)}%</strong></div>
                      <div><span className="text-xs text-slate-500">Real</span><strong className="mt-0.5 block text-lg tabular-nums text-slate-950">{progress.toFixed(0)}%</strong></div>
                      {health && health.contractedValue > 0 && <div className="text-right"><span className="text-xs text-slate-500">Recebido</span><strong className="mt-0.5 block truncate text-sm tabular-nums text-slate-900">{money(health.receivedValue, health.currency)}</strong></div>}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${progress}%` }} /></div>

                    {nextAction && (
                      <Link to={nextAction.href} className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${nextAction.level === "critical" ? "bg-red-50 text-red-900 hover:bg-red-100" : nextAction.level === "warning" ? "bg-amber-50 text-amber-900 hover:bg-amber-100" : "bg-blue-50 text-blue-900 hover:bg-blue-100"}`}>
                        <IconAlertTriangle className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1"><strong className="block">{nextAction.title}</strong><span className="line-clamp-1 opacity-80">{nextAction.detail}</span></span>
                        <span className="font-semibold">Abrir</span>
                      </Link>
                    )}
                    {health && <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                      {health.operations.lastDiaryDate && <span className="rounded-full bg-slate-100 px-2 py-1">Diário {new Date(`${health.operations.lastDiaryDate}T12:00:00`).toLocaleDateString("pt-MZ", { day: "2-digit", month: "short" })}</span>}
                      {health.operations.openPurchaseOrders > 0 && <span className="rounded-full bg-slate-100 px-2 py-1">{health.operations.openPurchaseOrders} compra(s) abertas</span>}
                      {health.operations.pendingClientInvoices > 0 && <span className="rounded-full bg-slate-100 px-2 py-1">{health.operations.pendingClientInvoices} factura(s) cliente</span>}
                      {health.operations.pendingSupplierInvoices > 0 && <span className="rounded-full bg-slate-100 px-2 py-1">{health.operations.pendingSupplierInvoices} factura(s) fornecedor</span>}
                    </div>}
                    {health && health.alerts.length > 1 && <details className="mt-3 rounded-lg border border-slate-200 bg-white">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">Ver todas as pendências ({health.alerts.length})</summary>
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        {health.alerts.map((alert) => <Link key={alert.code} to={alert.href} className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-slate-50"><span className="min-w-0"><strong className="block text-slate-800">{alert.title}</strong><span className="line-clamp-1 text-slate-500">{alert.detail}</span></span><span className={alert.level === "critical" ? "text-red-700" : alert.level === "warning" ? "text-amber-700" : "text-blue-700"}>Abrir</span></Link>)}
                      </div>
                    </details>}
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
