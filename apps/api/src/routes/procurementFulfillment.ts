import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  companies,
  goodsReceiptLines,
  goodsReceipts,
  materials,
  procurementDocumentSequences,
  procurementNonconformities,
  purchaseOrderLines,
  purchaseOrderShipmentLines,
  purchaseOrderShipments,
  purchaseOrderSupplierEvents,
  purchaseOrders,
  purchaseRequisitions,
  projects,
  stockMovements,
  suppliers,
  users,
} from "../db/schema.js";
import { requireCompanyUser, requirePermission } from "../auth/middleware.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { notifySupplierAccount, notifyUsers } from "../services/notifications.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import {
  computeSupplierPerformance,
  summarizeFulfillment,
  validateReceipt,
  validateShipment,
  type FulfillmentStatus,
  type ReceiptLineSnapshot,
  type ShipmentLineSnapshot,
  type SupplierPerformanceOrder,
} from "../services/procurementFulfillment.js";

const receivePermission = requirePermission("materiais.requisitar", "materiais.aprovar");

function companyIdOf(request: FastifyRequest) {
  return request.currentUser!.companyId!;
}

function dateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function nextReference(tx: any, companyId: string, kind: "REC" | "EXP" | "NCR") {
  const year = new Date().getUTCFullYear();
  const [row] = await tx
    .insert(procurementDocumentSequences)
    .values({ companyId, kind, year, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [procurementDocumentSequences.companyId, procurementDocumentSequences.kind, procurementDocumentSequences.year],
      set: { nextNumber: sql`${procurementDocumentSequences.nextNumber} + 1` },
    })
    .returning({ nextNumber: procurementDocumentSequences.nextNumber });
  return `${kind}-${year}-${String(Math.max(1, row.nextNumber - 1)).padStart(4, "0")}`;
}

async function supplierIdsOwnedByAccount(accountId: string) {
  const rows = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.supplierAccountId, accountId));
  return rows.map((row) => row.id);
}

