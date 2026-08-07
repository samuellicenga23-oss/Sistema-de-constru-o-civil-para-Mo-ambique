import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api/http";
import { useAuth } from "../auth/AuthContext";

type EntitlementsSummary = {
  planKey: string;
  planLabel: string;
  status: string;
  expired: boolean;
  isTrial: boolean;
  expiresAt: string | null;
  maxUsers: number | null;
  maxActiveProjects: number | null;
  smartImportsPerMonth: number | null;
  plantAnalysesPerMonth: number | null;
  teamManagement: boolean;
  companyBranding: boolean;
  usage: {
    activeProjects: number;
    smartImportsUsed: number;
    plantAnalysesUsed: number;
    customCompositions: number;
  } | null;
  credits: {
    smartImportCredits: number;
    plantAnalysisCredits: number;
  } | null;
};

function nearLimit(used: number, max: number | null, extra = 0) {
  if (max == null) return false;
  return used >= Math.max(1, max + extra - 1);
}

export default function SubscriptionBanner() {
  const { user } = useAuth();
  const [entitlements, setEntitlements] = useState<EntitlementsSummary | null>(null);

  useEffect(() => {
    if (!user?.companyId || user.role === "super_admin") {
      setEntitlements(null);
      return;
    }
    let cancelled = false;
    request<EntitlementsSummary>("/companies/me/entitlements")
      .then((data) => {
        if (!cancelled) setEntitlements(data);
      })
      .catch(() => {
        if (!cancelled) setEntitlements(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.role]);

  if (!entitlements || user?.platformRole === "super_admin") return null;

  if (entitlements.expired) {
    return (
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 md:px-8">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>O seu período experimental terminou.</strong> Os dados continuam seguros. Active um plano para
            continuar a editar obras, importar mapas e analisar plantas.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/creditos?foco=plano" className="btn btn-primary btn-sm">
              Activar plano
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const importsNear =
    entitlements.usage &&
    nearLimit(
      entitlements.usage.smartImportsUsed,
      entitlements.smartImportsPerMonth,
      entitlements.credits?.smartImportCredits ?? 0,
    );
  const plantsNear =
    entitlements.usage &&
    nearLimit(
      entitlements.usage.plantAnalysesUsed,
      entitlements.plantAnalysesPerMonth,
      entitlements.credits?.plantAnalysisCredits ?? 0,
    );
  const projectsNear =
    entitlements.usage && nearLimit(entitlements.usage.activeProjects, entitlements.maxActiveProjects);

  if (entitlements.isTrial && entitlements.expiresAt) {
    const days = Math.max(0, Math.ceil((new Date(entitlements.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    return (
      <div className="border-b border-brand-200 bg-brand-50/80 px-4 py-2.5 text-sm text-brand-950 md:px-8">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Trial SIGO · <strong>{days} dia(s)</strong> restante(s)
            {entitlements.usage ? (
              <span className="text-brand-900/80">
                {" "}
                · {entitlements.usage.activeProjects}/{entitlements.maxActiveProjects ?? "∞"} obras ·{" "}
                {entitlements.usage.plantAnalysesUsed}/{entitlements.plantAnalysesPerMonth ?? "∞"} plantas ·{" "}
                {entitlements.usage.smartImportsUsed}/{entitlements.smartImportsPerMonth ?? "∞"} imports
              </span>
            ) : null}
          </p>
          <Link to="/creditos?foco=plano" className="text-xs font-semibold text-brand-800 hover:underline">
            Activar plano →
          </Link>
        </div>
      </div>
    );
  }

  if (importsNear || plantsNear || projectsNear) {
    const parts: string[] = [];
    if (importsNear) parts.push("importações");
    if (plantsNear) parts.push("plantas");
    if (projectsNear) parts.push("obras activas");
    const foco = projectsNear ? "plano" : plantsNear && !importsNear ? "plantas" : "importacoes";
    return (
      <div className="border-b border-amber-200 bg-amber-50/90 px-4 py-2.5 text-sm text-amber-950 md:px-8">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Está perto do limite de <strong>{parts.join(", ")}</strong> do plano {entitlements.planLabel}.
            {importsNear || plantsNear
              ? " Aumente créditos para continuar sem esperar pelo próximo mês."
              : " Arquive uma obra ou mude de plano."}
          </p>
          <Link to={`/creditos?foco=${foco}`} className="btn btn-primary btn-sm">
            {importsNear || plantsNear ? "Aumentar créditos" : "Ver planos"} →
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
