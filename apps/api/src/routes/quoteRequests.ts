import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  suppliers,
  supplierAccounts,
  quoteRequests,
  quoteRequestLines,
  materials,
  labourCategories,
  equipment,
  projects,
  supplierMaterialPrices,
  supplierLabourPrices,
  supplierEquipmentPrices,
} from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { sendEmail, emailLayout, escapeHtml } from "../services/mailer.js";
import { fanOutSigoPriceToAllCompanies } from "../services/sigoPrices.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";
import { resolveBuyerContact, type BuyerContact } from "../services/buyerContact.js";
import { notifySupplierAccount } from "../services/notifications.js";
import { buildQuoteComparisonDocument, buildQuoteComparisonPdf } from "../services/quoteComparisonPdf.js";
import { loadCompanyBrand } from "../services/companyBrand.js";
import { env } from "../env.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

// A ficha SIGO Preços da própria empresa (companyId = a empresa) OU qualquer fornecedor do
// marketplace nacional (companyId null, registado directamente no SIGO Fornecedores).
async function assertSupplierAccessible(supplierId: string, companyId: string) {
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), or(eq(suppliers.companyId, companyId), isNull(suppliers.companyId))))
    .limit(1);
  return supplier ?? null;
}

const lineSchema = z.object({
  kind: z.enum(["material", "labour", "equipment"]),
  resourceId: z.string().uuid(),
  quantity: z.number().positive({ message: "Indique a quantidade necessária" }),
});

const createQuoteRequestSchema = z.object({
  supplierId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(2000).optional(),
  deadlineDate: z.string().trim().optional().nullable(),
  lines: z.array(lineSchema).min(1).max(200),
});

async function resolveLine(companyId: string, line: z.infer<typeof lineSchema>) {
  if (line.kind === "material") {
    const [row] = await db
      .select({ name: materials.name, unit: materials.unit })
      .from(materials)
      .where(and(eq(materials.id, line.resourceId), or(isNull(materials.companyId), eq(materials.companyId, companyId))))
      .limit(1);
    if (!row) return null;
    return { description: row.name, unit: row.unit, materialId: line.resourceId };
  }
  if (line.kind === "labour") {
    const [row] = await db
      .select({ name: labourCategories.name })
      .from(labourCategories)
      .where(and(eq(labourCategories.id, line.resourceId), or(isNull(labourCategories.companyId), eq(labourCategories.companyId, companyId))))
      .limit(1);
    if (!row) return null;
    return { description: row.name, unit: "h", labourCategoryId: line.resourceId };
  }
  const [row] = await db
    .select({ name: equipment.name })
    .from(equipment)
    .where(and(eq(equipment.id, line.resourceId), or(isNull(equipment.companyId), eq(equipment.companyId, companyId))))
    .limit(1);
  if (!row) return null;
  return { description: row.name, unit: "h", equipmentId: line.resourceId };
}

async function notifySupplierOfRequest(accountId: string | null, accountEmail: string | null, accountName: string, buyer: BuyerContact, title: string) {
  if (!accountId) return;
  const contactLines = [
    buyer.buyerName ? `<strong>${escapeHtml(buyer.buyerName)}</strong>` : null,
    buyer.buyerEmail ? escapeHtml(buyer.buyerEmail) : null,
    buyer.companyPhone ? escapeHtml(buyer.companyPhone) : null,
  ].filter(Boolean);
  if (accountEmail) {
    void sendEmail(
      {
        to: accountEmail,
        subject: `SIGO — Novo pedido de cotação de ${buyer.companyName}`,
        html: emailLayout(
          "Novo pedido de cotação",
          `<p>Olá ${escapeHtml(accountName)}, a empresa <strong>${escapeHtml(buyer.companyName)}</strong> pediu-lhe uma cotação: <strong>${escapeHtml(title)}</strong>.</p>
           ${contactLines.length ? `<p><strong>Contacto de compras</strong> — ${contactLines.join(" · ")}. Ligue directamente para ajudar a fechar esta compra.</p>` : ""}
           <p>Entre no seu Portal do Fornecedor para ver os itens e responder com os seus preços.</p>`,
          `${env.supplierPublicUrl}/login`,
          "Abrir Portal do Fornecedor",
        ),
      },
      undefined,
    );
  }
  await notifySupplierAccount(accountId, "Novo pedido de cotação", `${buyer.companyName} pediu-lhe uma cotação: ${title}.`, "/oportunidades");
}