async function orderOwned(orderId: string, companyId: string) {
  const [row] = await db
    .select({ order: purchaseOrders, projectCompanyId: projects.companyId, supplierName: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(and(eq(purchaseOrders.id, orderId), eq(projects.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function orderForSupplier(orderId: string, supplierAccountId: string) {
  const supplierIds = await supplierIdsOwnedByAccount(supplierAccountId);
  if (!supplierIds.length) return null;
  const [row] = await db
    .select({
      order: purchaseOrders,
      supplierName: suppliers.name,
      companyName: companies.name,
      projectName: projects.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(and(eq(purchaseOrders.id, orderId), inArray(purchaseOrders.supplierId, supplierIds)))
    .limit(1);
  return row ?? null;
}

async function loadOrderLines(orderId: string) {
  return db
    .select({ line: purchaseOrderLines, materialName: materials.name, unit: materials.unit })
    .from(purchaseOrderLines)
    .innerJoin(materials, eq(purchaseOrderLines.materialId, materials.id))
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
    .orderBy(asc(purchaseOrderLines.id));
}

async function loadShipmentSnapshots(orderId: string): Promise<ShipmentLineSnapshot[]> {
  const rows = await db
    .select({ line: purchaseOrderShipmentLines, shipmentStatus: purchaseOrderShipments.status })
    .from(purchaseOrderShipmentLines)
    .innerJoin(purchaseOrderShipments, eq(purchaseOrderShipmentLines.shipmentId, purchaseOrderShipments.id))
    .where(eq(purchaseOrderShipments.purchaseOrderId, orderId));
  return rows.map(({ line, shipmentStatus }) => ({
    purchaseOrderLineId: line.purchaseOrderLineId,
    quantity: Number(line.quantity),
    shipmentStatus,
  }));
}

async function loadShipmentsWithLines(orderId: string) {
  const shipments = await db.select().from(purchaseOrderShipments).where(eq(purchaseOrderShipments.purchaseOrderId, orderId)).orderBy(desc(purchaseOrderShipments.createdAt));
  const ids = shipments.map((shipment) => shipment.id);
  const lines = ids.length
    ? await db.select().from(purchaseOrderShipmentLines).where(inArray(purchaseOrderShipmentLines.shipmentId, ids))
    : [];
  return shipments.map((shipment) => ({
    ...shipment,
    lines: lines.filter((line) => line.shipmentId === shipment.id),
  }));
}

async function loadReceiptSnapshots(orderId: string): Promise<ReceiptLineSnapshot[]> {
  const rows = await db
    .select({ line: goodsReceiptLines, receiptDate: goodsReceipts.receiptDate, status: goodsReceipts.status })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
    .where(eq(goodsReceipts.purchaseOrderId, orderId));
  if (rows.length) {
    return rows.map(({ line, receiptDate, status }) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      acceptedQty: Number(line.acceptedQty),
      rejectedQty: Number(line.rejectedQty),
      receiptDate,
      confirmed: status === "confirmado",
    }));
  }

  // Compatibilidade com OCs recebidas antes da Fase 2: o fluxo legado criou directamente
  // entradas de stock ligadas à OC. Só usamos este fallback quando não existe qualquer
  // goods_receipt novo, evitando contar a mesma recepção duas vezes.
  const [legacyMovements, orderLines] = await Promise.all([
    db.select().from(stockMovements).where(and(eq(stockMovements.purchaseOrderId, orderId), eq(stockMovements.type, "entrada"))),
    db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, orderId)),
  ]);
  const lineByMaterial = new Map(orderLines.map((line) => [line.materialId, line.id]));
  return legacyMovements.flatMap((movement) => {
    const purchaseOrderLineId = lineByMaterial.get(movement.materialId);
    return purchaseOrderLineId ? [{ purchaseOrderLineId, acceptedQty: Number(movement.quantity), rejectedQty: 0, receiptDate: movement.date, confirmed: true }] : [];
  });
}

async function computeOrderSummary(order: typeof purchaseOrders.$inferSelect) {
  const [lines, shipments, receipts] = await Promise.all([
    loadOrderLines(order.id),
    loadShipmentSnapshots(order.id),
    loadReceiptSnapshots(order.id),
  ]);
  return summarizeFulfillment(
    lines.map(({ line }) => ({ id: line.id, materialId: line.materialId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
    shipments,
    receipts,
    order.fulfillmentStatus as FulfillmentStatus,
  );
}

async function notifyBuyerTeam(projectId: string, title: string, body: string) {
  const [project] = await db.select({ companyId: projects.companyId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return;
  const recipients = await db.select({ id: users.id, role: users.role, permissions: users.permissions }).from(users).where(and(eq(users.companyId, project.companyId), eq(users.isActive, true)));
  const ids = recipients
    .filter((row) => row.role === "admin_empresa" || row.role === "orcamentista" || row.permissions.includes("materiais.aprovar") || row.permissions.includes("materiais.requisitar"))
    .map((row) => row.id);
  await notifyUsers(ids, title, body, `/projectos/${projectId}/compras`);
}

async function appendSupplierEvent(args: {
  orderId: string;
  supplierAccountId: string;
  type: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await db.insert(purchaseOrderSupplierEvents).values({
    purchaseOrderId: args.orderId,
    supplierAccountId: args.supplierAccountId,
    eventType: args.type,
    message: args.message ?? null,
    metadata: args.metadata ?? null,
  });
}

async function syncRequisitionStatus(tx: any, requisitionId: string) {
  const linkedOrders = await tx
    .select({ status: purchaseOrders.status, fulfillmentStatus: purchaseOrders.fulfillmentStatus })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.purchaseRequisitionId, requisitionId));
  const active = linkedOrders.filter((row: any) => row.status !== "cancelado");
  const status = active.length > 0 && active.every((row: any) => row.status === "recebido" || row.fulfillmentStatus === "fechado")
    ? "fechada"
    : active.length > 0 && active.every((row: any) => row.status === "aprovado" || row.status === "recebido")
      ? "comprada"
      : "adjudicada";
  await tx.update(purchaseRequisitions).set({ status, updatedAt: new Date() }).where(eq(purchaseRequisitions.id, requisitionId));
}

const supplierConfirmInput = z.object({
  promisedDeliveryDate: z.string().min(1),
  notes: z.string().trim().max(3000).optional(),
});
const supplierMessageInput = z.object({ reason: z.string().trim().min(5).max(3000) });
const shipmentInput = z.object({
  expectedDeliveryDate: z.string().optional().nullable(),
  carrier: z.string().trim().max(200).optional(),
  vehiclePlate: z.string().trim().max(80).optional(),
  driverName: z.string().trim().max(160).optional(),
  driverPhone: z.string().trim().max(80).optional(),
  trackingReference: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(3000).optional(),
  lines: z.array(z.object({ purchaseOrderLineId: z.string().uuid(), quantity: z.number().positive() })).min(1).max(200),
});
const receiptInput = z.object({
  shipmentId: z.string().uuid().nullable().optional(),
  receiptDate: z.string().min(1),
  deliveryNoteNumber: z.string().trim().max(160).optional(),
  inspectionNotes: z.string().trim().max(5000).optional(),
  lines: z.array(z.object({
    purchaseOrderLineId: z.string().uuid(),
    deliveredQty: z.number().positive(),
    acceptedQty: z.number().nonnegative(),
    rejectedQty: z.number().nonnegative(),
    rejectionReason: z.string().trim().max(2000).optional(),
    conditionNotes: z.string().trim().max(2000).optional(),
  })).min(1).max(200),
});

export async function procurementFulfillmentRoutes(app: FastifyInstance) {
  // ---------- Portal do fornecedor: OCs e expedições ----------
  app.get("/api/supplier/purchase-orders", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    if (!supplierIds.length) return [];
    const rows = await db
      .select({ order: purchaseOrders, supplierName: suppliers.name, companyName: companies.name, projectName: projects.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
      .innerJoin(companies, eq(projects.companyId, companies.id))
      .where(inArray(purchaseOrders.supplierId, supplierIds))
      .orderBy(desc(purchaseOrders.createdAt));
    const visible = rows.filter(({ order }) => order.status === "aprovado" || order.status === "recebido");
    return Promise.all(visible.map(async (row) => {
      const summary = await computeOrderSummary(row.order);
      return { ...row.order, fulfillmentStatus: summary.status, supplierConfirmationStatus: row.order.status === "recebido" ? "confirmado" : row.order.supplierConfirmationStatus, supplierName: row.supplierName, companyName: row.companyName, projectName: row.projectName, summary };
    }));
  });

  app.get("/api/supplier/purchase-orders/:id", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await orderForSupplier(id, request.currentSupplier!.id);
    if (!row || (row.order.status !== "aprovado" && row.order.status !== "recebido")) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    const [lines, shipments, receipts, events, summary] = await Promise.all([
      loadOrderLines(id),
      loadShipmentsWithLines(id),
      db.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, id)).orderBy(desc(goodsReceipts.receiptDate)),
      db.select().from(purchaseOrderSupplierEvents).where(eq(purchaseOrderSupplierEvents.purchaseOrderId, id)).orderBy(desc(purchaseOrderSupplierEvents.createdAt)),
      computeOrderSummary(row.order),
    ]);
    return { ...row.order, fulfillmentStatus: summary.status, supplierConfirmationStatus: row.order.status === "recebido" ? "confirmado" : row.order.supplierConfirmationStatus, supplierName: row.supplierName, companyName: row.companyName, projectName: row.projectName, lines: lines.map((entry) => ({ ...entry.line, materialName: entry.materialName, unit: entry.unit })), shipments, receipts, events, summary };
  });

  app.post("/api/supplier/purchase-orders/:id/confirm", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await orderForSupplier(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    if (row.order.status !== "aprovado") return reply.code(409).send({ error: "A OC ainda não está aprovada ou já foi encerrada" });
    if (row.order.supplierConfirmationStatus === "recusado") return reply.code(409).send({ error: "Esta OC já foi recusada; contacte a empresa" });
    const parsed = supplierConfirmInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const now = new Date();
    const [updated] = await db.update(purchaseOrders).set({
      supplierConfirmationStatus: "confirmado",
      fulfillmentStatus: row.order.fulfillmentStatus === "aguarda_confirmacao" ? "confirmado" : row.order.fulfillmentStatus,
      supplierConfirmedAt: row.order.supplierConfirmedAt ?? now,
      promisedDeliveryDate: parsed.data.promisedDeliveryDate,
      supplierResponseNotes: parsed.data.notes ?? null,
      lastSupplierUpdateAt: now,
    }).where(eq(purchaseOrders.id, id)).returning();
    await appendSupplierEvent({ orderId: id, supplierAccountId: request.currentSupplier!.id, type: "confirmado", message: parsed.data.notes, metadata: { promisedDeliveryDate: parsed.data.promisedDeliveryDate } });
    await notifyBuyerTeam(row.order.projectId, "Fornecedor confirmou a OC", `${row.supplierName} confirmou a ordem e prometeu entrega para ${parsed.data.promisedDeliveryDate}.`);
    return updated;
  });

  app.post("/api/supplier/purchase-orders/:id/request-change", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await orderForSupplier(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    if (row.order.status !== "aprovado" || !["aguarda_confirmacao", "confirmado"].includes(row.order.fulfillmentStatus)) {
      return reply.code(409).send({ error: "A OC já entrou em preparação/entrega e não aceita alteração pelo portal" });
    }
    const parsed = supplierMessageInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [updated] = await db.update(purchaseOrders).set({ supplierConfirmationStatus: "alteracao_solicitada", supplierResponseNotes: parsed.data.reason, lastSupplierUpdateAt: new Date() }).where(eq(purchaseOrders.id, id)).returning();
    await appendSupplierEvent({ orderId: id, supplierAccountId: request.currentSupplier!.id, type: "alteracao_solicitada", message: parsed.data.reason });
    await notifyBuyerTeam(row.order.projectId, "Fornecedor pediu alteração à OC", `${row.supplierName}: ${parsed.data.reason}`);
    return updated;
  });

  app.post("/api/supplier/purchase-orders/:id/decline", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await orderForSupplier(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    if (row.order.status !== "aprovado" || !["aguarda_confirmacao", "confirmado"].includes(row.order.fulfillmentStatus)) {
      return reply.code(409).send({ error: "Esta OC já entrou em preparação/entrega e não pode ser recusada" });
    }
    const parsed = supplierMessageInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [updated] = await db.update(purchaseOrders).set({ supplierConfirmationStatus: "recusado", supplierResponseNotes: parsed.data.reason, lastSupplierUpdateAt: new Date() }).where(eq(purchaseOrders.id, id)).returning();
    await appendSupplierEvent({ orderId: id, supplierAccountId: request.currentSupplier!.id, type: "recusado", message: parsed.data.reason });
    await notifyBuyerTeam(row.order.projectId, "Fornecedor recusou a OC", `${row.supplierName}: ${parsed.data.reason}`);
    return updated;
  });

  app.post("/api/supplier/purchase-orders/:id/preparing", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await orderForSupplier(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    if (row.order.status !== "aprovado" || row.order.supplierConfirmationStatus !== "confirmado") return reply.code(409).send({ error: "Confirme primeiro a OC" });
    if (["recebido", "fechado"].includes(row.order.fulfillmentStatus)) return reply.code(409).send({ error: "Esta OC já foi encerrada" });
    const nextStatus = row.order.fulfillmentStatus === "parcialmente_recebido" ? "parcialmente_recebido" : "em_preparacao";
    const [updated] = await db.update(purchaseOrders).set({ fulfillmentStatus: nextStatus, lastSupplierUpdateAt: new Date() }).where(eq(purchaseOrders.id, id)).returning();
    await appendSupplierEvent({ orderId: id, supplierAccountId: request.currentSupplier!.id, type: "em_preparacao" });
    return updated;
  });

  app.post("/api/supplier/purchase-orders/:id/shipments", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await orderForSupplier(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    if (row.order.status !== "aprovado" || row.order.supplierConfirmationStatus !== "confirmado") return reply.code(409).send({ error: "A OC tem de estar aprovada e confirmada" });
    const parsed = shipmentInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [orderLines, priorShipments, priorReceipts] = await Promise.all([loadOrderLines(id), loadShipmentSnapshots(id), loadReceiptSnapshots(id)]);
    const validation = validateShipment(orderLines.map(({ line }) => ({ id: line.id, materialId: line.materialId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })), priorShipments, parsed.data.lines, priorReceipts);
    if ("error" in validation) return reply.code(409).send({ error: validation.error });

    const [project] = await db.select({ companyId: projects.companyId }).from(projects).where(eq(projects.id, row.order.projectId)).limit(1);
    if (!project) return reply.code(404).send({ error: "Obra não encontrada" });
    let shipment: typeof purchaseOrderShipments.$inferSelect;
    try {
      shipment = await db.transaction(async (tx) => {
        // Serializa todas as alterações quantitativas desta OC. A validação anterior dá feedback
        // rápido; esta segunda validação, já sob lock, é a que impede duas expedições concorrentes
        // de reservarem a mesma quantidade.
        await tx.execute(sql`select id from purchase_orders where id = ${id} for update`);
        const [lockedOrder] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
        if (!lockedOrder || lockedOrder.status !== "aprovado" || lockedOrder.supplierConfirmationStatus !== "confirmado") {
          throw new Error("A OC deixou de estar disponível para expedição");
        }
        const [lockedLines, shipmentRows, receiptRows] = await Promise.all([
          tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)),
          tx.select({ line: purchaseOrderShipmentLines, shipmentStatus: purchaseOrderShipments.status })
            .from(purchaseOrderShipmentLines)
            .innerJoin(purchaseOrderShipments, eq(purchaseOrderShipmentLines.shipmentId, purchaseOrderShipments.id))
            .where(eq(purchaseOrderShipments.purchaseOrderId, id)),
          tx.select({ line: goodsReceiptLines, receiptDate: goodsReceipts.receiptDate, status: goodsReceipts.status })
            .from(goodsReceiptLines)
            .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
            .where(eq(goodsReceipts.purchaseOrderId, id)),
        ]);
        const lockedValidation = validateShipment(
          lockedLines.map((line) => ({ id: line.id, materialId: line.materialId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
          shipmentRows.map(({ line, shipmentStatus }) => ({ purchaseOrderLineId: line.purchaseOrderLineId, quantity: Number(line.quantity), shipmentStatus })),
          parsed.data.lines,
          receiptRows.map(({ line, receiptDate, status }) => ({ purchaseOrderLineId: line.purchaseOrderLineId, acceptedQty: Number(line.acceptedQty), rejectedQty: Number(line.rejectedQty), receiptDate, confirmed: status === "confirmado" })),
        );
        if ("error" in lockedValidation) throw new Error(lockedValidation.error);

        const reference = await nextReference(tx, project.companyId, "EXP");
        const [created] = await tx.insert(purchaseOrderShipments).values({
          purchaseOrderId: id,
          reference,
          status: "rascunho",
          expectedDeliveryDate: parsed.data.expectedDeliveryDate || null,
          carrier: parsed.data.carrier ?? null,
          vehiclePlate: parsed.data.vehiclePlate ?? null,
          driverName: parsed.data.driverName ?? null,
          driverPhone: parsed.data.driverPhone ?? null,
          trackingReference: parsed.data.trackingReference ?? null,
          supplierNotes: parsed.data.notes ?? null,
          createdBySupplierAccountId: request.currentSupplier!.id,
        }).returning();
        await tx.insert(purchaseOrderShipmentLines).values(parsed.data.lines.map((line) => ({ shipmentId: created.id, purchaseOrderLineId: line.purchaseOrderLineId, quantity: line.quantity.toString() })));
        await tx.update(purchaseOrders).set({ fulfillmentStatus: lockedOrder.fulfillmentStatus === "parcialmente_recebido" ? "parcialmente_recebido" : "em_preparacao", lastSupplierUpdateAt: new Date() }).where(eq(purchaseOrders.id, id));
        return created;
      });
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível criar a expedição" });
    }
    await appendSupplierEvent({ orderId: id, supplierAccountId: request.currentSupplier!.id, type: "expedicao_criada", metadata: { shipmentId: shipment.id, reference: shipment.reference } });
    return reply.code(201).send(shipment);
  });

  app.post("/api/supplier/shipments/:id/ready", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    const [row] = await db.select({ shipment: purchaseOrderShipments, order: purchaseOrders }).from(purchaseOrderShipments).innerJoin(purchaseOrders, eq(purchaseOrderShipments.purchaseOrderId, purchaseOrders.id)).where(and(eq(purchaseOrderShipments.id, id), inArray(purchaseOrders.supplierId, supplierIds.length ? supplierIds : ["00000000-0000-0000-0000-000000000000"]))).limit(1);
    if (!row) return reply.code(404).send({ error: "Expedição não encontrada" });
    if (row.order.status !== "aprovado" || row.order.supplierConfirmationStatus !== "confirmado") return reply.code(409).send({ error: "A OC já não está activa/confirmada" });
    if (row.shipment.status !== "rascunho") return reply.code(409).send({ error: "Só uma expedição em preparação pode ficar pronta" });
    const [shipment] = await db.update(purchaseOrderShipments).set({ status: "pronto", readyAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrderShipments.id, id)).returning();
    await db.update(purchaseOrders).set({ fulfillmentStatus: row.order.fulfillmentStatus === "parcialmente_recebido" ? "parcialmente_recebido" : "pronto_expedir", lastSupplierUpdateAt: new Date() }).where(eq(purchaseOrders.id, row.order.id));
    await appendSupplierEvent({ orderId: row.order.id, supplierAccountId: request.currentSupplier!.id, type: "pronto_expedir", metadata: { shipmentId: id } });
    await notifyBuyerTeam(row.order.projectId, "Encomenda pronta para expedição", `${shipment.reference} está pronta para sair do fornecedor.`);
    return shipment;
  });

  app.post("/api/supplier/shipments/:id/cancel", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    const [row] = await db.select({ shipment: purchaseOrderShipments, order: purchaseOrders }).from(purchaseOrderShipments).innerJoin(purchaseOrders, eq(purchaseOrderShipments.purchaseOrderId, purchaseOrders.id)).where(and(eq(purchaseOrderShipments.id, id), inArray(purchaseOrders.supplierId, supplierIds.length ? supplierIds : ["00000000-0000-0000-0000-000000000000"]))).limit(1);
    if (!row) return reply.code(404).send({ error: "Expedição não encontrada" });
    if (row.shipment.status !== "rascunho" && row.shipment.status !== "pronto") return reply.code(409).send({ error: "Uma expedição já enviada ou entregue não pode ser anulada" });
    const [shipment] = await db.update(purchaseOrderShipments).set({ status: "cancelado", updatedAt: new Date() }).where(eq(purchaseOrderShipments.id, id)).returning();
    const summary = await computeOrderSummary(row.order);
    await db.update(purchaseOrders).set({ fulfillmentStatus: summary.fillRatePct > 0 ? "parcialmente_recebido" : "em_preparacao", lastSupplierUpdateAt: new Date() }).where(eq(purchaseOrders.id, row.order.id));
    await appendSupplierEvent({ orderId: row.order.id, supplierAccountId: request.currentSupplier!.id, type: "expedicao_cancelada", metadata: { shipmentId: id, reference: shipment.reference } });
    return shipment;
  });

  app.post("/api/supplier/shipments/:id/dispatch", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    const [row] = await db.select({ shipment: purchaseOrderShipments, order: purchaseOrders }).from(purchaseOrderShipments).innerJoin(purchaseOrders, eq(purchaseOrderShipments.purchaseOrderId, purchaseOrders.id)).where(and(eq(purchaseOrderShipments.id, id), inArray(purchaseOrders.supplierId, supplierIds.length ? supplierIds : ["00000000-0000-0000-0000-000000000000"]))).limit(1);
    if (!row) return reply.code(404).send({ error: "Expedição não encontrada" });
    if (row.order.status !== "aprovado" || row.order.supplierConfirmationStatus !== "confirmado") return reply.code(409).send({ error: "A OC já não está activa/confirmada" });
    if (row.shipment.status !== "pronto") return reply.code(409).send({ error: "Marque primeiro a expedição como pronta" });
    const [shipment] = await db.update(purchaseOrderShipments).set({ status: "expedido", dispatchedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrderShipments.id, id)).returning();
    await db.update(purchaseOrders).set({ fulfillmentStatus: row.order.fulfillmentStatus === "parcialmente_recebido" ? "parcialmente_recebido" : "em_transito", lastSupplierUpdateAt: new Date() }).where(eq(purchaseOrders.id, row.order.id));
    await appendSupplierEvent({ orderId: row.order.id, supplierAccountId: request.currentSupplier!.id, type: "expedido", metadata: { shipmentId: id, reference: shipment.reference } });
    await notifyBuyerTeam(row.order.projectId, "Material em trânsito", `${shipment.reference} saiu do fornecedor${shipment.expectedDeliveryDate ? `; previsão ${shipment.expectedDeliveryDate}` : ""}.`);
    return shipment;
  });

  // ---------- Empresa: acompanhamento, recepção e inspecção ----------
  app.get("/api/projects/:projectId/procurement/fulfillment", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select({ order: purchaseOrders, supplierName: suppliers.name }).from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(eq(purchaseOrders.projectId, projectId)).orderBy(desc(purchaseOrders.createdAt));
    const visible = rows.filter(({ order }) => order.status === "aprovado" || order.status === "recebido");
    return Promise.all(visible.map(async ({ order, supplierName }) => {
      const summary = await computeOrderSummary(order);
      return { ...order, fulfillmentStatus: summary.status, supplierConfirmationStatus: order.status === "recebido" ? "confirmado" : order.supplierConfirmationStatus, supplierName, summary };
    }));
  });

  app.get("/api/purchase-orders/:id/fulfillment", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await orderOwned(id, companyIdOf(request));
    if (!row) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    const [lines, shipments, receipts, summary] = await Promise.all([
      loadOrderLines(id),
      loadShipmentsWithLines(id),
      db.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, id)).orderBy(desc(goodsReceipts.receiptDate)),
      computeOrderSummary(row.order),
    ]);
    return { ...row.order, fulfillmentStatus: summary.status, supplierConfirmationStatus: row.order.status === "recebido" ? "confirmado" : row.order.supplierConfirmationStatus, supplierName: row.supplierName, lines: lines.map((entry) => ({ ...entry.line, materialName: entry.materialName, unit: entry.unit })), shipments, receipts, summary };
  });

  app.get("/api/projects/:projectId/goods-receipts", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select({ receipt: goodsReceipts, supplierName: suppliers.name }).from(goodsReceipts).innerJoin(purchaseOrders, eq(goodsReceipts.purchaseOrderId, purchaseOrders.id)).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(eq(goodsReceipts.projectId, projectId)).orderBy(desc(goodsReceipts.receiptDate));
    const ids = rows.map((row) => row.receipt.id);
    const lineRows = ids.length ? await db.select({ line: goodsReceiptLines, materialName: materials.name, unit: materials.unit }).from(goodsReceiptLines).innerJoin(materials, eq(goodsReceiptLines.materialId, materials.id)).where(inArray(goodsReceiptLines.goodsReceiptId, ids)) : [];
    return rows.map(({ receipt, supplierName }) => ({ ...receipt, supplierName, lines: lineRows.filter((entry) => entry.line.goodsReceiptId === receipt.id).map((entry) => ({ ...entry.line, materialName: entry.materialName, unit: entry.unit })) }));
  });

  app.post("/api/purchase-orders/:id/goods-receipts", { preHandler: receivePermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const owned = await orderOwned(id, companyId);
    if (!owned) return reply.code(404).send({ error: "Ordem de compra não encontrada" });
    if (owned.order.status !== "aprovado") return reply.code(409).send({ error: "Só OCs aprovadas podem receber material" });
    const parsed = receiptInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const activeShipments = await db.select({ id: purchaseOrderShipments.id, status: purchaseOrderShipments.status }).from(purchaseOrderShipments).where(eq(purchaseOrderShipments.purchaseOrderId, id));
    const activePhysicalShipments = activeShipments.filter((shipment) => ["rascunho", "pronto", "expedido"].includes(shipment.status));
    if (activePhysicalShipments.length && !parsed.data.shipmentId) {
      return reply.code(409).send({ error: "Esta OC tem uma expedição activa; associe a recepção à carga expedida ou peça ao fornecedor para anular/expedir a carga preparada" });
    }
    if (parsed.data.shipmentId) {
      const [shipment] = await db.select().from(purchaseOrderShipments).where(and(eq(purchaseOrderShipments.id, parsed.data.shipmentId), eq(purchaseOrderShipments.purchaseOrderId, id))).limit(1);
      if (!shipment) return reply.code(400).send({ error: "A expedição indicada não pertence a esta OC" });
      if (shipment.status !== "expedido" && shipment.status !== "entregue") return reply.code(409).send({ error: "A expedição ainda não saiu do fornecedor" });
      const existing = await db.select({ id: goodsReceipts.id, status: goodsReceipts.status }).from(goodsReceipts).where(eq(goodsReceipts.shipmentId, parsed.data.shipmentId));
      if (existing.some((receipt) => receipt.status !== "cancelado")) return reply.code(409).send({ error: "Esta expedição já tem uma recepção registada" });
      const shipmentLines = await db.select().from(purchaseOrderShipmentLines).where(eq(purchaseOrderShipmentLines.shipmentId, parsed.data.shipmentId));
      const shipmentQty = new Map(shipmentLines.map((line) => [line.purchaseOrderLineId, Number(line.quantity)]));
      for (const line of parsed.data.lines) {
        const expected = shipmentQty.get(line.purchaseOrderLineId);
        if (expected == null) return reply.code(400).send({ error: "A recepção contém um item que não consta desta expedição" });
        if (line.deliveredQty > Number(expected) + 0.0001) return reply.code(409).send({ error: "A quantidade entregue não pode exceder a declarada nesta expedição" });
      }
    }
    const [orderLines, previousReceipts] = await Promise.all([loadOrderLines(id), loadReceiptSnapshots(id)]);
    const validation = validateReceipt(orderLines.map(({ line }) => ({ id: line.id, materialId: line.materialId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })), previousReceipts, parsed.data.lines);
    if ("error" in validation) return reply.code(409).send({ error: validation.error });
    for (const line of parsed.data.lines) {
      if (line.rejectedQty > 0 && !line.rejectionReason?.trim()) return reply.code(400).send({ error: "Indique o motivo para toda quantidade rejeitada" });
    }

    let receipt: typeof goodsReceipts.$inferSelect;
    try {
      receipt = await db.transaction(async (tx) => {
        // O lock da OC serializa criação/confirmação de recepções e criação de expedições, para
        // impedir over-receipt quando duas pessoas registam material ao mesmo tempo.
        await tx.execute(sql`select id from purchase_orders where id = ${id} for update`);
        const [lockedOrder] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
        if (!lockedOrder || lockedOrder.status !== "aprovado") throw new Error("A OC deixou de estar disponível para recepção");
        const activeShipmentRows = await tx.select({ id: purchaseOrderShipments.id, status: purchaseOrderShipments.status }).from(purchaseOrderShipments).where(eq(purchaseOrderShipments.purchaseOrderId, id));
        const activePhysicalShipments = activeShipmentRows.filter((shipment: any) => ["rascunho", "pronto", "expedido"].includes(shipment.status));
        if (activePhysicalShipments.length && !parsed.data.shipmentId) throw new Error("Esta OC tem uma expedição activa; associe a recepção à carga expedida");

        let lockedShipmentLines: Array<typeof purchaseOrderShipmentLines.$inferSelect> | null = null;
        if (parsed.data.shipmentId) {
          await tx.execute(sql`select id from purchase_order_shipments where id = ${parsed.data.shipmentId} for update`);
          const [shipment] = await tx.select().from(purchaseOrderShipments).where(and(eq(purchaseOrderShipments.id, parsed.data.shipmentId), eq(purchaseOrderShipments.purchaseOrderId, id))).limit(1);
          if (!shipment) throw new Error("A expedição indicada não pertence a esta OC");
          if (shipment.status !== "expedido" && shipment.status !== "entregue") throw new Error("A expedição ainda não saiu do fornecedor");
          const existing = await tx.select({ id: goodsReceipts.id, status: goodsReceipts.status }).from(goodsReceipts).where(eq(goodsReceipts.shipmentId, parsed.data.shipmentId));
          if (existing.some((entry: any) => entry.status !== "cancelado")) throw new Error("Esta expedição já tem uma recepção registada");
          lockedShipmentLines = await tx.select().from(purchaseOrderShipmentLines).where(eq(purchaseOrderShipmentLines.shipmentId, parsed.data.shipmentId));
          const shipmentQty = new Map(lockedShipmentLines.map((line) => [line.purchaseOrderLineId, Number(line.quantity)]));
          for (const line of parsed.data.lines) {
            const expected = shipmentQty.get(line.purchaseOrderLineId);
            if (expected == null) throw new Error("A recepção contém um item que não consta desta expedição");
            if (line.deliveredQty > Number(expected) + 0.0001) throw new Error("A quantidade entregue não pode exceder a declarada nesta expedição");
          }
        }

        const [lockedOrderLines, lockedReceiptRows] = await Promise.all([
          tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)),
          tx.select({ line: goodsReceiptLines, receiptDate: goodsReceipts.receiptDate, status: goodsReceipts.status })
            .from(goodsReceiptLines)
            .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
            .where(eq(goodsReceipts.purchaseOrderId, id)),
        ]);
        const lockedValidation = validateReceipt(
          lockedOrderLines.map((line) => ({ id: line.id, materialId: line.materialId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
          lockedReceiptRows.map(({ line, receiptDate, status }) => ({ purchaseOrderLineId: line.purchaseOrderLineId, acceptedQty: Number(line.acceptedQty), rejectedQty: Number(line.rejectedQty), receiptDate, confirmed: status === "confirmado" })),
          parsed.data.lines,
        );
        if ("error" in lockedValidation) throw new Error(lockedValidation.error);

        const reference = await nextReference(tx, companyId, "REC");
        const [created] = await tx.insert(goodsReceipts).values({
          projectId: owned.order.projectId,
          purchaseOrderId: id,
          shipmentId: parsed.data.shipmentId ?? null,
          reference,
          receiptDate: parsed.data.receiptDate,
          deliveryNoteNumber: parsed.data.deliveryNoteNumber ?? null,
          inspectionNotes: parsed.data.inspectionNotes ?? null,
          status: "rascunho",
          receivedByUserId: request.currentUser!.id,
        }).returning();
        await tx.insert(goodsReceiptLines).values(parsed.data.lines.map((line) => {
          const orderLine = lockedOrderLines.find((entry) => entry.id === line.purchaseOrderLineId)!;
          return {
            goodsReceiptId: created.id,
            purchaseOrderLineId: line.purchaseOrderLineId,
            materialId: orderLine.materialId,
            deliveredQty: line.deliveredQty.toString(),
            acceptedQty: line.acceptedQty.toString(),
            rejectedQty: line.rejectedQty.toString(),
            rejectionReason: line.rejectionReason ?? null,
            conditionNotes: line.conditionNotes ?? null,
            unitCost: orderLine.unitCost,
            currency: orderLine.currency,
          };
        }));
        return created;
      });
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível criar a recepção" });
    }
    await recordAuditEvent({ companyId, projectId: owned.order.projectId, actorUserId: request.currentUser!.id, entityType: "goods_receipt", entityId: receipt.id, action: "created", after: { reference: receipt.reference, purchaseOrderId: id, lineCount: parsed.data.lines.length } });
    return reply.code(201).send(receipt);
  });

  app.post("/api/goods-receipts/:id/cancel", { preHandler: receivePermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const [row] = await db.select({ receipt: goodsReceipts, projectCompanyId: projects.companyId }).from(goodsReceipts).innerJoin(projects, eq(goodsReceipts.projectId, projects.id)).where(and(eq(goodsReceipts.id, id), eq(projects.companyId, companyId))).limit(1);
    if (!row) return reply.code(404).send({ error: "Recepção não encontrada" });
    if (row.receipt.status !== "rascunho") return reply.code(409).send({ error: "Uma recepção confirmada é imutável; corrija por movimento de ajuste devidamente auditado" });
    const [cancelled] = await db.update(goodsReceipts).set({ status: "cancelado" }).where(eq(goodsReceipts.id, id)).returning();
    await recordAuditEvent({ companyId, projectId: row.receipt.projectId, actorUserId: request.currentUser!.id, entityType: "goods_receipt", entityId: id, action: "cancelled", before: { status: "rascunho" }, after: { status: "cancelado" } });
    return cancelled;
  });

  app.post("/api/goods-receipts/:id/confirm", { preHandler: receivePermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const [row] = await db.select({ receipt: goodsReceipts, order: purchaseOrders, projectCompanyId: projects.companyId }).from(goodsReceipts).innerJoin(purchaseOrders, eq(goodsReceipts.purchaseOrderId, purchaseOrders.id)).innerJoin(projects, eq(goodsReceipts.projectId, projects.id)).where(and(eq(goodsReceipts.id, id), eq(projects.companyId, companyId))).limit(1);
    if (!row) return reply.code(404).send({ error: "Recepção não encontrada" });
    if (row.receipt.status !== "rascunho") return reply.code(409).send({ error: "Só uma recepção em rascunho pode ser confirmada" });

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from goods_receipts where id = ${id} for update`);
      await tx.execute(sql`select id from purchase_orders where id = ${row.order.id} for update`);
      const [locked] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1);
      if (!locked || locked.status !== "rascunho") throw new Error("Esta recepção já foi processada");
      const [lines, orderLines, allReceiptRowsBefore] = await Promise.all([
        tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, id)),
        tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, row.order.id)),
        tx.select({ line: goodsReceiptLines, status: goodsReceipts.status, receiptDate: goodsReceipts.receiptDate, receiptId: goodsReceipts.id })
          .from(goodsReceiptLines)
          .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
          .where(eq(goodsReceipts.purchaseOrderId, row.order.id)),
      ]);

      // Uma recepção pode ter sido criada quando ainda havia saldo, mas ficar em rascunho
      // enquanto outra é confirmada. Revalidamos sob lock imediatamente antes de afectar stock.
      const previousConfirmed = allReceiptRowsBefore
        .filter((entry) => entry.receiptId !== id)
        .map((entry) => ({ purchaseOrderLineId: entry.line.purchaseOrderLineId, acceptedQty: Number(entry.line.acceptedQty), rejectedQty: Number(entry.line.rejectedQty), receiptDate: entry.receiptDate, confirmed: entry.status === "confirmado" }));
      const confirmValidation = validateReceipt(
        orderLines.map((line) => ({ id: line.id, materialId: line.materialId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
        previousConfirmed,
        lines.map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, deliveredQty: Number(line.deliveredQty), acceptedQty: Number(line.acceptedQty), rejectedQty: Number(line.rejectedQty) })),
      );
      if ("error" in confirmValidation) throw new Error(confirmValidation.error);

      for (const line of lines) {
        if (Number(line.acceptedQty) <= 0) continue;
        await tx.insert(stockMovements).values({
          projectId: row.order.projectId,
          materialId: line.materialId,
          type: "entrada",
          quantity: line.acceptedQty,
          unitCost: line.unitCost,
          currency: line.currency,
          notes: `Entrada por recepção ${row.receipt.reference}`,
          purchaseOrderId: row.order.id,
          goodsReceiptLineId: line.id,
          createdByUserId: request.currentUser!.id,
          date: row.receipt.receiptDate,
        }).onConflictDoNothing();
      }
      // Toda rejeição confirmada vira uma não-conformidade formal. O texto de inspecção já
      // existia na recepção; agora ganha referência, workflow e resposta do fornecedor.
      for (const line of lines) {
        if (Number(line.rejectedQty) <= 0) continue;
        const existing = await tx.select({ id: procurementNonconformities.id }).from(procurementNonconformities).where(eq(procurementNonconformities.goodsReceiptLineId, line.id)).limit(1);
        if (existing.length) continue;
        const reference = await nextReference(tx, companyId, "NCR");
        await tx.insert(procurementNonconformities).values({
          companyId,
          projectId: row.order.projectId,
          purchaseOrderId: row.order.id,
          goodsReceiptLineId: line.id,
          materialId: line.materialId,
          reference,
          rejectedQty: line.rejectedQty,
          status: "aguarda_fornecedor",
          description: line.rejectionReason ?? line.conditionNotes ?? `Material rejeitado na recepção ${row.receipt.reference}`,
          createdByUserId: request.currentUser!.id,
        });
      }
      const [confirmed] = await tx.update(goodsReceipts).set({ status: "confirmado", confirmedAt: new Date(), confirmedByUserId: request.currentUser!.id }).where(eq(goodsReceipts.id, id)).returning();
      if (row.receipt.shipmentId) await tx.update(purchaseOrderShipments).set({ status: "entregue", deliveredAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrderShipments.id, row.receipt.shipmentId));

      const [allReceiptRows, shipmentRows] = await Promise.all([
        tx.select({ line: goodsReceiptLines, status: goodsReceipts.status, receiptDate: goodsReceipts.receiptDate })
          .from(goodsReceiptLines)
          .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
          .where(eq(goodsReceipts.purchaseOrderId, row.order.id)),
        tx.select({ line: purchaseOrderShipmentLines, shipmentStatus: purchaseOrderShipments.status })
          .from(purchaseOrderShipmentLines)
          .innerJoin(purchaseOrderShipments, eq(purchaseOrderShipmentLines.shipmentId, purchaseOrderShipments.id))
          .where(eq(purchaseOrderShipments.purchaseOrderId, row.order.id)),
      ]);
      const summary = summarizeFulfillment(
        orderLines.map((line) => ({ id: line.id, materialId: line.materialId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
        shipmentRows.map(({ line, shipmentStatus }) => ({ purchaseOrderLineId: line.purchaseOrderLineId, quantity: Number(line.quantity), shipmentStatus })),
        allReceiptRows.map((entry) => ({ purchaseOrderLineId: entry.line.purchaseOrderLineId, acceptedQty: Number(entry.line.acceptedQty), rejectedQty: Number(entry.line.rejectedQty), receiptDate: entry.receiptDate, confirmed: entry.status === "confirmado" })),
        row.order.fulfillmentStatus as FulfillmentStatus,
      );
      const orderPatch = summary.fullyAccepted
        ? { status: "recebido" as const, fulfillmentStatus: "recebido" as const }
        : { fulfillmentStatus: "parcialmente_recebido" as const };
      await tx.update(purchaseOrders).set({ ...orderPatch, lastSupplierUpdateAt: row.order.lastSupplierUpdateAt }).where(eq(purchaseOrders.id, row.order.id));
      if (row.order.purchaseRequisitionId) await syncRequisitionStatus(tx, row.order.purchaseRequisitionId);
      return { confirmed, summary };
    });
    await recordAuditEvent({ companyId, projectId: row.order.projectId, actorUserId: request.currentUser!.id, entityType: "goods_receipt", entityId: id, action: "confirmed", after: { reference: row.receipt.reference, fullyAccepted: result.summary.fullyAccepted, fillRatePct: result.summary.fillRatePct, rejectionRatePct: result.summary.rejectionRatePct } });
    const [supplier] = await db.select({ supplierAccountId: suppliers.supplierAccountId }).from(suppliers).where(eq(suppliers.id, row.order.supplierId)).limit(1);
    if (supplier?.supplierAccountId) await notifySupplierAccount(supplier.supplierAccountId, "Recepção registada", `${row.receipt.reference} foi confirmada pela obra.`, `/ordens/${row.order.id}`);
    return { ...result.confirmed, summary: result.summary };
  });

  // ---------- Performance do fornecedor ----------
  app.get("/api/suppliers/:supplierId/performance", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { supplierId } = request.params as { supplierId: string };
    const { projectId } = request.query as { projectId?: string };
    const companyId = companyIdOf(request);
    if (projectId && !(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.companyId, companyId));
    const projectIds = projectRows.map((row) => row.id);
    if (!projectIds.length) return computeSupplierPerformance([]);
    const orders = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.supplierId, supplierId), inArray(purchaseOrders.projectId, projectId ? [projectId] : projectIds)));
    return computePerformanceForOrders(orders);
  });

  app.get("/api/supplier/performance", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    if (!supplierIds.length) return computeSupplierPerformance([]);
    const orders = await db.select().from(purchaseOrders).where(inArray(purchaseOrders.supplierId, supplierIds));
    return computePerformanceForOrders(orders);
  });
}

async function computePerformanceForOrders(orders: Array<typeof purchaseOrders.$inferSelect>) {
  const snapshots: SupplierPerformanceOrder[] = [];
  for (const order of orders) {
    if (order.status === "rascunho" || order.status === "cancelado") continue;
    const [summary, receiptSnapshots] = await Promise.all([
      computeOrderSummary(order),
      loadReceiptSnapshots(order.id),
    ]);
    const confirmedDates = receiptSnapshots.filter((row) => row.confirmed).map((row) => row.receiptDate).sort();
    snapshots.push({
      orderId: order.id,
      requiredByDate: order.requiredByDate,
      promisedDeliveryDate: order.promisedDeliveryDate,
      approvedAt: order.approvedAt?.toISOString() ?? null,
      supplierConfirmedAt: order.supplierConfirmedAt?.toISOString() ?? null,
      finalReceiptDate: summary.fullyAccepted ? (confirmedDates.at(-1) ?? null) : null,
      fullyAccepted: summary.fullyAccepted,
      orderedValue: summary.orderedValue,
      acceptedValue: summary.acceptedValue,
      rejectedValue: summary.rejectedValue,
      completed: order.status === "recebido" || order.fulfillmentStatus === "fechado",
    });
  }
  return computeSupplierPerformance(snapshots);
}
