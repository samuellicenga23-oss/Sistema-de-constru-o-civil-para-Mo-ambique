import * as Sentry from "@sentry/node";
import { env } from "../env.js";

/**
 * Monitorização de erros (Sentry, tier grátis). Sem SENTRY_DSN definido, fica desligado — os
 * erros continuam a aparecer no log do servidor como sempre, só não são reportados a nenhum
 * serviço externo. Chame `initMonitoring()` o mais cedo possível no arranque (antes de
 * construir a app), antes de qualquer outro import que possa lançar.
 */

export function isMonitoringEnabled(): boolean {
  return Boolean(env.sentryDsn);
}

export function initMonitoring(): void {
  if (!isMonitoringEnabled()) return;
  Sentry.init({
    dsn: env.sentryDsn!,
    environment: env.isProduction ? "production" : "development",
    release: env.release,
    tracesSampleRate: 0.1,
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!isMonitoringEnabled()) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
