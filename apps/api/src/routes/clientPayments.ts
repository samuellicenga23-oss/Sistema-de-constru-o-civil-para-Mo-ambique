import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CURRENCIES } from "@sigo/shared";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import {
  addInstallment,
  deleteInstallment,
  getClientPaymentPlan,
  markInstallmentPaid,
  suggestedContractTotal,
  updateInstallment,
  upsertClientPaymentPlan,
} from "../services/clientPayments.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const planSchema = z.object({
  mode: z.enum(["total", "parcelado"]),
  currency: z.enum(CURRENCIES).default("MZN"),
  totalAmount: z.number().nonnegative(),
  notes: z.string().max(2000).nullable().optional(),
  singleDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  singleTitle: z.string().max(200).optional(),
});

const installmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  sequence: z.number().int().positive().optional(),
});

const installmentUpdateSchema = installmentSchema.partial();

const markPaidSchema = z.object({
  paidAmount: z.number().nonnegative().optional(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invoiceId: z.string().uuid().nullable().optional(),
});

export async function clientPaymentRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/client-payment-plan", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const plan = await getClientPaymentPlan(projectId);
    const suggestion = await suggestedContractTotal(projectId);
    return { plan, suggestion };
  });

  app.put("/api/projects/:projectId/client-payment-plan", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = planSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const plan = await upsertClientPaymentPlan(projectId, parsed.data);
    return plan;
  });

  app.post("/api/projects/:projectId/client-payment-plan/installments", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = installmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await addInstallment(projectId, parsed.data);
    return reply.code(201).send(row);
  });

  app.put("/api/projects/:projectId/client-payment-plan/installments/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = installmentUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await updateInstallment(projectId, id, parsed.data);
    if (!row) return reply.code(404).send({ error: "Parcela não encontrada" });
    return row;
  });

  app.delete("/api/projects/:projectId/client-payment-plan/installments/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const ok = await deleteInstallment(projectId, id);
    if (!ok) return reply.code(404).send({ error: "Parcela não encontrada" });
    return { ok: true };
  });

  app.post("/api/projects/:projectId/client-payment-plan/installments/:id/mark-paid", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = markPaidSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await markInstallmentPaid(projectId, id, parsed.data);
    if (!row) return reply.code(404).send({ error: "Parcela não encontrada" });
    return row;
  });
}
