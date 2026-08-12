import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { and, count, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { measurementImportJobsTable, plantReviewRequests, plants, users } from "../db/schema.js";
import { env } from "../env.js";
import { emailLayout, escapeHtml, isMailEnabled, sendEmail } from "./mailer.js";
import { isMonitoringEnabled } from "./monitoring.js";
import { getHttpMetrics } from "./httpMetrics.js";

export type OperationalLevel = "ok" | "warning" | "critical";
export type OperationalCheck = {
  key: string;
  label: string;
  level: OperationalLevel;
  detail: string;
  action?: string;
};

export type OperationalHealth = {
  status: OperationalLevel;
  checkedAt: string;
  release: string;
  uptimeSeconds: number;
  services: {
    database: { level: OperationalLevel; latencyMs: number };
    plantService: { level: OperationalLevel; latencyMs: number; parserVersion?: string; ai?: { enabled?: boolean; reachable?: boolean; model?: string } };
  };
  queues: { available: boolean; plantsActive: number; plantsStuck: number; plantsFailed24h: number; importsActive: number; importsStuck: number; importsFailed24h: number; reviewsOverdue: number };
  storage: { availableBytes: number | null; totalBytes: number | null; usedPercent: number | null };
  backup: { configured: boolean; latestAt: string | null; ageHours: number | null };
  http: ReturnType<typeof getHttpMetrics>;
  integrations: { email: boolean; sentry: boolean };
  checks: OperationalCheck[];
};

const STUCK_MINUTES = 20;
const FAILED_SINCE_HOURS = 24;
const BACKUP_WARNING_HOURS = 30;
const BACKUP_CRITICAL_HOURS = 54;

function worstLevel(levels: OperationalLevel[]): OperationalLevel {
  return levels.includes("critical") ? "critical" : levels.includes("warning") ? "warning" : "ok";
}

async function databaseCheck() {
  const started = Date.now();
  try {
    await sql`select 1`;
    return { level: "ok" as const, latencyMs: Date.now() - started };
  } catch {
    return { level: "critical" as const, latencyMs: Date.now() - started };
  }
}

async function plantServiceCheck() {
  const started = Date.now();
  try {
    const response = await fetch(`${env.plantServiceUrl}/health`, {
      headers: env.plantServiceToken ? { "x-internal-token": env.plantServiceToken } : undefined,
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return { level: "warning" as const, latencyMs: Date.now() - started };
    const body = await response.json() as { status?: unknown; parserVersion?: unknown; ai?: unknown };
    if (body.status !== "ok") return { level: "warning" as const, latencyMs: Date.now() - started };
    const ai = body.ai && typeof body.ai === "object" ? body.ai as { enabled?: boolean; reachable?: boolean; model?: string } : undefined;
    return { level: "ok" as const, latencyMs: Date.now() - started, parserVersion: typeof body.parserVersion === "string" ? body.parserVersion : undefined, ai };
  } catch {
    return { level: "warning" as const, latencyMs: Date.now() - started };
  }
}

async function queueMetrics() {
  const staleBefore = new Date(Date.now() - STUCK_MINUTES * 60_000);
  const failedSince = new Date(Date.now() - FAILED_SINCE_HOURS * 60 * 60_000);
  const [[plantsActive], [plantsStuck], [plantsFailed], [importsActive], [importsStuck], [importsFailed], openReviews] = await Promise.all([
    db.select({ value: count() }).from(plants).where(inArray(plants.processingStatus, ["pendente", "processando"])),
    db.select({ value: count() }).from(plants).where(and(inArray(plants.processingStatus, ["pendente", "processando"]), lt(plants.processingUpdatedAt, staleBefore))),
    db.select({ value: count() }).from(plants).where(and(eq(plants.processingStatus, "erro"), gte(plants.processingUpdatedAt, failedSince))),
    db.select({ value: count() }).from(measurementImportJobsTable).where(inArray(measurementImportJobsTable.status, ["pendente", "processando"])),
    db.select({ value: count() }).from(measurementImportJobsTable).where(and(inArray(measurementImportJobsTable.status, ["pendente", "processando"]), lt(measurementImportJobsTable.updatedAt, staleBefore))),
    db.select({ value: count() }).from(measurementImportJobsTable).where(and(eq(measurementImportJobsTable.status, "erro"), gte(measurementImportJobsTable.updatedAt, failedSince))),
    db.select({ createdAt: plantReviewRequests.createdAt, slaHours: plantReviewRequests.slaHours }).from(plantReviewRequests).where(notInArray(plantReviewRequests.status, ["resolvido"])),
  ]);
  const reviewsOverdue = openReviews.filter((review) => Date.now() > review.createdAt.getTime() + review.slaHours * 60 * 60_000).length;
  return {
    available: true,
    plantsActive: Number(plantsActive.value), plantsStuck: Number(plantsStuck.value), plantsFailed24h: Number(plantsFailed.value),
    importsActive: Number(importsActive.value), importsStuck: Number(importsStuck.value), importsFailed24h: Number(importsFailed.value), reviewsOverdue,
  };
}

async function storageMetrics() {
  try {
    const fs = await statfs(path.resolve(env.uploadsDir));
    const totalBytes = fs.blocks * fs.bsize;
    const availableBytes = fs.bavail * fs.bsize;
    return { availableBytes, totalBytes, usedPercent: totalBytes > 0 ? Math.round(((totalBytes - availableBytes) / totalBytes) * 1000) / 10 : null };
  } catch {
    return { availableBytes: null, totalBytes: null, usedPercent: null };
  }
}

async function backupMetrics() {
  try {
    const files = (await readdir(env.backupDir)).filter((name) => /^sigo-.*\.dump$/.test(name));
    const dates = await Promise.all(files.map(async (name) => (await stat(path.join(env.backupDir, name))).mtime));
    const latest = dates.sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latest) return { configured: true, latestAt: null, ageHours: null };
    return { configured: true, latestAt: latest.toISOString(), ageHours: Math.round(((Date.now() - latest.getTime()) / 3_600_000) * 10) / 10 };
  } catch {
    return { configured: false, latestAt: null, ageHours: null };
  }
}

export async function getOperationalHealth(): Promise<OperationalHealth> {
  const emptyQueues = { available: false, plantsActive: 0, plantsStuck: 0, plantsFailed24h: 0, importsActive: 0, importsStuck: 0, importsFailed24h: 0, reviewsOverdue: 0 };
  const [database, plantService, queues, storage, backup] = await Promise.all([databaseCheck(), plantServiceCheck(), queueMetrics().catch(() => emptyQueues), storageMetrics(), backupMetrics()]);
  const checks: OperationalCheck[] = [];
  if (database.level === "critical") checks.push({ key: "database", label: "Base de dados indisponível", level: "critical", detail: "A API não consegue consultar o PostgreSQL.", action: "Ver logs do PM2 e estado do PostgreSQL." });
  if (!queues.available) checks.push({ key: "queues_unavailable", label: "Filas não verificadas", level: "critical", detail: "Não foi possível consultar os trabalhos em segundo plano.", action: "Restabelecer a base de dados e repetir o diagnóstico." });
  if (plantService.level !== "ok") checks.push({ key: "plant_service", label: "Leitor de plantas indisponível", level: "warning", detail: "Novos PDFs ficam em espera; os restantes módulos continuam disponíveis.", action: "Verificar sigo-plant-service no systemd." });
  if (queues.plantsStuck > 0) checks.push({ key: "plants_stuck", label: `${queues.plantsStuck} planta(s) sem progresso`, level: "critical", detail: `Sem actualização há mais de ${STUCK_MINUTES} minutos.`, action: "Rever a fila e os logs do leitor." });
  if (queues.importsStuck > 0) checks.push({ key: "imports_stuck", label: `${queues.importsStuck} importação(ões) sem progresso`, level: "critical", detail: `Sem actualização há mais de ${STUCK_MINUTES} minutos.`, action: "Rever os logs da API e repetir o trabalho." });
  if (queues.plantsFailed24h + queues.importsFailed24h > 0) checks.push({ key: "recent_failures", label: "Falhas nas últimas 24 horas", level: "warning", detail: `${queues.plantsFailed24h} planta(s) e ${queues.importsFailed24h} importação(ões).`, action: "Abrir as revisões pendentes e confirmar a causa." });
  if (queues.reviewsOverdue > 0) checks.push({ key: "reviews_overdue", label: `${queues.reviewsOverdue} revisão(ões) fora do SLA`, level: "warning", detail: "Pedidos de revisão do motor aguardam resolução.", action: "Abrir Revisões do motor de plantas." });
  if (storage.usedPercent == null) checks.push({ key: "storage_unknown", label: "Disco não verificado", level: "warning", detail: "Não foi possível ler a capacidade do volume de uploads." });
  else if (storage.usedPercent >= 92) checks.push({ key: "storage_critical", label: `Disco a ${storage.usedPercent}%`, level: "critical", detail: "Capacidade crítica; uploads e backups podem falhar.", action: "Libertar espaço e confirmar backups externos." });
  else if (storage.usedPercent >= 80) checks.push({ key: "storage_warning", label: `Disco a ${storage.usedPercent}%`, level: "warning", detail: "Capacidade acima do nível recomendado.", action: "Rever Disco e lixo." });
  if (!backup.configured || backup.ageHours == null) checks.push({ key: "backup_missing", label: "Backup não confirmado", level: "critical", detail: "Nenhum dump SIGO válido foi encontrado no directório configurado.", action: "Executar deploy/backup.sh e verificar o cron." });
  else if (backup.ageHours >= BACKUP_CRITICAL_HOURS) checks.push({ key: "backup_old", label: `Backup com ${Math.round(backup.ageHours)}h`, level: "critical", detail: "A cópia de segurança está demasiado antiga.", action: "Executar um backup e verificar o cron." });
  else if (backup.ageHours >= BACKUP_WARNING_HOURS) checks.push({ key: "backup_delayed", label: `Backup com ${Math.round(backup.ageHours)}h`, level: "warning", detail: "O backup diário está atrasado.", action: "Verificar o cron de backup." });
  if (!isMailEnabled()) checks.push({ key: "email", label: "Email não configurado", level: "warning", detail: "Alertas e mensagens transaccionais não serão enviados." });
  if (!isMonitoringEnabled()) checks.push({ key: "sentry", label: "Monitorização externa desligada", level: "warning", detail: "Erros continuam nos logs, mas não geram alerta externo." });
  const http = getHttpMetrics();
  if (http.requests >= 20 && http.errorRatePercent >= 10) checks.push({ key: "http_errors", label: `Erros HTTP a ${http.errorRatePercent}%`, level: "critical", detail: `${http.serverErrors} resposta(s) 5xx nos últimos ${http.windowMinutes} minutos.`, action: "Ver logs do PM2 e procurar o requestId dos pedidos afectados." });
  else if (http.requests >= 20 && http.errorRatePercent >= 3) checks.push({ key: "http_errors", label: `Erros HTTP a ${http.errorRatePercent}%`, level: "warning", detail: `${http.serverErrors} resposta(s) 5xx nos últimos ${http.windowMinutes} minutos.`, action: "Rever os erros recentes no Sentry/PM2." });
  if (http.requests >= 10 && http.averageLatencyMs >= 1_500) checks.push({ key: "http_latency", label: `API lenta: média ${http.averageLatencyMs} ms`, level: "warning", detail: `${http.slowRequests} pedido(s) demoraram mais de 2 segundos.`, action: "Verificar carga, base de dados e operações pesadas." });
  if (checks.length === 0) checks.push({ key: "all_ok", label: "Todos os controlos operacionais estão normais", level: "ok", detail: "Serviços, filas, disco e backup foram verificados." });
  return { status: worstLevel(checks.map((check) => check.level)), checkedAt: new Date().toISOString(), release: env.release, uptimeSeconds: Math.round(process.uptime()), services: { database, plantService }, queues, storage, backup, http, integrations: { email: isMailEnabled(), sentry: isMonitoringEnabled() }, checks };
}

let lastAlertSignature = "";
let lastAlertAt = 0;
let wasCritical = false;

export async function runOperationalHealthMonitor(logger?: { info: (data: unknown, message?: string) => void; error: (data: unknown, message?: string) => void }) {
  try {
    const health = await getOperationalHealth();
    const critical = health.checks.filter((check) => check.level === "critical");
    const signature = critical.map((check) => check.key).sort().join(",");
    const repeatDue = Date.now() - lastAlertAt >= 6 * 60 * 60_000;
    if (critical.length && env.isProduction && isMailEnabled() && (signature !== lastAlertSignature || repeatDue)) {
      const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
      const html = `<p>O SIGO detectou ${critical.length} problema(s) crítico(s).</p><ul>${critical.map((check) => `<li><strong>${escapeHtml(check.label)}</strong>: ${escapeHtml(check.detail)}</li>`).join("")}</ul><p>Release: ${escapeHtml(health.release)} · verificado em ${escapeHtml(health.checkedAt)}</p>`;
      const sent = await sendEmail({ to: admins.map((admin) => admin.email), subject: `SIGO — ${critical.length} alerta(s) operacional(is)`, html: emailLayout("Alerta operacional", html) }, logger);
      if (sent) {
        lastAlertSignature = signature;
        lastAlertAt = Date.now();
      }
    } else if (!critical.length && wasCritical && lastAlertSignature && env.isProduction && isMailEnabled()) {
      const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
      const sent = await sendEmail({ to: admins.map((admin) => admin.email), subject: "SIGO — operação normalizada", html: emailLayout("Operação normalizada", `<p>Os controlos críticos voltaram ao estado normal.</p><p>Release: ${escapeHtml(health.release)}.</p>`) }, logger);
      if (sent) {
        lastAlertSignature = "";
        lastAlertAt = Date.now();
      }
    }
    wasCritical = critical.length > 0;
    return health;
  } catch (error) {
    logger?.error({ err: error }, "Operational health monitor failed");
    return null;
  }
}

export function startOperationalHealthMonitor(logger?: { info: (data: unknown, message?: string) => void; error: (data: unknown, message?: string) => void }) {
  const intervalMs = Math.max(60_000, env.operationalCheckIntervalMs);
  const first = setTimeout(() => { void runOperationalHealthMonitor(logger); }, 30_000);
  first.unref();
  const timer = setInterval(() => { void runOperationalHealthMonitor(logger); }, intervalMs);
  timer.unref();
  logger?.info({ intervalMinutes: Math.round(intervalMs / 60_000) }, "Operational health monitor started");
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    logger?.info({}, "Operational health monitor stopped");
  };
}
