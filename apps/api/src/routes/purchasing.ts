import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, and, or, isNull, desc, inArray, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import { purchaseOrders, purchaseOrderLines, purchaseRequisitions, purchaseOrderShipments, goodsReceipts, stockMovements, suppliers, materials, budgetDocuments, financialEntries, scheduleTasks, supplierAccounts, materialZonePrices, supplierMaterialPrices, priceZones } from "../db/schema.js";
import { requireCompanyUser, requirePermission, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { assertApprovedOrcamentoForSite } from "../services/siteGate.js";
import { calculateVatTotals, CURRENCIES } from "@sigo/shared";
import { computeProcurementPlan } from "../services/procurementEngine.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";
import { resolveBuyerContact } from "../services/buyerContact.js";
import { notifySupplierAccount } from "../services/notifications.js";
import { sendEmail, emailLayout, escapeHtml } from "../services/mailer.js";
import { env } from "../env.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;
const canRequestMaterials = requirePermission("materiais.requisitar");

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

// Material visível para a empresa (partilhado ou próprio) — mesma regra usada em todo o
// Catálogo: companyId nulo = catálogo global, ou pertence à própria empresa.
async function findVisibleMaterial(materialId: string, companyId: string) {
  const [material] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, materialId), or(isNull(materials.companyId), eq(materials.companyId, companyId))))
    .limit(1);
  return material ?? null;
}

/** Preço sugerido para um pedido rápido: cotação de fornecedor na zona → preço de zona → catálogo. */
async function suggestMaterialUnitCosts(
  materialIds: string[],
  companyId: string,
  zoneId: string | null,
): Promise<Map<string, number>> {
  const unique = [...new Set(materialIds)];
  const result = new Map<string, number>();
  if (!unique.length) return result;

  const materialRows = await db
    .select({
      id: materials.id,
      baseUnitCost: materials.baseUnitCost,
      importFactor: materials.importFactor,
    })
    .from(materials)
    .where(and(inArray(materials.id, unique), or(isNull(materials.companyId), eq(materials.companyId, companyId))));

  let zoneFactor = 1;
  if (zoneId) {
    const [zone] = await db.select().from(priceZones).where(eq(priceZones.id, zoneId)).limit(1);
    if (zone) zoneFactor = 1 + Number(zone.materialAdjustmentPct) / 100;
  }

  const zonePrices = zoneId
    ? await db
        .select({ materialId: materialZonePrices.materialId, unitCost: materialZonePrices.unitCost })
        .from(materialZonePrices)
        .where(and(eq(materialZonePrices.zoneId, zoneId), inArray(materialZonePrices.materialId, unique)))
    : [];
  const zoneByMaterial = new Map(zonePrices.map((r) => [r.materialId, Number(r.unitCost)]));

  const quoteRows = await db
    .select({
      materialId: supplierMaterialPrices.materialId,
      unitCost: supplierMaterialPrices.unitCost,
      zoneId: supplierMaterialPrices.zoneId,
      supplierZoneId: suppliers.zoneId,
      supplierCompanyId: suppliers.companyId,
    })
    .from(supplierMaterialPrices)
    .innerJoin(suppliers, eq(supplierMaterialPrices.supplierId, suppliers.id))
    .where(
      and(
        or(eq(suppliers.companyId, companyId), isNull(suppliers.companyId)),
        inArray(supplierMaterialPrices.materialId, unique),
      ),
    );

  const bestQuote = new Map<string, number>();
  for (const row of quoteRows) {
    const effectiveZone = row.supplierCompanyId === null ? row.supplierZoneId : row.zoneId;
    if (zoneId && effectiveZone != null && effectiveZone !== zoneId) continue;
    const cost = Number(row.unitCost);
    const current = bestQuote.get(row.materialId);
    if (current == null || cost < current) bestQuote.set(row.materialId, cost);
  }

  for (const mat of materialRows) {
    const quote = bestQuote.get(mat.id);
    if (quote != null && quote > 0) {
      result.set(mat.id, quote);
      continue;
    }
    const zoneCost = zoneByMaterial.get(mat.id);
    if (zoneCost != null && zoneCost > 0) {
      result.set(mat.id, zoneCost * Number(mat.importFactor));
      continue;
    }
    result.set(mat.id, Number(mat.baseUnitCost) * Number(mat.importFactor) * zoneFactor);
  }
  return result;
}

