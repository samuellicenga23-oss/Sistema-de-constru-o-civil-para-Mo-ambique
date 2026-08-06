import { Link } from "react-router-dom";
import { ApiError } from "../api/http";
import { creditsActionPath, isMeteredLimitCode } from "@sigo/shared";

/** Mensagem amigável + CTA quando a API devolve limite de plano/créditos. */
export function formatPlanLimitMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : "Ocorreu um erro.";
  }
  if (err.upgradeHint) return `${err.message} ${err.upgradeHint}`;
  return err.message;
}

export function planLimitActionPath(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.code) return null;
  if (err.actionPath) return err.actionPath;
  return creditsActionPath(err.code);
}

export function PlanLimitCallout({
  error,
  className = "",
}: {
  error: unknown;
  className?: string;
}) {
  if (
    !(error instanceof ApiError) ||
    (!error.code?.startsWith("PLAN_") && error.code !== "SUBSCRIPTION_EXPIRED" && error.code !== "SUBSCRIPTION_SUSPENDED")
  ) {
    if (!(error instanceof Error)) return null;
    return (
      <div className={`rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950 ${className}`}>
        {error.message}
      </div>
    );
  }

  const path = planLimitActionPath(error);
  const metered = isMeteredLimitCode(error.code);
  const cta = metered ? "Aumentar créditos" : "Ver planos e créditos";

  return (
    <div className={`rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 ${className}`}>
      <p className="font-medium">{error.message}</p>
      {error.upgradeHint ? <p className="mt-1 text-amber-900/90">{error.upgradeHint}</p> : null}
      {path ? (
        <Link to={path} className="mt-3 inline-flex btn btn-primary btn-sm">
          {cta} →
        </Link>
      ) : null}
    </div>
  );
}
