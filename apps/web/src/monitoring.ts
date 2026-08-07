import * as Sentry from "@sentry/react";

/**
 * Monitorização de erros no browser (Sentry, tier grátis). Sem VITE_SENTRY_DSN definido no
 * build, fica desligado — os erros continuam a aparecer na consola como sempre, só não são
 * reportados a nenhum serviço externo.
 */

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function isMonitoringEnabled(): boolean {
  return Boolean(dsn);
}

export function initMonitoring(): void {
  if (!dsn) return;
  // Erros fora da árvore React (handlers de eventos, promises sem catch) não passam pelo
  // AppErrorBoundary — o próprio SDK já regista window.onerror/unhandledrejection sozinho.
  Sentry.init({
    dsn,
    environment: import.meta.env.PROD ? "production" : "development",
    tracesSampleRate: 0.1,
  });
}

export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (!dsn) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
}
