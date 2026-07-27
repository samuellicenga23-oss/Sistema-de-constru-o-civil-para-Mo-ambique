import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { purchaseOrders, purchaseOrderLines, stockMovements, suppliers, materials, budgetDocuments, financialEntries, scheduleTasks } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { CURRENCIES } from "@sigo/shared";
import { computeProcurementPlan } from "../services/procurementEngine.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

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
    const documents = await db.select().from(budgetDocuments).where(eq(budgetDocuments.projectId, projectId)).orderBy(desc(budgetDocuments.createdAt));
    const document = budgetDocumentId
      ? documents.find((item) => item.id === budgetDocumentId)
      : documents.find((item) => item.status === "aprovado" && item.currency === project.currency) ?? documents.find((item) => item.currency === project.currency);
    if (!document) return reply.code(404).send({ error: "Crie primeiro um Mapa de Quantidades para gerar necessidades de compra" });

    return computeProcurementPlan({ projectId, documentId: document.id, companyId, zoneId: project.zoneId, currency: project.currency });
  });

  // ---------- Ordens de compra ----------
  app.get("/api/projects/:projectId/purchase-orders", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const orders = await db
      .select({ order: purchaseOrders, supplierName: suppliers.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(eq(purchaseOrders.projectId, projectId))
      .orderBy(desc(purchaseOrders.orderDate));

    return Promise.all(
      orders.map(async (o) => ({
        ...o.order,
        supplierName: o.supplierName,
        lines: (await getOrderWithLines(o.order.id)).map((l) => ({ ...l.line, materialName: l.materialName, unit: l.materialUnit })),
      }))
    );
  });

  app.post("/api/projects/:projectId/purchase-orders", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = purchaseOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.lines.some((line) => line.currency !== project.currency)) {
      return reply.code(400).send({ error: `Todas as linhas devem usar a moeda da obra (${project.currency})` });
    }

    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, parsed.data.supplierId), eq(suppliers.companyId, companyId)))
      .limit(1);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });

    if (parsed.data.scheduleTaskId) {
      const [task] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, parsed.data.scheduleTaskId)).limit(1);
      if (!task || task.projectId !== projectId) return reply.code(400).send({ error: "A actividade seleccionada não pertence ao cronograma desta obra" });
    }

    for (const line of parsed.data.lines) {
      const material = await findVisibleMaterial(line.materialId, companyId);
      if (!material) return reply.code(404).send({ error: "Material não encontrado no Catálogo" });
    }

    const [order] = await db
      .insert(purchaseOrders)
      .values({
        projectId,
        supplierId: parsed.data.supplierId,
        orderDate: parsed.data.orderDate,
        requiredByDate: parsed.data.requiredByDate,
        scheduleTaskId: parsed.data.scheduleTaskId,
        notes: parsed.data.notes,
        createdByUserId: request.currentUser!.id,
      })
      .returning();

    await db.insert(purchaseOrderLines).values(
      parsed.data.lines.map((l) => ({
        purchaseOrderId: order.id,
        materialId: l.materialId,
        quantity: l.quantity.toString(),
        unitCost: l.unitCost.toString(),
        currency: l.currency,
      }))
    );

    const lines = (await getOrderWithLines(order.id)).map((l) => ({ ...l.line, materialName: l.materialName, unit: l.materialUnit }));
    return reply.code(201).send({ ...order, supplierName: supplier.name, lines });
  });

  // Mudar de estado — "recebido" gera automaticamente as entradas de stock (uma por linha), tal
  // como o fluxo do documento comercial descreve (recepção do material → entrada no armazém).
  // Só se gera uma vez: se já existirem movimentos de stock ligados a esta ordem, não duplica.
  app.put("/api/purchase-orders/:id/status", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await assertPurchaseOrderOwned(id, companyIdOf(request));
    if (!order) return reply.code(404).send({ error: "Ordem de compra não encontrada" });

    const parsed = z.object({ status: z.enum(["rascunho", "aprovado", "recebido", "cancelado"]), effectiveDate: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const transitions: Record<typeof order.status, typeof order.status[]> = {
      rascunho: ["aprovado", "cancelado"],
      aprovado: ["recebido", "cancelado"],
      recebido: [],
      cancelado: [],
    };
    if (parsed.data.status !== order.status && !transitions[order.status].includes(parsed.data.status)) {
      return reply.code(409).send({ error: `A ordem ${order.status} não pode passar para ${parsed.data.status}` });
    }

    const [row] = await db.update(purchaseOrders).set({ status: parsed.data.status }).where(eq(purchaseOrders.id, id)).returning();

    if (parsed.data.status === "aprovado") {
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
      const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, order.supplierId)).limit(1);
      const amount = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0);
      const [existing] = await db
        .select()
        .from(financialEntries)
        .where(and(eq(financialEntries.projectId, order.projectId), eq(financialEntries.sourceType, "purchase_order"), eq(financialEntries.sourceId, id)))
        .limit(1);
      if (!existing && amount > 0) {
        await db.insert(financialEntries).values({
          projectId: order.projectId,
          type: "despesa",
          category: "Compras e materiais",
          description: `Compromisso automático da ordem de compra · ${supplier?.name ?? "Fornecedor"}`,
          amount: amount.toFixed(2),
          currency: lines[0]?.currency ?? "MZN",
          dueDate: order.requiredByDate ?? order.orderDate,
          status: "pendente",
          sourceType: "purchase_order",
          sourceId: id,
          createdByUserId: request.currentUser!.id,
        });
      }
    }

    if (parsed.data.status === "cancelado") {
      await db.delete(financialEntries).where(and(
        eq(financialEntries.projectId, order.projectId),
        eq(financialEntries.sourceType, "purchase_order"),
        eq(financialEntries.sourceId, id),
        eq(financialEntries.status, "pendente")
      ));
    }

    if (parsed.data.status === "recebido") {
      const [existingMovement] = await db.select().from(stockMovements).where(eq(stockMovements.purchaseOrderId, id)).limit(1);
      if (!existingMovement) {
        const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
        if (lines.length) {
          await db.insert(stockMovements).values(
            lines.map((l) => ({
              projectId: order.projectId,
              materialId: l.materialId,
              type: "entrada" as const,
              quantity: l.quantity,
              unitCost: l.unitCost,
              currency: l.currency,
              notes: "Entrada automática — recepção da ordem de compra",
              purchaseOrderId: id,
              createdByUserId: request.currentUser!.id,
              date: parsed.data.effectiveDate ?? new Date().toISOString().slice(0, 10),
            }))
          );
        }
      }
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
    const [row] = await db
      .insert(stockMovements)
      .values({
        ...rest,
        projectId,
        quantity: quantity.toString(),
        unitCost: unitCost !== undefined ? unitCost.toString() : null,
        createdByUserId: request.currentUser!.id,
      })
      .returning();
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
