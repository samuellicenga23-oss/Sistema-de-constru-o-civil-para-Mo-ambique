import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { supplierAccounts, suppliers, companies, quoteRequests, quoteRequestStatusEnum, supplierPriceFeeds } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { sendEmail, emailLayout } from "../services/mailer.js";
import { env } from "../env.js";

// Visão do Portal do Fornecedor a partir do Centro de Controlo SIGO — não é o mesmo painel nem o
// mesmo site que os fornecedores usam (ver apps/supplier), só uma janela de leitura/gestão para a
// equipa SIGO acompanhar quem está ligado, quem ainda não activou a conta, e o estado dos pedidos.
export async function adminSupplierRoutes(app: FastifyInstance) {
  app.get("/api/admin/supplier-accounts", { preHandler: requireRole("super_admin") }, async () => {
    const accounts = await db.select().from(supplierAccounts).orderBy(supplierAccounts.createdAt);
    if (!accounts.length) return [];
    const accountIds = accounts.map((a) => a.id);

    const links = await db
      .select({ supplierAccountId: suppliers.supplierAccountId, companyName: companies.name, companyId: companies.id, supplierId: suppliers.id })
      .from(suppliers)
      .innerJoin(companies, eq(suppliers.companyId, companies.id))
      .where(inArray(suppliers.supplierAccountId, accountIds));

    const linkedSupplierIds = links.map((l) => l.supplierId);
    const quoteCounts = linkedSupplierIds.length
      ? await db
          .select({ supplierId: quoteRequests.supplierId, status: quoteRequests.status, total: count() })
          .from(quoteRequests)
          .where(inArray(quoteRequests.supplierId, linkedSupplierIds))
          .groupBy(quoteRequests.supplierId, quoteRequests.status)
      : [];

    const linksByAccount = new Map<string, typeof links>();
    for (const link of links) {
      if (!link.supplierAccountId) continue;
      const list = linksByAccount.get(link.supplierAccountId) ?? [];
      list.push(link);
      linksByAccount.set(link.supplierAccountId, list);
    }
    const quoteCountsBySupplier = new Map<string, Record<string, number>>();
    for (const row of quoteCounts) {
      const bucket = quoteCountsBySupplier.get(row.supplierId) ?? {};
      bucket[row.status] = row.total;
      quoteCountsBySupplier.set(row.supplierId, bucket);
    }

    return accounts.map((account) => {
      const accountLinks = linksByAccount.get(account.id) ?? [];
      const statusTotals: Record<string, number> = {};
      for (const link of accountLinks) {
        const bucket = quoteCountsBySupplier.get(link.supplierId) ?? {};
        for (const [status, total] of Object.entries(bucket)) statusTotals[status] = (statusTotals[status] ?? 0) + total;
      }
      return {
        id: account.id,
        name: account.name,
        email: account.email,
        phone: account.phone,
        isActive: account.isActive,
        activated: Boolean(account.emailVerifiedAt),
        createdAt: account.createdAt,
        companies: accountLinks.map((l) => ({ companyId: l.companyId, companyName: l.companyName })),
        quoteRequestsByStatus: statusTotals,
      };
    });
  });

  app.post("/api/admin/supplier-accounts/:id/resend-invite", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.id, id)).limit(1);
    if (!account) return reply.code(404).send({ error: "Conta não encontrada" });
    if (account.passwordHash) return reply.code(409).send({ error: "Esta conta já está activada" });

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.update(supplierAccounts).set({ inviteToken: token, inviteTokenExpiresAt: expiresAt }).where(eq(supplierAccounts.id, id));

    await sendEmail(
      {
        to: account.email,
        subject: "SIGO — Convite para o Portal do Fornecedor (reenviado)",
        html: emailLayout(
          "Convite para o Portal do Fornecedor",
          `<p>Foi convidado(a) a juntar-se ao Portal do Fornecedor SIGO, onde pode ver e responder aos pedidos de cotação das empresas com quem trabalha.</p>
           <p>Defina a sua palavra-passe para começar.</p>`,
          `${env.supplierPublicUrl}/aceitar-convite?token=${token}`,
          "Definir palavra-passe",
        ),
      },
      app.log,
    );

    return { ok: true };
  });

  app.get("/api/admin/quote-requests/stats", { preHandler: requireRole("super_admin") }, async () => {
    const rows = await db.select({ status: quoteRequests.status, total: count() }).from(quoteRequests).groupBy(quoteRequests.status);
    const byStatus: Record<string, number> = Object.fromEntries(quoteRequestStatusEnum.enumValues.map((s) => [s, 0]));
    for (const row of rows) byStatus[row.status] = row.total;
    const [feedStats] = await db
      .select({ total: count() })
      .from(supplierPriceFeeds)
      .where(eq(supplierPriceFeeds.isActive, true));
    return { byStatus, activeFeeds: feedStats?.total ?? 0 };
  });
}
