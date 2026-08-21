import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";
import PublicShareModal from "./PublicShareModal";

export type ProjectWorkspaceFase = "visao" | "medicao" | "orcamento" | "gestao";

/** Resolve o workspace a partir do URL — sem `fase` = visão geral (refresh-safe). */
export function resolveProjectFase(faseParam: string | null): ProjectWorkspaceFase {
  if (faseParam === "gestao") return "gestao";
  if (faseParam === "medicao" || faseParam === "levantamentos") return "medicao";
  if (faseParam === "orcamento" || faseParam === "orcamentos") return "orcamento";
  return "visao";
}

export function faseQueryFor(fase: ProjectWorkspaceFase): string {
  if (fase === "visao") return "";
  if (fase === "medicao") return "?fase=medicao";
  if (fase === "orcamento") return "?fase=orcamento";
  return "?fase=gestao";
}

const CONTEXT_TABS: Array<{ fase: ProjectWorkspaceFase; label: string; to: (id: string) => string }> = [
  { fase: "visao", label: "Visão geral", to: (id) => `/projectos/${id}` },
  { fase: "medicao", label: "Medições", to: (id) => `/projectos/${id}?fase=medicao` },
  { fase: "orcamento", label: "Orçamentos", to: (id) => `/projectos/${id}?fase=orcamento` },
  { fase: "gestao", label: "Gestão", to: (id) => `/projectos/${id}?fase=gestao` },
];

export default function ProjectWorkspaceNav({
  projectId,
  mode,
  measurementOnly = false,
}: {
  projectId: string;
  /** @deprecated prefer URL `?fase=` — mantido para páginas filhas de gestão */
  mode?: "measurement" | "budget" | "site";
  /** @deprecated use mode="measurement" */
  measurementOnly?: boolean;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [showPublicShare, setShowPublicShare] = useState(false);

  const fromUrl = resolveProjectFase(params.get("fase"));
  const resolvedMode = mode ?? (measurementOnly ? "measurement" : fromUrl === "gestao" ? "site" : fromUrl === "medicao" ? "measurement" : "budget");
  const activeFase: ProjectWorkspaceFase =
    location.pathname !== `/projectos/${projectId}` && location.pathname.startsWith(`/projectos/${projectId}/`)
      ? "gestao"
      : fromUrl === "visao" && resolvedMode === "site"
        ? "gestao"
        : fromUrl;

  const faseQuery = faseQueryFor(activeFase === "visao" ? "gestao" : activeFase);
  const canShare = user?.role === "admin_empresa" || user?.role === "orcamentista";

  const siteItems = [
    {
      to: `/projectos/${projectId}/diario${faseQuery}`,
      path: `/projectos/${projectId}/diario`,
      label: "Diário",
      show: can(user, "diario.registar") || can(user, "diario.aprovar"),
      moduleHint: "site_diary" as const,
    },
    {
      to: `/projectos/${projectId}/qualidade${faseQuery}`,
      path: `/projectos/${projectId}/qualidade`,
      label: "Qualidade",
      show: can(user, "diario.registar") || can(user, "diario.aprovar"),
      moduleHint: "site_diary" as const,
    },
    {
      to: `/projectos/${projectId}/cronograma${faseQuery}`,
      path: `/projectos/${projectId}/cronograma`,
      label: "Cronograma",
      show: can(user, "cronograma.ver") || can(user, "cronograma.editar"),
      moduleHint: "schedule" as const,
    },
    {
      to: `/projectos/${projectId}/compras${faseQuery}`,
      path: `/projectos/${projectId}/compras`,
      label: "Compras",
      show: can(user, "materiais.ver") || can(user, "materiais.requisitar") || can(user, "materiais.aprovar"),
      moduleHint: "purchasing" as const,
    },
    {
      to: `/projectos/${projectId}/financeiro${faseQuery}`,
      path: `/projectos/${projectId}/financeiro`,
      label: "Financeiro",
      show: can(user, "financeiro.ver") || can(user, "financeiro.lancar"),
      moduleHint: "financial" as const,
    },
  ].filter((item) => {
    if (!item.show) return false;
    if (item.moduleHint && user && !user.enabledModules.includes(item.moduleHint)) return false;
    return true;
  });

  const onProjectHub = location.pathname === `/projectos/${projectId}`;

  return (
    <div className="space-y-2">
      <nav aria-label="Áreas do projecto" className="max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="flex min-w-max items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {CONTEXT_TABS.map((tab) => {
            const active = onProjectHub && activeFase === tab.fase;
            return (
              <Link
                key={tab.fase}
                to={tab.to(projectId)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                  active
                    ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-950"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {activeFase === "gestao" && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <nav aria-label="Gestão da obra" className="max-w-full overflow-x-auto [scrollbar-width:thin]">
            <div className="flex min-w-max items-center gap-1">
              {siteItems.map((item) => {
                const active = location.pathname.startsWith(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                      active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
          {canShare && (
            <button type="button" onClick={() => setShowPublicShare(true)} className="btn btn-secondary btn-sm">
              Partilhar
            </button>
          )}
        </div>
      )}

      {showPublicShare && <PublicShareModal projectId={projectId} onClose={() => setShowPublicShare(false)} />}
    </div>
  );
}
