import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  supplierAccounts,
  suppliers,
  companies,
  quoteRequests,
  quoteRequestStatusEnum,
  supplierPriceFeeds,
  priceZones,
} from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { sendEmail, emailLayout } from "../services/mailer.js";
import { env } from "../env.js";
import { hashPassword } from "../auth/password.js";
import { deleteAllSupplierSessions } from "../auth/supplierSession.js";
import { ensureSigoMarketplaceSupplier, isSigoPricesAccount } from "../services/sigoPrices.js";

// Visão do Portal do Fornecedor a partir do Centro de Controlo SIGO — criar contas, repor
// palavra-passe, activar/desactivar e acompanhar quem está ligado.
export async function adminSupplierRoutes(app: FastifyInstance) {
  app.get("/api/admin/supplier-accounts", { preHandler: requireRole("super_admin") }, async () => {
    const accounts = await db.select().from(supplierAccounts).orderBy(supplierAccounts.createdAt);
    if (!accounts.length) return [];
    const accountIds = accounts.map((a) => a.id);

    const links = await db
      .select({
        supplierAccountId: suppliers.supplierAccountId,
        companyName: companies.name,
        companyId: companies.id,
        supplierId: suppliers.id,
        marketplace: suppliers.companyId,
      })
      .from(suppliers)
      .leftJoin(companies, eq(suppliers.companyId, companies.id))
      .where(inArray(suppliers.supplierAccountId, accountIds));

    const companyLinks = links.filter((l) => l.companyId);
    const linkedSupplierIds = companyLinks.map((l) => l.supplierId);
    const quoteCounts = linkedSupplierIds.length
      ? await db
          .select({ supplierId: quoteRequests.supplierId, status: quoteRequests.status, total: count() })
          .from(quoteRequests)
          .where(inArray(quoteRequests.supplierId, linkedSupplierIds))
          .groupBy(quoteRequests.supplierId, quoteRequests.status)
      : [];

    const linksByAccount = new Map<string, typeof companyLinks>();
    for (const link of companyLinks) {
      if (!link.supplierAccountId) continue;
      const list = linksByAccount.get(link.supplierAccountId) ?? [];
      list.push(link);
      linksByAccount.set(link.supplierAccountId, list);
    }
    const marketplaceByAccount = new Set(
      links.filter((l) => l.supplierAccountId && l.marketplace == null).map((l) => l.supplierAccountId as string),
    );
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
        hasMarketplaceProfile: marketplaceByAccount.has(account.id),
        companies: accountLinks.map((l) => ({ companyId: l.companyId!, companyName: l.companyName! })),
        quoteRequestsByStatus: statusTotals,
      };
    });
  });

  const createSchema = z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).optional().nullable(),
    zoneId: z.string().uuid().optional().nullable(),
    password: z.string().min(8).max(100).optional(),
    sendInvite: z.boolean().optional().default(true),
  });

  app.post("/api/admin/supplier-accounts", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const email = parsed.data.email.trim().toLowerCase();
    const [existing] = await db.select({ id: supplierAccounts.id }).from(supplierAccounts).where(eq(supplierAccounts.email, email)).limit(1);
    if (existing) return reply.code(409).send({ error: "Já existe uma conta com este email" });

    let zoneId = parsed.data.zoneId ?? null;
    if (zoneId) {
      const [zone] = await db.select({ id: priceZones.id }).from(priceZones).where(and(eq(priceZones.id, zoneId), isNull(priceZones.companyId))).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });
    } else {
      const [zone] = await db.select().from(priceZones).where(isNull(priceZones.companyId)).orderBy(priceZones.name).limit(1);
      zoneId = zone?.id ?? null;
    }

    const password = parsed.data.password;
    const token = password ? null : randomBytes(32).toString("hex");
    const expiresAt = token ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;
    const passwordHash = password ? await hashPassword(password) : null;

    const [account] = await db
      .insert(supplierAccounts)
      .values({
        name: parsed.data.name,
        email,
        phone: parsed.data.phone || null,
        passwordHash,
        emailVerifiedAt: password ? new Date() : null,
        inviteToken: token,
        inviteTokenExpiresAt: expiresAt,
        isActive: true,
      })
      .returning();

    if (isSigoPricesAccount(account)) {
      await ensureSigoMarketplaceSupplier();
    } else {
      const [zone] = zoneId
        ? await db.select().from(priceZones).where(eq(priceZones.id, zoneId)).limit(1)
        : [null];
      await db.insert(suppliers).values({
        companyId: null,
        name: account.name,
        contact: account.phone,
        supplierAccountId: account.id,
        zoneId: zone?.id ?? null,
        location: zone?.name ?? "Moçambique",
      });
    }

    if (!password && token && parsed.data.sendInvite !== false) {
      await sendEmail(
        {
          to: account.email,
          subject: "SIGO — Convite para o Portal do Fornecedor",
          html: emailLayout(
            "Convite para o Portal do Fornecedor",
            `<p>A equipa SIGO criou a sua conta no Portal do Fornecedor. Defina a palavra-passe para começar a indicar preços e responder a pedidos de cotação.</p>`,
            `${env.supplierPublicUrl}/aceitar-convite?token=${token}`,
            "Definir palavra-passe",
          ),
        },
        app.log,
      );
    }

    return reply.code(201).send({
      id: account.id,
      name: account.name,
      email: account.email,
      phone: account.phone,
      isActive: account.isActive,
      activated: Boolean(account.emailVerifiedAt),
      temporaryPassword: password ?? undefined,
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

  const resetSchema = z.object({
    password: z.string().min(8).max(100),
  });

  app.post("/api/admin/supplier-accounts/:id/reset-password", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.id, id)).limit(1);
    if (!account) return reply.code(404).send({ error: "Conta não encontrada" });

    const passwordHash = await hashPassword(parsed.data.password);
    await db
      .update(supplierAccounts)
      .set({
        passwordHash,
        emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
        inviteToken: null,
        inviteTokenExpiresAt: null,
      })
      .where(eq(supplierAccounts.id, id));
    await deleteAllSupplierSessions(id);

    return { ok: true };
  });

  const patchSchema = z.object({
    isActive: z.boolean().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().max(40).optional().nullable(),
  });

  app.patch("/api/admin/supplier-accounts/:id", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: "Nada para actualizar" });

    const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.id, id)).limit(1);
    if (!account) return reply.code(404).send({ error: "Conta não encontrada" });

    const [row] = await db
      .update(supplierAccounts)
      .set({
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
      })
      .where(eq(supplierAccounts.id, id))
      .returning();

    if (parsed.data.isActive === false) {
      await deleteAllSupplierSessions(id);
    }

    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      isActive: row.isActive,
      activated: Boolean(row.emailVerifiedAt),
    };
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