async function supplierAccountOf(supplierId: string): Promise<{ id: string; email: string; name: string } | null> {
  const [supplier] = await db.select({ supplierAccountId: suppliers.supplierAccountId, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier?.supplierAccountId) return null;
  const [account] = await db.select({ id: supplierAccounts.id, email: supplierAccounts.email, name: supplierAccounts.name }).from(supplierAccounts).where(eq(supplierAccounts.id, supplier.supplierAccountId)).limit(1);
  if (!account) return null;
  return account;
}

// O fornecedor respondeu e ficou à espera — sem isto, só descobre que a empresa desistiu (ou
// aceitou) se voltar a abrir o Portal por iniciativa própria.
async function notifySupplierOfCancellation(supplierId: string, title: string) {
  const account = await supplierAccountOf(supplierId);
  if (!account) return;
  if (account.email) {
    void sendEmail(
      {
        to: account.email,
        subject: `SIGO — Pedido de cotação cancelado: ${title}`,
        html: emailLayout(
          "Pedido de cotação cancelado",
          `<p>Olá ${escapeHtml(account.name)}, o pedido de cotação <strong>${escapeHtml(title)}</strong> foi cancelado pela empresa — não é preciso responder.</p>`,
          `${env.supplierPublicUrl}/login`,
          "Abrir Portal do Fornecedor",
        ),
      },
      undefined,
    );
  }
  await notifySupplierAccount(account.id, "Pedido de cotação cancelado", `O pedido "${title}" foi cancelado pela empresa — não é preciso responder.`, "/oportunidades");
}

async function notifySupplierOfAcceptance(supplierId: string, title: string) {
  const account = await supplierAccountOf(supplierId);
  if (!account) return;
  if (account.email) {
    void sendEmail(
      {
        to: account.email,
        subject: `SIGO — A sua cotação foi aceite: ${title}`,
        html: emailLayout(
          "Cotação aceite",
          `<p>Olá ${escapeHtml(account.name)}, a sua cotação para <strong>${escapeHtml(title)}</strong> foi aceite. Prepare a entrega conforme os preços indicados.</p>`,
          `${env.supplierPublicUrl}/login`,
          "Abrir Portal do Fornecedor",
        ),
      },
      undefined,
    );
  }
  await notifySupplierAccount(account.id, "Cotação aceite", `A sua cotação para "${title}" foi aceite. Prepare a entrega conforme os preços indicados.`, "/oportunidades");
}

export async function quoteRequestRoutes(app: FastifyInstance) {
  // ---------- Pedidos de cotação (RFQ) ----------
  // O convite/registo de fornecedores deixou de ser feito por cada empresa — fornecedores
  // registam-se sozinhos no SIGO Fornecedores (ver routes/supplierAuth.ts:register). Pedir uma
  // cotação a um fornecedor do marketplace (não a própria ficha SIGO Preços) exige o plano
  // Profissional.
  app.post("/api/quote-requests", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const companyId = companyIdOf(request);
    const parsed = createQuoteRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const supplier = await assertSupplierAccessible(parsed.data.supplierId, companyId);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    if (supplier.companyId === null) {
      const blocked = await assertSupplierMarketplaceAccess(companyId);
      if (blocked) return reply.code(402).send(blocked);
    }
    if (!supplier.supplierAccountId) {
      return reply.code(409).send({ error: "Este fornecedor ainda não tem conta activa no Portal do Fornecedor" });
    }

    if (parsed.data.projectId) {
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, parsed.data.projectId), eq(projects.companyId, companyId))).limit(1);
      if (!project) return reply.code(404).send({ error: "Obra não encontrada" });
    }

    const resolvedLines: Array<Awaited<ReturnType<typeof resolveLine>> & { kind: "material" | "labour" | "equipment"; quantity?: number }> = [];
    for (const line of parsed.data.lines) {
      const resolved = await resolveLine(companyId, line);
      if (!resolved) return reply.code(404).send({ error: `Item não encontrado no Catálogo (${line.kind})` });
      resolvedLines.push({ ...resolved, kind: line.kind, quantity: line.quantity });
    }

    const [quoteRequest] = await db
      .insert(quoteRequests)
      .values({
        companyId,
        supplierId: parsed.data.supplierId,
        projectId: parsed.data.projectId ?? null,
        createdByUserId: request.currentUser!.id,
        title: parsed.data.title,
        message: parsed.data.message ?? null,
        deadlineDate: parsed.data.deadlineDate || null,
      })
      .returning();

    await db.insert(quoteRequestLines).values(
      resolvedLines.map((line, index) => ({
        quoteRequestId: quoteRequest.id,
        kind: line.kind,
        materialId: line.materialId ?? null,
        labourCategoryId: line.labourCategoryId ?? null,
        equipmentId: line.equipmentId ?? null,
        description: line.description!,
        unit: line.unit ?? null,
        quantity: line.quantity != null ? line.quantity.toString() : null,
        sortOrder: index,
      })),
    );

    const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.id, supplier.supplierAccountId)).limit(1);
    const buyer = await resolveBuyerContact(companyId, request.currentUser!.id);
    await notifySupplierOfRequest(account?.id ?? null, account?.email ?? null, account?.name ?? supplier.name, buyer, parsed.data.title);

    return reply.code(201).send(quoteRequest);
  });

  app.get("/api/quote-requests", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = companyIdOf(request);
    const rows = await db
      .select({ quoteRequest: quoteRequests, supplierName: suppliers.name, projectName: projects.name })
      .from(quoteRequests)
      .innerJoin(suppliers, eq(quoteRequests.supplierId, suppliers.id))
      .leftJoin(projects, eq(quoteRequests.projectId, projects.id))
      .where(eq(quoteRequests.companyId, companyId))
      .orderBy(desc(quoteRequests.createdAt));
    return rows.map((r) => ({ ...r.quoteRequest, supplierName: r.supplierName, projectName: r.projectName }));
  });

  app.get("/api/quote-requests/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const [row] = await db
      .select({ quoteRequest: quoteRequests, supplierName: suppliers.name, projectName: projects.name })
      .from(quoteRequests)
      .innerJoin(suppliers, eq(quoteRequests.supplierId, suppliers.id))
      .leftJoin(projects, eq(quoteRequests.projectId, projects.id))
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.companyId, companyId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Pedido não encontrado" });
    const lines = await db.select().from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, id)).orderBy(quoteRequestLines.sortOrder);
    return { ...row.quoteRequest, supplierName: row.supplierName, projectName: row.projectName, lines };
  });

  // PDF de comparação: para cada item do pedido, lista fornecedores com preço na zona da obra
  // (proximidade) e ordena do melhor custo ao mais caro, com contactos. Profissional+.
  app.get("/api/quote-requests/:id/comparison.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    try {
      const result = await buildQuoteComparisonDocument(companyId, id);
      if ("blocked" in result && result.blocked) return reply.code(402).send(result.blocked);
      if (!("document" in result)) return reply.code(404).send({ error: "Pedido não encontrado" });
      const brand = await loadCompanyBrand(companyId);
      const buffer = await buildQuoteComparisonPdf(result.document, brand);
      const safeTitle = result.document.title.replace(/[^\w\- ]/g, "").slice(0, 80) || "cotacao";
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="Comparacao fornecedores - ${safeTitle}.pdf"`)
        .send(buffer);
    } catch (err) {
      const status = err && typeof err === "object" && "statusCode" in err ? Number((err as { statusCode: number }).statusCode) : 500;
      if (status === 404) return reply.code(404).send({ error: "Pedido não encontrado" });
      throw err;
    }
  });

  app.post("/api/quote-requests/:id/cancel", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const [existing] = await db
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.companyId, companyId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: "Pedido não encontrado" });
    if (existing.status === "aceite") {
      return reply.code(409).send({ error: "Não é possível cancelar um pedido já aceite — as cotações do fornecedor já foram guardadas." });
    }
    if (existing.status === "cancelado" || existing.status === "recusado" || existing.status === "expirado") {
      return reply.code(409).send({ error: `Este pedido já está ${existing.status}.` });
    }
    const [updated] = await db
      .update(quoteRequests)
      .set({ status: "cancelado" })
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.companyId, companyId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: "Pedido não encontrado" });
    await notifySupplierOfCancellation(updated.supplierId, updated.title);
    return updated;
  });

  // Guarda os preços respondidos nas cotações do fornecedor (supplier_*_prices) —
  // referência de compra/mercado. NÃO altera o preço base do catálogo (materials.baseUnitCost,
  // zonas, mão-de-obra, equipamentos) usado nas composições e orçamentos.
  app.post("/api/quote-requests/:id/accept", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const [quoteRequest] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.id, id), eq(quoteRequests.companyId, companyId))).limit(1);
    if (!quoteRequest) return reply.code(404).send({ error: "Pedido não encontrado" });
    if (quoteRequest.status !== "respondido") return reply.code(409).send({ error: "Só pode aceitar pedidos já respondidos pelo fornecedor" });

    const lines = await db.select().from(quoteRequestLines).where(eq(quoteRequestLines.quoteRequestId, id));
    if (!lines.length || lines.some((line) => line.unitCost == null)) {
      return reply.code(409).send({ error: "A cotação está incompleta — o fornecedor tem de indicar preço em todos os itens." });
    }

    await db.transaction(async (tx) => {
      for (const line of lines) {
        if (line.unitCost == null) continue;
        if (line.kind === "material" && line.materialId) {
          const existing = await tx
            .select()
            .from(supplierMaterialPrices)
            .where(and(eq(supplierMaterialPrices.supplierId, quoteRequest.supplierId), eq(supplierMaterialPrices.materialId, line.materialId), isNull(supplierMaterialPrices.zoneId)))
            .limit(1);
          if (existing[0]) {
            await tx.update(supplierMaterialPrices).set({ unitCost: line.unitCost, currency: line.currency }).where(eq(supplierMaterialPrices.id, existing[0].id));
          } else {
            await tx.insert(supplierMaterialPrices).values({ supplierId: quoteRequest.supplierId, materialId: line.materialId, unitCost: line.unitCost, currency: line.currency });
          }
        } else if (line.kind === "labour" && line.labourCategoryId) {
          const existing = await tx
            .select()
            .from(supplierLabourPrices)
            .where(and(eq(supplierLabourPrices.supplierId, quoteRequest.supplierId), eq(supplierLabourPrices.labourCategoryId, line.labourCategoryId), isNull(supplierLabourPrices.zoneId)))
            .limit(1);
          if (existing[0]) {
            await tx.update(supplierLabourPrices).set({ hourlyCost: line.unitCost, currency: line.currency }).where(eq(supplierLabourPrices.id, existing[0].id));
          } else {
            await tx.insert(supplierLabourPrices).values({ supplierId: quoteRequest.supplierId, labourCategoryId: line.labourCategoryId, hourlyCost: line.unitCost, currency: line.currency });
          }
        } else if (line.kind === "equipment" && line.equipmentId) {
          const existing = await tx
            .select()
            .from(supplierEquipmentPrices)
            .where(and(eq(supplierEquipmentPrices.supplierId, quoteRequest.supplierId), eq(supplierEquipmentPrices.equipmentId, line.equipmentId), isNull(supplierEquipmentPrices.zoneId)))
            .limit(1);
          if (existing[0]) {
            await tx.update(supplierEquipmentPrices).set({ hourlyCost: line.unitCost, currency: line.currency }).where(eq(supplierEquipmentPrices.id, existing[0].id));
          } else {
            await tx.insert(supplierEquipmentPrices).values({ supplierId: quoteRequest.supplierId, equipmentId: line.equipmentId, hourlyCost: line.unitCost, currency: line.currency });
          }
        }
      }
      await tx.update(quoteRequests).set({ status: "aceite", acceptedAt: new Date() }).where(eq(quoteRequests.id, id));
    });

    // Se este pedido foi respondido pela conta global "SIGO Preços", o preço aceite passa a
    // valer também para as outras empresas ligadas à mesma conta (cotações de fornecedor /
    // referência de mercado — não o preço base de orçamentação de cada empresa).
    for (const line of lines) {
      if (line.unitCost == null || line.kind !== "material" || !line.materialId) continue;
      await fanOutSigoPriceToAllCompanies(quoteRequest.supplierId, line.materialId, line.unitCost, line.currency);
    }

    await notifySupplierOfAcceptance(quoteRequest.supplierId, quoteRequest.title);

    const [updated] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)).limit(1);
    return updated;
  });
}
