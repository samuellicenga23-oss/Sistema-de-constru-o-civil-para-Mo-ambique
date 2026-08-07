import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { subscriptions, companies, users } from "../db/schema.js";
import { sendEmail, emailLayout, escapeHtml } from "./mailer.js";
import { env } from "../env.js";
import { getPlanDefinition } from "@sigo/shared";

// Avisa 7 dias e 1 dia antes da subscrição expirar. Corre uma vez por dia; o gatilho é a
// diferença EXACTA de dias (não um intervalo), para nunca reenviar o mesmo aviso em dias
// seguintes sem precisar de guardar "já avisei" numa coluna nova.
const REMINDER_DAY_THRESHOLDS = [7, 1] as const;

function daysUntil(date: Date, now: Date): number {
  // Diff em dias de calendário UTC (ignora hora) — evita saltar 7/1 por causa da hora do job.
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

export async function runSubscriptionExpiryReminders(
  logger?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void },
): Promise<{ checked: number; remindersSent: number }> {
  const now = new Date();
  const active = await db
    .select({
      companyId: subscriptions.companyId,
      plan: subscriptions.plan,
      expiresAt: subscriptions.expiresAt,
      companyName: companies.name,
    })
    .from(subscriptions)
    .innerJoin(companies, eq(companies.id, subscriptions.companyId))
    .where(and(eq(subscriptions.status, "activo"), isNotNull(subscriptions.expiresAt)));

  let remindersSent = 0;
  for (const sub of active) {
    if (!sub.expiresAt) continue;
    const days = daysUntil(sub.expiresAt, now);
    if (!(REMINDER_DAY_THRESHOLDS as readonly number[]).includes(days)) continue;

    const adminRows = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.companyId, sub.companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
    const emails = adminRows.map((r) => r.email);
    if (!emails.length) continue;

    const sent = await sendEmail(
      {
        to: emails,
        subject: days === 1 ? "SIGO — A sua subscrição expira amanhã" : `SIGO — A sua subscrição expira em ${days} dias`,
        html: emailLayout(
          days === 1 ? "A subscrição expira amanhã" : `A subscrição expira em ${days} dias`,
          `<p>A subscrição de <strong>${escapeHtml(sub.companyName)}</strong> ao plano <strong>${escapeHtml(getPlanDefinition(sub.plan).label)}</strong> expira em <strong>${escapeHtml(sub.expiresAt.toLocaleDateString("pt-PT"))}</strong>.</p>
           <p>Envie o comprovativo do próximo período em «Créditos e planos» para não perder o acesso.</p>`,
          `${env.publicUrl}/creditos`,
          "Renovar agora",
        ),
      },
      logger,
    );
    if (sent) remindersSent++;
  }

  logger?.info({ checked: active.length, remindersSent }, "Subscription expiry reminders finished");
  return { checked: active.length, remindersSent };
}

let reminderTimer: ReturnType<typeof setInterval> | null = null;
let reminderRunning = false;

export function startSubscriptionReminderScheduler(logger: {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}) {
  if (reminderTimer) return;

  const tick = async () => {
    if (reminderRunning) return;
    reminderRunning = true;
    try {
      await runSubscriptionExpiryReminders(logger);
    } catch (error) {
      logger.error(error, "Subscription expiry reminder job failed");
    } finally {
      reminderRunning = false;
    }
  };

  const initial = setTimeout(() => {
    void tick();
  }, 10 * 60 * 1000);
  initial.unref?.();

  reminderTimer = setInterval(() => {
    void tick();
  }, 24 * 60 * 60 * 1000);
  reminderTimer.unref?.();

  logger.info({}, "Subscription reminder scheduler started");
}
