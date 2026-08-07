import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { quoteRequests, suppliers, supplierAccounts, users } from "../db/schema.js";
import { sendEmail, emailLayout, escapeHtml } from "./mailer.js";
import { notifySupplierAccount, notifyUsers } from "./notifications.js";
import { env } from "../env.js";

// Sem isto, um pedido com prazo indicado fica "enviado"/"respondido" para sempre mesmo depois do
// prazo passar — nem a empresa nem o fornecedor são avisados de que a janela fechou, e o pedido
// continua a aparecer como se ainda estivesse activo.
export async function runQuoteRequestExpiry(logger?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }): Promise<{ expired: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = await db
    .select()
    .from(quoteRequests)
    .where(and(inArray(quoteRequests.status, ["enviado", "respondido"]), lt(quoteRequests.deadlineDate, today)));

  for (const request of overdue) {
    await db.update(quoteRequests).set({ status: "expirado" }).where(eq(quoteRequests.id, request.id));

    const [supplier] = await db.select({ supplierAccountId: suppliers.supplierAccountId }).from(suppliers).where(eq(suppliers.id, request.supplierId)).limit(1);
    if (supplier?.supplierAccountId) {
      const [account] = await db.select({ email: supplierAccounts.email, name: supplierAccounts.name }).from(supplierAccounts).where(eq(supplierAccounts.id, supplier.supplierAccountId)).limit(1);
      if (account?.email) {
        void sendEmail(
          {
            to: account.email,
            subject: `SIGO — Pedido de cotação expirado: ${request.title}`,
            html: emailLayout(
              "Pedido de cotação expirado",
              `<p>Olá ${escapeHtml(account.name)}, o prazo do pedido de cotação <strong>${escapeHtml(request.title)}</strong> passou sem resposta a tempo — já não pode ser respondido.</p>`,
              `${env.supplierPublicUrl}/login`,
              "Abrir Portal do Fornecedor",
            ),
          },
          logger,
        );
      }
      await notifySupplierAccount(supplier.supplierAccountId, "Pedido de cotação expirado", `O prazo do pedido "${request.title}" passou — já não pode ser respondido.`, "/painel");
    }

    const admins = await db.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.companyId, request.companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
    if (admins.length) {
      void sendEmail(
        {
          to: admins.map((a) => a.email),
          subject: `SIGO — Pedido de cotação expirou sem resposta: ${request.title}`,
          html: emailLayout(
            "Pedido de cotação expirado",
            `<p>O prazo do pedido <strong>${escapeHtml(request.title)}</strong> passou ${request.status === "respondido" ? "sem ter sido aceite" : "sem resposta do fornecedor"}.</p>
             <p>Pode enviar um novo pedido a outro fornecedor em Gestão da obra → Cotações.</p>`,
            `${env.publicUrl}/gestao/cotacoes`,
            "Ver cotações",
          ),
        },
        logger,
      );
      await notifyUsers(admins.map((a) => a.id), "Pedido de cotação expirado", `O prazo do pedido "${request.title}" passou ${request.status === "respondido" ? "sem ter sido aceite" : "sem resposta do fornecedor"}.`, "/gestao/cotacoes");
    }
  }

  logger?.info({ expired: overdue.length }, "Quote request expiry finished");
  return { expired: overdue.length };
}

let expiryTimer: ReturnType<typeof setInterval> | null = null;
let expiryRunning = false;

export function startQuoteRequestExpiryScheduler(logger: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  if (expiryTimer) return;

  const tick = async () => {
    if (expiryRunning) return;
    expiryRunning = true;
    try {
      await runQuoteRequestExpiry(logger);
    } catch (error) {
      logger.error(error, "Quote request expiry job failed");
    } finally {
      expiryRunning = false;
    }
  };

  const initial = setTimeout(() => void tick(), 8 * 60 * 1000);
  initial.unref?.();

  expiryTimer = setInterval(() => void tick(), 24 * 60 * 60 * 1000);
  expiryTimer.unref?.();

  logger.info({}, "Quote request expiry scheduler started");
}
