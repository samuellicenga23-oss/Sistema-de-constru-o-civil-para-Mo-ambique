import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { financialEntries, budgetDocuments } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { getBudgetDocumentSummary } from "../services/boqEngine.js";
import { CURRENCIES } from "@sigo/shared";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const entrySchema = z.object({
  type: z.enum(["receita", "despesa"]),
  category: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().positive(),
  currency: z.enum(CURRENCIES).default("MZN"),
  dueDate: z.string().optional(),
  paidDate: z.string().optional(),
  status: z.enum(["pendente", "pago"]).default("pendente"),
});
const entryUpdateSchema = entrySchema.partial();

async function assertEntryOwned(entryId: string, companyId: string) {
  const [entry] = await db.select().from(financialEntries).where(eq(financialEntries.id, entryId)).limit(1);
  if (!entry) return null;
  const project = await assertProjectOwned(entry.projectId, companyId);
  return project ? entry : null;
}

export async function financialRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/financial-entries", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.projectId, projectId))
      .orderBy(desc(financialEntries.dueDate), desc(financialEntries.createdAt));
  });

  app.post("/api/projects/:projectId/financial-entries", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = entrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { amount, ...rest } = parsed.data;
    const [row] = await db
      .insert(financialEntries)
      .values({ ...rest, projectId, amount: amount.toString(), createdByUserId: request.currentUser!.id })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/financial-entries/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Lançamento não encontrado" });

    const parsed = entryUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { amount, ...rest } = parsed.data;
    const [row] = await db
      .update(financialEntries)
      .set({ ...rest, amount: amount !== undefined ? amount.toString() : undefined })
      .where(eq(financialEntries.id, id))
      .returning();
    return row;
  });

  app.delete("/api/financial-entries/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return { ok: true };
    await db.delete(financialEntries).where(eq(financialEntries.id, id));
    return { ok: true };
  });

  // Resumo financeiro do projecto: valor contratado (do Mapa de Quantidades mais recente),
  // valor recebido/pago (lançamentos com status "pago"), contas a pagar/receber (lançamentos
  // "pendente"), saldo e margem operacional realizada. A margem aqui é sempre recebido − pago
  // com dinheiro real — não existe no sistema uma distinção entre "preço de venda" e "custo
  // interno" por item do orçamento, por isso não se calcula (nem se inventa) uma margem
  // "prevista" a partir do Mapa de Quantidades.
  app.get("/api/projects/:projectId/financial-summary", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const [latestDocument] = await db
      .select()
      .from(budgetDocuments)
      .where(eq(budgetDocuments.projectId, projectId))
      .orderBy(desc(budgetDocuments.createdAt))
      .limit(1);
    const summary = latestDocument ? await getBudgetDocumentSummary(latestDocument.id) : null;
    const valorContratado = summary?.total ?? 0;

    const entries = await db.select().from(financialEntries).where(eq(financialEntries.projectId, projectId));

    let valorRecebido = 0;
    let custoRealizado = 0;
    let contasAReceber = 0;
    let contasAPagar = 0;
    const cashFlowByMonth = new Map<string, { receitas: number; despesas: number }>();

    for (const e of entries) {
      const amount = Number(e.amount);
      if (e.type === "receita") {
        if (e.status === "pago") {
          valorRecebido += amount;
          const month = (e.paidDate ?? e.createdAt.toISOString().slice(0, 10)).slice(0, 7);
          const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
          bucket.receitas += amount;
          cashFlowByMonth.set(month, bucket);
        } else {
          contasAReceber += amount;
        }
      } else {
        if (e.status === "pago") {
          custoRealizado += amount;
          const month = (e.paidDate ?? e.createdAt.toISOString().slice(0, 10)).slice(0, 7);
          const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
          bucket.despesas += amount;
          cashFlowByMonth.set(month, bucket);
        } else {
          contasAPagar += amount;
        }
      }
    }

    const fluxoCaixaMensal = Array.from(cashFlowByMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, receitas: v.receitas, despesas: v.despesas, saldo: v.receitas - v.despesas }));

    return {
      currency: project.currency,
      valorContratado,
      valorRecebido,
      custoRealizado,
      contasAReceber,
      contasAPagar,
      saldo: valorRecebido - custoRealizado,
      margemRealizada: valorRecebido - custoRealizado,
      fluxoCaixaMensal,
    };
  });
}