const lineSchema = z.object({
  materialId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
  currency: z.enum(CURRENCIES).default("MZN"),
});

const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  orderDate: z.string().min(1),
  requiredByDate: z.string().optional(),
  scheduleTaskId: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

async function assertPurchaseOrderOwned(id: string, companyId: string) {
  const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  if (!order) return null;
  const project = await assertProjectOwned(order.projectId, companyId);
  return project ? order : null;
}

// Uma ordem de compra é o sinal mais forte de que a empresa está a usar (ou muito perto de usar)
// os preços deste fornecedor — avisa-o com o contacto de quem comprou, para poder ligar e
// ajudar a fechar/confirmar a venda, tal como já acontece ao pedir uma cotação.
async function notifyMarketplaceSupplierOfOrder(supplierAccountId: string | null, companyId: string, buyerUserId: string | null, itemCount: number) {
  if (!supplierAccountId) return;
  const [account] = await db.select({ email: supplierAccounts.email, name: supplierAccounts.name }).from(supplierAccounts).where(eq(supplierAccounts.id, supplierAccountId)).limit(1);
  if (!account) return;
  const buyer = await resolveBuyerContact(companyId, buyerUserId);
  const contactLines = [
    buyer.buyerName ? `<strong>${escapeHtml(buyer.buyerName)}</strong>` : null,
    buyer.buyerEmail ? escapeHtml(buyer.buyerEmail) : null,
    buyer.companyPhone ? escapeHtml(buyer.companyPhone) : null,
  ].filter(Boolean);
  if (account.email) {
    void sendEmail(
      {
        to: account.email,
        subject: `SIGO — ${buyer.companyName} criou uma ordem de compra consigo`,
        html: emailLayout(
          "Nova ordem de compra",
          `<p>Olá ${escapeHtml(account.name)}, a empresa <strong>${escapeHtml(buyer.companyName)}</strong> criou uma ordem de compra com os seus preços (${itemCount} item(ns)).</p>
           ${contactLines.length ? `<p><strong>Contacto de compras</strong> — ${contactLines.join(" · ")}. Ligue directamente para confirmar prazos e ajudar a fechar esta compra.</p>` : ""}
           <p>Entre no seu Portal do Fornecedor para rever os seus preços e os pedidos desta empresa.</p>`,
          `${env.supplierPublicUrl}/login`,
          "Abrir Portal do Fornecedor",
        ),
      },
      undefined,
    );
  }
  await notifySupplierAccount(supplierAccountId, "Nova ordem de compra", `${buyer.companyName} criou uma ordem de compra com os seus preços (${itemCount} item(ns)).`, "/painel");
}

