import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, and, or, isNull, desc, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import { purchaseOrders, purchaseOrderLines, stockMovements, suppliers, materials, budgetDocuments, financialEntries, scheduleTasks, supplierAccounts } from "../db/schema.js";
import { requireCompanyUser, requirePermission, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { assertApprovedOrcamentoForSite } from "../services/siteGate.js";
import { calculateVatTotals, CURRENCIES } from "@sigo/shared";
import { computeProcurementPlan } from "../services/procurementEngine.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";
import { resolveBuyerContact } from "../services/buyerContact.js";
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
  if (!account?.email) return;
  const buyer = await resolveBuyerContact(companyId, buyerUserId);
  const contactLines = [
    buyer.buyerName ? `<strong>${escapeHtml(buyer.buyerName)}</strong>` : null,
    buyer.buyerEmail ? escapeHtml(buyer.buyerEmail) : null,
    buyer.companyPhone ? escapeHtml(buyer.companyPhone) : null,
  ].filter(Boolean);
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
          unitCost: "0",
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
    if (parsed.data.status === "aprovado" && order.createdByUserId === user.id && user.role !== "admin_empresa") {
      return reply.code(409).send({ error: "Quem criou a ordem não pode aprová-la" });
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
      const [row] = await tx.update(purchaseOrders).set({ status: parsed.data.status }).where(eq(purchaseOrders.id, id)).returning();

      if (parsed.data.status === "aprovado") {
        const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
        const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, lockedOrder.supplierId)).limit(1);
        const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0);
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
    if (movement.purchaseOrderId || movement.diaryEntryId) {
      return reply.code(409).send({ error: "Este movimento foi gerado por outro módulo e deve ser corrigido na sua origem" });
    }
    await db.delete(stockMovements).where(eq(stockMovements.id, id));
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

    const byMaterial = new Map<string, { materialId: string; unit: string; balance: number; valueIn: number }>();
    for (const r of rows) {
      const bucket = byMaterial.get(r.materialName) ?? { materialId: r.movement.materialId, unit: r.materialUnit, balance: 0, valueIn: 0 };
      const qty = Number(r.movement.quantity);
      if (r.movement.type === "entrada") {
        bucket.balance += qty;
        bucket.valueIn += qty * Number(r.movement.unitCost ?? 0);
      } else {
        bucket.balance -= qty;
      }
      byMaterial.set(r.materialName, bucket);
    }
    return Array.from(byMaterial.entries())
      .map(([materialName, v]) => ({ materialName, materialId: v.materialId, unit: v.unit, balance: v.balance, valueIn: v.valueIn }))
      .sort((a, b) => a.materialName.localeCompare(b.materialName, "pt"));
  });
}
