import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { IconHome, IconClipboard, IconUpload, IconChart } from "./icons";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";
import PublicShareModal from "./PublicShareModal";

type NavMode = "measurement" | "budget" | "site";

export default function ProjectWorkspaceNav({
  projectId,
  mode,
  measurementOnly = false,
}: {
  projectId: string;
  /** measurement = só visão; budget = só visão; site = gestão da obra */
  mode?: NavMode;
  /** @deprecated use mode="measurement" */
  measurementOnly?: boolean;
}) {
  const location = useLocation();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [showPublicShare, setShowPublicShare] = useState(false);
  const fromGestao = params.get("fase") === "gestao";
  const resolvedMode: NavMode =
    mode ?? (measurementOnly ? "measurement" : fromGestao ? "site" : "budget");

  const faseQuery = resolvedMode === "site" ? "?fase=gestao" : "";
  const canShare = user?.role === "admin_empresa" || user?.role === "orcamentista";

  const allItems = [
    {
      to: `/projectos/${projectId}${faseQuery}`,
      path: `/projectos/${projectId}`,
      label: "Visão geral",
      icon: IconHome,
      exact: true,
      show: true,
    },
    {
      to: `/projectos/${projectId}/diario${faseQuery}`,
      path: `/projectos/${projectId}/diario`,
      label: "Diário de obra",
      icon: IconClipboard,
      show: resolvedMode === "site" && (can(user, "diario.registar") || can(user, "diario.aprovar")),
      moduleHint: "site_diary" as const,
    },
    {
      to: `/projectos/${projectId}/cronograma${faseQuery}`,
      path: `/projectos/${projectId}/cronograma`,
      label: "Cronograma",
      icon: IconChart,
      show: resolvedMode === "site" && (can(user, "cronograma.ver") || can(user, "cronograma.editar")),
      moduleHint: "schedule" as const,
    },
    {
      to: `/projectos/${projectId}/compras${faseQuery}`,
      path: `/projectos/${projectId}/compras`,
      label: "Compras e stock",
      icon: IconUpload,
      show:
        resolvedMode === "site" &&
        (can(user, "materiais.ver") || can(user, "materiais.requisitar") || can(user, "materiais.aprovar")),
      moduleHint: "purchasing" as const,
    },
    {
      to: `/projectos/${projectId}/financeiro${faseQuery}`,
      path: `/projectos/${projectId}/financeiro`,
      label: "Financeiro",
      icon: IconChart,
      show: resolvedMode === "site" && (can(user, "financeiro.ver") || can(user, "financeiro.lancar")),
      moduleHint: "financial" as const,
    },
  ];

  const items = allItems.filter((item) => {
    if (!item.show) return false;
    if (item.moduleHint && user && !user.enabledModules.includes(item.moduleHint)) return false;
    return true;
  });

  return (
    <div className="space-y-2">
      {resolvedMode === "site" && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Gestão da obra</p>
          {canShare && (
            <button type="button" onClick={() => setShowPublicShare(true)} className="btn btn-secondary btn-sm">
              Partilhar com o dono da obra
            </button>
          )}
        </div>
      )}
      <nav aria-label="Áreas do projecto" className="max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="flex min-w-max items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {items.map((item) => {
            const active = item.exact
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                  active
                    ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:bg-white/70 hover:text-slate-950"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {showPublicShare && <PublicShareModal projectId={projectId} onClose={() => setShowPublicShare(false)} />}
    </div>
  );
}