// Confirma/desmente ao fornecedor do marketplace se a compra vai mesmo avante — sem isto, uma
// ordem aprovada ou cancelada fica muda para ele até verificar manualmente o portal.
async function notifyMarketplaceSupplierOfOrderStatus(supplierId: string, status: "aprovado" | "cancelado") {
  const [supplier] = await db.select({ companyId: suppliers.companyId, supplierAccountId: suppliers.supplierAccountId, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier || supplier.companyId !== null || !supplier.supplierAccountId) return;
  const [account] = await db.select({ email: supplierAccounts.email, name: supplierAccounts.name }).from(supplierAccounts).where(eq(supplierAccounts.id, supplier.supplierAccountId)).limit(1);
  if (!account) return;
  const isApproved = status === "aprovado";
  if (account.email) {
    void sendEmail(
      {
        to: account.email,
        subject: isApproved ? "SIGO — Ordem de compra confirmada" : "SIGO — Ordem de compra cancelada",
        html: emailLayout(
          isApproved ? "Ordem de compra confirmada" : "Ordem de compra cancelada",
          isApproved
            ? `<p>Olá ${escapeHtml(account.name)}, a ordem de compra que lhe pediram foi aprovada — a compra vai mesmo avante. Prepare a entrega conforme combinado.</p>`
            : `<p>Olá ${escapeHtml(account.name)}, a ordem de compra que lhe pediram foi cancelada. Não é preciso preparar esta entrega.</p>`,
          `${env.supplierPublicUrl}/login`,
          "Abrir Portal do Fornecedor",
        ),
      },
      undefined,
    );
  }
  await notifySupplierAccount(
    supplier.supplierAccountId,
    isApproved ? "Ordem de compra confirmada" : "Ordem de compra cancelada",
    isApproved ? "A ordem de compra que lhe pediram foi aprovada — a compra vai mesmo avante." : "A ordem de compra que lhe pediram foi cancelada.",
    "/painel",
  );
}

async function getOrderWithLines(orderId: string) {
  return db
    .select({ line: purchaseOrderLines, materialName: materials.name, materialUnit: materials.unit })
    .from(purchaseOrderLines)
    .innerJoin(materials, eq(purchaseOrderLines.materialId, materials.id))
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
}

export async function purchasingRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/procurement-plan", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const { budgetDocumentId } = request.query as { budgetDocumentId?: string };
    const documents = await db
      .select()
      .from(budgetDocuments)
      .where(and(eq(budgetDocuments.projectId, projectId), eq(budgetDocuments.documentType, "orcamento")))
      .orderBy(desc(budgetDocuments.createdAt));
    const document = budgetDocumentId
      ? documents.find((item) => item.id === budgetDocumentId)
      : documents.find((item) => item.status === "aprovado" && item.currency === project.currency)
        ?? documents.find((item) => item.status === "aprovado");
    if (!document) {
      return reply.code(404).send({ error: "Crie e aprove um orçamento para gerar necessidades de compra" });
    }
    if (document.status !== "aprovado") {
      return reply.code(409).send({ error: "Aprove o orçamento antes de gerar o plano de compras" });
    }

    return computeProcurementPlan({ projectId, documentId: document.id, companyId, zoneId: project.zoneId, currency: project.currency, ivaRate: Number(project.ivaRate) });
  });

  // ---------- Ordens de compra ----------
  app.get("/api/projects/:projectId/purchase-orders", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const orders = await db
      .select({ order: purchaseOrders, supplierName: suppliers.name, supplierContact: suppliers.contact })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(eq(purchaseOrders.projectId, projectId))
      .orderBy(desc(purchaseOrders.orderDate));

    return Promise.all(
      orders.map(async (o) => ({
        ...o.order,
        supplierName: o.supplierName,
        supplierContact: o.supplierContact,
        lines: (await getOrderWithLines(o.order.id)).map((l) => ({ ...l.line, materialName: l.materialName, unit: l.materialUnit })),
      }))
    );
  });

  app.post("/api/projects/:projectId/purchase-orders", { preHandler: canRequestMaterials }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const gate = await assertApprovedOrcamentoForSite(projectId, companyId);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const project = gate.project;

    const parsed = purchaseOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.lines.some((line) => line.currency !== project.currency)) {
      return reply.code(400).send({ error: `Todas as linhas devem usar a moeda da obra (${project.currency})` });
    }
    if (new Set(parsed.data.lines.map((line) => line.materialId)).size !== parsed.data.lines.length) {
      return reply.code(400).send({ error: "Agrupe quantidades repetidas do mesmo material numa única linha" });
    }

    // A ordem pode apontar à ficha SIGO Preços da própria empresa OU a um fornecedor real do
    // marketplace nacional (companyId null) — este último exige o plano Profissional, o mesmo
    // gate aplicado em todo o resto do marketplace.
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, parsed.data.supplierId), or(eq(suppliers.companyId, companyId), isNull(suppliers.companyId))))
      .limit(1);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    if (supplier.companyId === null) {
      const blocked = await assertSupplierMarketplaceAccess(companyId);
      if (blocked) return reply.code(402).send(blocked);
    }

    if (parsed.data.scheduleTaskId) {
      const [task] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, parsed.data.scheduleTaskId)).limit(1);
      if (!task || task.projectId !== projectId) return reply.code(400).send({ error: "A actividade seleccionada não pertence ao cronograma desta obra" });
    }

    for (const line of parsed.data.lines) {
      const material = await findVisibleMaterial(line.materialId, companyId);
      if (!material) return reply.code(404).send({ error: "Material não encontrado no Catálogo" });
    }

    const order = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(purchaseOrders)
        .values({
          projectId,
          supplierId: parsed.data.supplierId,
          orderDate: parsed.data.orderDate,
          requiredByDate: parsed.data.requiredByDate,
          scheduleTaskId: parsed.data.scheduleTaskId,
          notes: parsed.data.notes,
          ivaRate: project.ivaRate,
          createdByUserId: request.currentUser!.id,
        })
        .returning();
      await tx.insert(purchaseOrderLines).values(parsed.data.lines.map((line) => ({
        purchaseOrderId: created.id,
        materialId: line.materialId,
        quantity: line.quantity.toString(),
        unitCost: line.unitCost.toString(),
        currency: line.currency,
      })));
      return created;
    });

    const lines = (await getOrderWithLines(order.id)).map((l) => ({ ...l.line, materialName: l.materialName, unit: l.materialUnit }));
    await recordAuditEvent({
      companyId, projectId, actorUserId: request.currentUser!.id,
      entityType: "purchase_order", entityId: order.id, action: "created",
      after: { status: order.status, supplierId: order.supplierId, orderDate: order.orderDate, lineCount: lines.length },
    });
    if (supplier.companyId === null) {
      await notifyMarketplaceSupplierOfOrder(supplier.supplierAccountId, companyId, request.currentUser!.id, lines.length);
    }
    return reply.code(201).send({ ...order, supplierName: supplier.name, supplierContact: supplier.contact, lines });
  });

  /** Pedido leve do engenheiro: material + quantidade, sem cotação. Vira OC em rascunho. */
  app.post("/api/projects/:projectId/material-requests", { preHandler: canRequestMaterials }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const gate = await assertApprovedOrcamentoForSite(projectId, companyId);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const project = gate.project;

    const parsed = z
      .object({
        notes: z.string().optional(),
        lines: z
          .array(
            z.object({
              materialId: z.string().uuid(),
              quantity: z.number().positive(),
            }),
          )
          .min(1),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Indique pelo menos um material com quantidade" });
    if (new Set(parsed.data.lines.map((line) => line.materialId)).size !== parsed.data.lines.length) {
      return reply.code(400).send({ error: "Agrupe quantidades repetidas do mesmo material numa única linha" });
    }

    for (const line of parsed.data.lines) {
      const material = await findVisibleMaterial(line.materialId, companyId);
      if (!material) return reply.code(404).send({ error: "Material não encontrado no Catálogo" });
    }

    const suggestedCosts = await suggestMaterialUnitCosts(
      parsed.data.lines.map((l) => l.materialId),
      companyId,
      project.zoneId,
    );

    let [supplier] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.companyId, companyId), eq(suppliers.name, "Pedido de obra")))
      .limit(1);
    if (!supplier) {
      [supplier] = await db
        .insert(suppliers)
        .values({
          companyId,
          name: "Pedido de obra",
          notes: "Fornecedor interno para pedidos de material sem cotação ainda.",
        })
        .returning();
    }

    const today = new Date().toISOString().slice(0, 10);
    const order = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(purchaseOrders)
        .values({
          projectId,
          supplierId: supplier.id,
          orderDate: today,
          notes: parsed.data.notes?.trim() || "Pedido de materiais da obra",
          ivaRate: project.ivaRate,
          createdByUserId: request.currentUser!.id,
        })
        .returning();
      await tx.insert(purchaseOrderLines).values(
        parsed.data.lines.map((line) => ({
          purchaseOrderId: created.id,
          materialId: line.materialId,
          quantity: line.quantity.toString(),
          unitCost: (suggestedCosts.get(line.materialId) ?? 0).toFixed(4),
          currency: project.currency,
        })),
      );
      return created;
    });

    const lines = (await getOrderWithLines(order.id)).map((l) => ({ ...l.line, materialName: l.materialName, unit: l.materialUnit }));
    await recordAuditEvent({
      companyId,
      projectId,
      actorUserId: request.currentUser!.id,
      entityType: "purchase_order",
      entityId: order.id,
      action: "material_request_created",
      after: { status: order.status, lineCount: lines.length },
    });
    return reply.code(201).send({ ...order, supplierName: supplier.name, supplierContact: supplier.contact, lines });
  });

  /** Preenche preços a 0 em rascunhos com catálogo / cotações da zona. */
  app.post("/api/projects/:projectId/purchase-orders/suggest-missing-prices", { preHandler: canRequestMaterials }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const draftRows = await db
      .select({ line: purchaseOrderLines, orderId: purchaseOrders.id })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.status, "rascunho")));

    const zeroLines = draftRows.filter((r) => Number(r.line.unitCost) === 0);
    if (!zeroLines.length) return { updated: 0 };

    const costs = await suggestMaterialUnitCosts(
      zeroLines.map((r) => r.line.materialId),
      companyId,
      project.zoneId,
    );

    let updated = 0;
    for (const row of zeroLines) {
      const cost = costs.get(row.line.materialId) ?? 0;
      if (!(cost > 0)) continue;
      await db
        .update(purchaseOrderLines)
        .set({ unitCost: cost.toFixed(4) })
        .where(eq(purchaseOrderLines.id, row.line.id));
      updated += 1;
    }
    return { updated };
  });

  // Mudar de estado — "recebido" gera automaticamente as entradas de stock (uma por linha), tal
  // como o fluxo do documento comercial descreve (recepção do material → entrada no armazém).
  // Só se gera uma vez: se já existirem movimentos de stock ligados a esta ordem, não duplica.
  app.put("/api/purchase-orders/:id/status", { preHandler: requirePermission("materiais.requisitar", "materiais.aprovar") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await assertPurchaseOrderOwned(id, companyIdOf(request));
    if (!order) return reply.code(404).send({ error: "Ordem de compra não encontrada" });

    const parsed = z.object({ status: z.enum(["rascunho", "aprovado", "recebido", "cancelado"]), effectiveDate: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const user = request.currentUser!;
    const canApprove = user.role === "super_admin" || user.role === "admin_empresa" || user.permissions.includes("materiais.aprovar");
    if ((parsed.data.status === "aprovado" || parsed.data.status === "recebido") && !canApprove) {
      return reply.code(403).send({ error: "Sem permissão para aprovar ou receber pedidos de material" });
    }
    if (parsed.data.status === "aprovado" && order.createdByUserId === user.id && user.role !== "admin_empresa" && user.role !== "super_admin") {
      return reply.code(409).send({ error: "Quem criou a ordem não pode aprová-la" });
    }
    // OCs adjudicadas no procurement integrado deixam de usar o atalho legado "Recebido".
    // A recepção passa por documento próprio (entregue/aceite/rejeitado), que permite parciais.
    if (parsed.data.status === "recebido" && order.procurementAwardId) {
      return reply.code(409).send({ error: "Use Recepção de Materiais para esta OC; o stock só recebe quantidades inspeccionadas e aceites" });
    }

    const transitions: Record<typeof order.status, typeof order.status[]> = {
      rascunho: ["aprovado", "cancelado"],
      aprovado: ["recebido", "cancelado"],
      recebido: [],
      cancelado: [],
    };
    if (parsed.data.status !== order.status && !transitions[order.status].includes(parsed.data.status)) {
      return reply.code(409).send({ error: `A ordem ${order.status} não pode passar para ${parsed.data.status}` });
    }

    const change = await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`select id from purchase_orders where id = ${id} for update`);
      const [lockedOrder] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
      if (!lockedOrder) return { error: "Ordem de compra não encontrada" } as const;
      if (lockedOrder.status === parsed.data.status) return { row: lockedOrder, changed: false } as const;
      if (!transitions[lockedOrder.status].includes(parsed.data.status)) return { error: `A ordem ${lockedOrder.status} não pode passar para ${parsed.data.status}` } as const;

      if (parsed.data.status === "cancelado") {
        const linkedEntries = await tx.select().from(financialEntries).where(and(eq(financialEntries.projectId, lockedOrder.projectId), eq(financialEntries.sourceType, "purchase_order"), eq(financialEntries.sourceId, id)));
        if (linkedEntries.some((entry) => entry.status === "pago")) {
          return { error: "Esta ordem já tem uma despesa paga associada — reverta o pagamento no Financeiro antes de cancelar" } as const;
        }
      }

      if (parsed.data.status === "cancelado" && lockedOrder.procurementAwardId) {
        const [shipmentRows, receiptRows] = await Promise.all([
          tx.select({ id: purchaseOrderShipments.id, status: purchaseOrderShipments.status }).from(purchaseOrderShipments).where(eq(purchaseOrderShipments.purchaseOrderId, id)),
          tx.select({ id: goodsReceipts.id, status: goodsReceipts.status }).from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, id)),
        ]);
        if (shipmentRows.some((shipment) => shipment.status === "expedido" || shipment.status === "entregue") || receiptRows.some((receipt) => receipt.status === "confirmado")) {
          return { error: "Não é possível cancelar uma OC com material já expedido/recebido; regularize a entrega e o Financeiro" } as const;
        }
        const cancellableShipmentIds = shipmentRows.filter((shipment) => shipment.status === "rascunho" || shipment.status === "pronto").map((shipment) => shipment.id);
        if (cancellableShipmentIds.length) {
          await tx.update(purchaseOrderShipments).set({ status: "cancelado", updatedAt: new Date() }).where(inArray(purchaseOrderShipments.id, cancellableShipmentIds));
        }
      }

      const [row] = await tx.update(purchaseOrders).set({
        status: parsed.data.status,
        ...(parsed.data.status === "aprovado" ? {
          approvedAt: lockedOrder.approvedAt ?? new Date(),
          supplierConfirmationStatus: "pendente" as const,
          fulfillmentStatus: "aguarda_confirmacao" as const,
        } : {}),
      }).where(eq(purchaseOrders.id, id)).returning();

      if (parsed.data.status === "aprovado") {
        const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
        const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, lockedOrder.supplierId)).limit(1);
        const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0)
          + Number(lockedOrder.transportCost ?? 0);
        const amount = calculateVatTotals(subtotal, Number(lockedOrder.ivaRate)).total;
        if (amount > 0) await tx.insert(financialEntries).values({ projectId: lockedOrder.projectId, type: "despesa", category: "Compras e materiais", description: `Compromisso automático da ordem de compra · ${supplier?.name ?? "Fornecedor"}`, amount: amount.toFixed(2), currency: lines[0]?.currency ?? "MZN", dueDate: lockedOrder.requiredByDate ?? lockedOrder.orderDate, status: "pendente", sourceType: "purchase_order", sourceId: id, createdByUserId: request.currentUser!.id }).onConflictDoNothing();
      }

      if (parsed.data.status === "cancelado") {
        await tx.delete(financialEntries).where(and(eq(financialEntries.projectId, lockedOrder.projectId), eq(financialEntries.sourceType, "purchase_order"), eq(financialEntries.sourceId, id), eq(financialEntries.status, "pendente")));
      }

      if (parsed.data.status === "recebido") {
        const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
        if (lines.length) await tx.insert(stockMovements).values(lines.map((line) => ({ projectId: lockedOrder.projectId, materialId: line.materialId, type: "entrada" as const, quantity: line.quantity, unitCost: line.unitCost, currency: line.currency, notes: "Entrada automática — recepção da ordem de compra", purchaseOrderId: id, createdByUserId: request.currentUser!.id, date: parsed.data.effectiveDate ?? new Date().toISOString().slice(0, 10) }))).onConflictDoNothing();
      }

      // Uma adjudicação pode gerar várias OCs (fornecedores diferentes). O estado da requisição
      // só avança quando TODAS as OCs activas atingem o marco correspondente; nunca ao criar a OC.
      if (lockedOrder.purchaseRequisitionId) {
        const linkedOrders = await tx
          .select({ status: purchaseOrders.status, fulfillmentStatus: purchaseOrders.fulfillmentStatus })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.purchaseRequisitionId, lockedOrder.purchaseRequisitionId));
        const activeOrders = linkedOrders.filter((linked) => linked.status !== "cancelado");
        const requisitionStatus = activeOrders.length > 0 && activeOrders.every((linked) => linked.status === "recebido" || linked.fulfillmentStatus === "fechado")
          ? "fechada"
          : activeOrders.length > 0 && activeOrders.every((linked) => linked.status === "aprovado" || linked.status === "recebido")
            ? "comprada"
            : "adjudicada";
        await tx
          .update(purchaseRequisitions)
          .set({ status: requisitionStatus, updatedAt: new Date() })
          .where(eq(purchaseRequisitions.id, lockedOrder.purchaseRequisitionId));
      }
      return { row, changed: true } as const;
    });
    if ("error" in change) return reply.code(409).send({ error: change.error });
    const row = change.row;
    if (change.changed) await recordAuditEvent({
      companyId: companyIdOf(request), projectId: order.projectId, actorUserId: request.currentUser!.id,
      entityType: "purchase_order", entityId: id, action: `status.${parsed.data.status}`,
      before: { status: order.status, supplierId: order.supplierId, orderDate: order.orderDate },
      after: { status: row.status, supplierId: row.supplierId, orderDate: row.orderDate },
      metadata: parsed.data.effectiveDate ? { effectiveDate: parsed.data.effectiveDate } : null,
    });
    if (change.changed && (parsed.data.status === "aprovado" || parsed.data.status === "cancelado")) {
      await notifyMarketplaceSupplierOfOrderStatus(row.supplierId, parsed.data.status);
    }
    return row;
  });

  app.delete("/api/purchase-orders/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await assertPurchaseOrderOwned(id, companyIdOf(request));
    if (!order) return { ok: true };
    if (order.status !== "rascunho" && order.status !== "cancelado") {
      return reply.code(409).send({ error: "Só é possível eliminar ordens em rascunho ou canceladas" });
    }
    await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
    return { ok: true };
  });

  // "Pedir materiais" cria linhas com preço 0 (o requisitante só sabe a quantidade) — este
  // endpoint é onde quem aprova preenche o preço real antes de a ordem sair do rascunho.
  app.put("/api/purchase-order-lines/:id", { preHandler: canRequestMaterials }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ unitCost: z.number().nonnegative().optional(), quantity: z.number().positive().optional() }).safeParse(request.body);
    if (!parsed.success || (parsed.data.unitCost === undefined && parsed.data.quantity === undefined)) {
      return reply.code(400).send({ error: "Indique um preço ou quantidade válidos" });
    }

    const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, id)).limit(1);
    if (!line) return reply.code(404).send({ error: "Linha não encontrada" });
    const order = await assertPurchaseOrderOwned(line.purchaseOrderId, companyIdOf(request));
    if (!order) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    if (order.status !== "rascunho") {
      return reply.code(409).send({ error: "Só é possível alterar a linha enquanto a ordem está em rascunho" });
    }
    const [updated] = await db.update(purchaseOrderLines).set({
      ...(parsed.data.unitCost !== undefined ? { unitCost: parsed.data.unitCost.toString() } : {}),
      ...(parsed.data.quantity !== undefined ? { quantity: parsed.data.quantity.toString() } : {}),
    }).where(eq(purchaseOrderLines.id, id)).returning();
    return updated;
  });

  // ---------- Armazém (movimentos e stock actual por projecto) ----------
  const stockEntrySchema = z.object({
    materialId: z.string().uuid(),
    type: z.enum(["entrada", "saida"]),
    quantity: z.number().positive(),
    unitCost: z.number().nonnegative().optional(),
    currency: z.enum(CURRENCIES).default("MZN"),
    notes: z.string().optional(),
    date: z.string().min(1),
  });

  app.get("/api/projects/:projectId/stock-movements", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db
      .select({ movement: stockMovements, materialName: materials.name, materialUnit: materials.unit })
      .from(stockMovements)
      .innerJoin(materials, eq(stockMovements.materialId, materials.id))
      .where(eq(stockMovements.projectId, projectId))
      .orderBy(desc(stockMovements.date));
    return rows.map((r) => ({ ...r.movement, materialName: r.materialName, unit: r.materialUnit }));
  });

  app.post("/api/projects/:projectId/stock-movements", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = stockEntrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const material = await findVisibleMaterial(parsed.data.materialId, companyId);
    if (!material) return reply.code(404).send({ error: "Material não encontrado no Catálogo" });

    const { quantity, unitCost, ...rest } = parsed.data;
    const result = await db.transaction(async (tx) => {
      // Serializa movimentos do mesmo material/obra. Sem este bloqueio, duas saídas simultâneas
      // podiam ambas ler o saldo antigo e produzir stock negativo.
      await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${`${projectId}:${parsed.data.materialId}`}))`);
      if (parsed.data.type === "saida") {
        const movements = await tx.select().from(stockMovements).where(and(eq(stockMovements.projectId, projectId), eq(stockMovements.materialId, parsed.data.materialId)));
        const available = movements.reduce((sum, movement) => sum + (movement.type === "entrada" ? Number(movement.quantity) : -Number(movement.quantity)), 0);
        if (quantity > available + 0.0001) return { error: `Stock insuficiente de ${material.name}: disponível ${available.toFixed(2)} ${material.unit}` } as const;
      }
      const [row] = await tx.insert(stockMovements).values({ ...rest, projectId, quantity: quantity.toString(), unitCost: unitCost !== undefined ? unitCost.toString() : null, createdByUserId: request.currentUser!.id }).returning();
      return { row } as const;
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    const row = result.row;
    await recordAuditEvent({
      companyId, projectId, actorUserId: request.currentUser!.id,
      entityType: "stock_movement", entityId: row.id, action: "created",
      after: { materialId: row.materialId, type: row.type, quantity: row.quantity, unitCost: row.unitCost, date: row.date },
    });
    return reply.code(201).send({ ...row, materialName: material.name, unit: material.unit });
  });

  app.delete("/api/stock-movements/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [movement] = await db.select().from(stockMovements).where(eq(stockMovements.id, id)).limit(1);
    if (!movement) return { ok: true };
    const project = await assertProjectOwned(movement.projectId, companyIdOf(request));
    if (!project) return { ok: true };
    if (movement.purchaseOrderId || movement.diaryEntryId || movement.goodsReceiptLineId) {
      return reply.code(409).send({ error: "Este movimento foi gerado por outro módulo e deve ser corrigido na sua origem" });
    }
    const result = await db.transaction(async (tx) => {
      // Mesmo bloqueio dos outros movimentos de stock: sem isto, apagar uma entrada ao mesmo
      // tempo que uma saída está a ser criada podia deixar o saldo negativo sem nenhum aviso.
      await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${`${movement.projectId}:${movement.materialId}`}))`);
      if (movement.type === "entrada") {
        const others = await tx.select().from(stockMovements).where(and(eq(stockMovements.projectId, movement.projectId), eq(stockMovements.materialId, movement.materialId)));
        const balanceWithoutThis = others
          .filter((m) => m.id !== movement.id)
          .reduce((sum, m) => sum + (m.type === "entrada" ? Number(m.quantity) : -Number(m.quantity)), 0);
        if (balanceWithoutThis < -0.0001) {
          const [material] = await tx.select().from(materials).where(eq(materials.id, movement.materialId)).limit(1);
          return { error: `Não é possível remover: ${material?.name ?? "o material"} já tem ${Math.abs(balanceWithoutThis).toFixed(2)} ${material?.unit ?? ""} consumido(s) para além desta entrada` } as const;
        }
      }
      await tx.delete(stockMovements).where(eq(stockMovements.id, id));
      return { ok: true } as const;
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    await recordAuditEvent({
      companyId: companyIdOf(request), projectId: movement.projectId, actorUserId: request.currentUser!.id,
      entityType: "stock_movement", entityId: id, action: "deleted",
      before: { materialId: movement.materialId, type: movement.type, quantity: movement.quantity, unitCost: movement.unitCost, date: movement.date },
    });
    return { ok: true };
  });

  // Stock actual por material = soma de entradas − soma de saídas, sempre calculado on-the-fly.
  app.get("/api/projects/:projectId/stock-summary", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const rows = await db
      .select({ movement: stockMovements, materialName: materials.name, materialUnit: materials.unit })
      .from(stockMovements)
      .innerJoin(materials, eq(stockMovements.materialId, materials.id))
      .where(eq(stockMovements.projectId, projectId));

    const byMaterial = new Map<string, { materialName: string; unit: string; balance: number; valueIn: number }>();
    for (const r of rows) {
      const materialId = r.movement.materialId;
      const bucket = byMaterial.get(materialId) ?? { materialName: r.materialName, unit: r.materialUnit, balance: 0, valueIn: 0 };
      const qty = Number(r.movement.quantity);
      if (r.movement.type === "entrada") {
        bucket.balance += qty;
        bucket.valueIn += qty * Number(r.movement.unitCost ?? 0);
      } else {
        bucket.balance -= qty;
      }
      byMaterial.set(materialId, bucket);
    }
    return Array.from(byMaterial.entries())
      .map(([materialId, v]) => ({ materialName: v.materialName, materialId, unit: v.unit, balance: v.balance, valueIn: v.valueIn }))
      .sort((a, b) => a.materialName.localeCompare(b.materialName, "pt"));
  });
}
