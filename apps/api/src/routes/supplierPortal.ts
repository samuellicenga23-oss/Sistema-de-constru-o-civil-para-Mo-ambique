import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { suppliers, companies, quoteRequests, quoteRequestLines, projects, users } from "../db/schema.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { sendEmail, emailLayout, escapeHtml } from "../services/mailer.js";
import { env } from "../env.js";

function supplierAccountIdOf(request: FastifyRequest): string {
  return request.currentSupplier!.id;
}

// Todas as fichas `suppliers` (uma por empresa) ligadas a esta conta global — é isto que faz o
// fornecedor ver, num só login, todas as empresas SIGO com quem trabalha.
async function ownedSupplierIds(supplierAccountId: string): Promise<string[]> {
  const rows = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.supplierAccountId, supplierAccountId));
  return rows.map((r) => r.id);
}

export async function supplierPortalRoutes(app: FastifyInstance) {
  // Empresas com quem este fornecedor está ligado — usado no ecrã inicial do portal.
  app.get("/api/supplier/companies", { preHandler: requireSupplierAuth }, async (request) => {
    const rows = await db
      .select({ supplierId: suppliers.id, companyId: companies.id, companyName: companies.name, brandName: companies.brandName })
      .from(suppliers)
      .innerJoin(companies, eq(suppliers.companyId, companies.id))
      .where(eq(suppliers.supplierAccountId, supplierAccountIdOf(request)));
    return rows.map((r) => ({ companyId: r.companyId, companyName: r.brandName || r.companyName }));
  });

  app.get("/api/supplier/quote-requests", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await ownedSupplierIds(supplierAccountIdOf(request));
    if (!supplierIds.length) return [];
    const rows = await db
      .select({ quoteRequest: quoteRequests, companyName: companies.name, brandName: companies.brandName, projectName: projects.name })
      .from(quoteRequests)
      .innerJoin(companies, eq(quoteRequests.companyId, companies.id))
      .leftJoin(projects, eq(quoteRequests.projectId, projects.id))
      .where(inArray(quoteRequests.supplierId, supplierIds))
      .orderBy(desc(quoteRequests.createdAt));
    return rows.map((r) => ({ ...r.quoteRequest, companyName: r.brandName || r.companyName, projectName: r.projectName }));
  });

  app.get("/api/supplier/quote-requests/:id", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await ownedSupplierIds(supplierAccountIdOf(request));
    const [row] = await db
      .select({ quoteRequest: quoteRequests, companyName: companies.name, brandName: companies.brandName, projectName: projects.name })
      .from(quoteRequests)
      .innerJoin(companies, eq(quoteRequests.companyId, companies.id))
      .leftJoin(projects, eq(quoteRequests.projectId, projects.id))
      .where(and(eq(quoteRequests.id, id), inArray(quoteRequests.supplierId, supplierIds.length ? supplierIds : ["__none__"])))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Pedido não encontrado" });
    const lines = await db.select().from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, id)).orderBy(quoteRequestLines.sortOrder);
    return { ...row.quoteRequest, companyName: row.brandName || row.companyName, projectName: row.projectName, lines };
  });

  const respondSchema = z.object({
    supplierNotes: z.string().trim().max(2000).optional(),
    lines: z
      .array(
        z.object({
          id: z.string().uuid(),
          unitCost: z.number().nonnegative(),
          notes: z.string().trim().max(500).optional(),
        }),
      )
      .min(1),
  });

  app.post("/api/supplier/quote-requests/:id/respond", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await ownedSupplierIds(supplierAccountIdOf(request));
    const [quoteRequest] = await db
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.id, id), inArray(quoteRequests.supplierId, supplierIds.length ? supplierIds : ["__none__"])))
      .limit(1);
    if (!quoteRequest) return reply.code(404).send({ error: "Pedido não encontrado" });
    // Só pedidos abertos (enviado) ou a rever (respondido) — nunca aceite/cancelado/recusado/expirado.
    if (quoteRequest.status !== "enviado" && quoteRequest.status !== "respondido") {
      return reply.code(409).send({ error: "Este pedido já não pode ser respondido" });
    }

    const parsed = respondSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const existingLines = await db.select({ id: quoteRequestLines.id }).from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, id));
    const existingIds = new Set(existingLines.map((l) => l.id));
    const respondedIds = new Set(parsed.data.lines.map((l) => l.id));
    for (const line of parsed.data.lines) {
      if (!existingIds.has(line.id)) return reply.code(400).send({ error: "Item de cotação inválido" });
    }
    if (existingIds.size === 0 || respondedIds.size !== existingIds.size || ![...existingIds].every((lid) => respondedIds.has(lid))) {
      return reply.code(400).send({ error: "Tem de indicar o preço de todos os itens do pedido" });
    }

    await db.transaction(async (tx) => {
      for (const line of parsed.data.lines) {
        await tx
          .update(quoteRequestLines)
          .set({ unitCost: line.unitCost.toString(), supplierLineNotes: line.notes ?? null })
          .where(eq(quoteRequestLines.id, line.id));
      }
      await tx
        .update(quoteRequests)
        .set({ status: "respondido", supplierNotes: parsed.data.supplierNotes ?? null, respondedAt: new Date() })
        .where(eq(quoteRequests.id, id));
    });

    void notifyCompanyOfResponse(quoteRequest.companyId, request.currentSupplier!.name, quoteRequest.title, app.log);

    const [updated] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)).limit(1);
    return updated;
  });
}

async function notifyCompanyOfResponse(companyId: string, supplierName: string, title: string, logger: unknown) {
  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  const emails = admins.map((a) => a.email);
  if (!emails.length) return;
  void sendEmail(
    {
      to: emails,
      subject: `SIGO — ${supplierName} respondeu à sua cotação`,
      html: emailLayout(
        "Cotação respondida",
        `<p><strong>${escapeHtml(supplierName)}</strong> respondeu ao pedido de cotação <strong>${escapeHtml(title)}</strong>.</p>
         <p>Reveja os preços e aceite a cotação para guardar as cotações deste fornecedor (não altera o preço base do catálogo usado nos orçamentos).</p>`,
        `${env.publicUrl}/fornecedores/pedidos`,
        "Ver pedidos",
      ),
    },
    // sendEmail's logger param typing is a pino instance; pass through what the caller has.
    logger as never,
  );
}
