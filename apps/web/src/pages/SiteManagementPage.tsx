import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import Layout from "../components/Layout";
import PageSearch from "../components/PageSearch";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import { IconClipboard, IconFolder } from "../components/icons";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";

export default function SiteManagementPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    boqApi
      .listProjectsReadyForSite()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar obras"))
      .finally(() => setLoading(false));
  }, []);

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
      subtitle="Obras com orçamento aprovado — diário, cronograma, compras e financeiro"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <strong className="text-slate-950">{projects.length} obra(s) pronta(s)</strong>
          <span className="text-slate-500">Só entram obras com orçamento aprovado</span>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <IconClipboard className="h-4 w-4 text-brand-700" />
              <div>
                <h2 className="section-title text-base">Obras em gestão</h2>
                <p className="mt-0.5 text-xs text-slate-500">Abra a obra para o diário, compras ou cronograma.</p>
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
              {filtered.map((project) => (
                <li key={project.id}>
                  <Link
                    to={defaultHref(project.id)}
                    className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-slate-50 sm:px-5"
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-slate-950">{project.name}</strong>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {project.client || "Cliente por definir"} · {project.currency}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-brand-700">Abrir →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
}
