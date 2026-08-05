import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api/http";
import { SIGO_WHATSAPP_NUMBER } from "../commercialPlans";
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
};

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

  const whatsapp = `https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${encodeURIComponent("Olá — quero activar / actualizar o plano SIGO.")}`;

  if (entitlements.expired) {
    return (
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 md:px-8">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>O seu período experimental terminou.</strong> Os dados continuam seguros. Active um plano para
            continuar a editar obras, importar mapas e analisar plantas.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={whatsapp} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
              Falar com a equipa SIGO
            </a>
            <Link to="/empresa" className="btn btn-secondary btn-sm">
              Ver plano
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
          <a href={whatsapp} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-800 hover:underline">
            Activar plano →
          </a>
        </div>
      </div>
    );
  }

  return null;
}
