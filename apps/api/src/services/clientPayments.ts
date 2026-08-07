import { and, asc, eq, max } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  projectClientPaymentPlans,
  projectClientPaymentInstallments,
  projectContracts,
  projectInvoices,
} from "../db/schema.js";

export type ClientPaymentPlanView = {
  id: string;
  projectId: string;
  mode: "total" | "parcelado";
  currency: string;
  totalAmount: number;
  notes: string | null;
  installments: Array<{
    id: string;
    sequence: number;
    title: string;
    dueDate: string;
    amount: number;
    status: "prevista" | "parcial" | "paga" | "atrasada";
    paidAmount: number;
    paidAt: string | null;
    invoiceId: string | null;
  }>;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function deriveStatus(status: "prevista" | "parcial" | "paga", dueDate: string): ClientPaymentPlanView["installments"][number]["status"] {
  if (status === "paga") return "paga";
  if (dueDate < todayIso()) return "atrasada";
  return status;
}

function mapInstallment(row: typeof projectClientPaymentInstallments.$inferSelect): ClientPaymentPlanView["installments"][number] {
  return {
    id: row.id,
    sequence: row.sequence,
    title: row.title,
    dueDate: row.dueDate,
    amount: Number(row.amount),
    status: deriveStatus(row.status, row.dueDate),
    paidAmount: Number(row.paidAmount),
    paidAt: row.paidAt,
    invoiceId: row.invoiceId,
  };
}

export async function getClientPaymentPlan(projectId: string): Promise<ClientPaymentPlanView | null> {
  const [plan] = await db.select().from(projectClientPaymentPlans).where(eq(projectClientPaymentPlans.projectId, projectId)).limit(1);
  if (!plan) return null;
  const rows = await db
    .select()
    .from(projectClientPaymentInstallments)
    .where(eq(projectClientPaymentInstallments.planId, plan.id))
    .orderBy(asc(projectClientPaymentInstallments.sequence), asc(projectClientPaymentInstallments.dueDate));
  return {
    id: plan.id,
    projectId: plan.projectId,
    mode: plan.mode,
    currency: plan.currency,
    totalAmount: Number(plan.totalAmount),
    notes: plan.notes,
    installments: rows.map(mapInstallment),
  };
}

export async function suggestedContractTotal(projectId: string): Promise<{ amount: number; currency: string } | null> {
  const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.projectId, projectId)).limit(1);
  if (!contract) return null;
  return { amount: Number(contract.originalAmount), currency: contract.currency };
}

export async function upsertClientPaymentPlan(
  projectId: string,
  input: {
    mode: "total" | "parcelado";
    currency: "MZN" | "USD";
    totalAmount: number;
    notes?: string | null;
    /** Em modo total, substitui por uma única parcela. */
    singleDueDate?: string;
    singleTitle?: string;
  },
): Promise<ClientPaymentPlanView> {
  const existing = await getClientPaymentPlan(projectId);
  let planId: string;
  if (existing) {
    await db
      .update(projectClientPaymentPlans)
      .set({
        mode: input.mode,
        currency: input.currency,
        totalAmount: input.totalAmount.toFixed(2),
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(projectClientPaymentPlans.id, existing.id));
    planId = existing.id;
  } else {
    const [created] = await db
      .insert(projectClientPaymentPlans)
      .values({
        projectId,
        mode: input.mode,
        currency: input.currency,
        totalAmount: input.totalAmount.toFixed(2),
        notes: input.notes ?? null,
      })
      .returning();
    planId = created.id;
  }

  if (input.mode === "total") {
    await db.delete(projectClientPaymentInstallments).where(eq(projectClientPaymentInstallments.planId, planId));
    const dueDate = input.singleDueDate ?? todayIso();
    await db.insert(projectClientPaymentInstallments).values({
      planId,
      sequence: 1,
      title: input.singleTitle?.trim() || "Pagamento total",
      dueDate,
      amount: input.totalAmount.toFixed(2),
      status: "prevista",
      paidAmount: "0",
    });
  }

  const view = await getClientPaymentPlan(projectId);
  if (!view) throw new Error("Plano não encontrado após guardar");
  return view;
}

export async function addInstallment(
  projectId: string,
  input: { title: string; dueDate: string; amount: number; sequence?: number },
): Promise<ClientPaymentPlanView["installments"][number]> {
  let plan = await getClientPaymentPlan(projectId);
  if (!plan) {
    const suggestion = await suggestedContractTotal(projectId);
    plan = await upsertClientPaymentPlan(projectId, {
      mode: "parcelado",
      currency: (suggestion?.currency as "MZN" | "USD") ?? "MZN",
      totalAmount: suggestion?.amount ?? 0,
    });
  }
  if (plan.mode === "total") {
    await db
      .update(projectClientPaymentPlans)
      .set({ mode: "parcelado", updatedAt: new Date() })
      .where(eq(projectClientPaymentPlans.id, plan.id));
  }

  let sequence = input.sequence;
  if (sequence == null) {
    const [agg] = await db
      .select({ maxSeq: max(projectClientPaymentInstallments.sequence) })
      .from(projectClientPaymentInstallments)
      .where(eq(projectClientPaymentInstallments.planId, plan.id));
    sequence = (agg?.maxSeq ?? 0) + 1;
  }

  const [row] = await db
    .insert(projectClientPaymentInstallments)
    .values({
      planId: plan.id,
      sequence,
      title: input.title.trim(),
      dueDate: input.dueDate,
      amount: input.amount.toFixed(2),
      status: "prevista",
      paidAmount: "0",
    })
    .returning();

  await recalculatePlanTotal(plan.id);
  return mapInstallment(row);
}

export async function updateInstallment(
  projectId: string,
  installmentId: string,
  patch: Partial<{ title: string; dueDate: string; amount: number; sequence: number }>,
): Promise<ClientPaymentPlanView["installments"][number] | null> {
  const owned = await findOwnedInstallment(projectId, installmentId);
  if (!owned) return null;
  const [row] = await db
    .update(projectClientPaymentInstallments)
    .set({
      ...(patch.title != null ? { title: patch.title.trim() } : {}),
      ...(patch.dueDate != null ? { dueDate: patch.dueDate } : {}),
      ...(patch.amount != null ? { amount: patch.amount.toFixed(2) } : {}),
      ...(patch.sequence != null ? { sequence: patch.sequence } : {}),
    })
    .where(eq(projectClientPaymentInstallments.id, installmentId))
    .returning();
  await recalculatePlanTotal(owned.planId);
  return mapInstallment(row);
}

export async function deleteInstallment(projectId: string, installmentId: string): Promise<boolean> {
  const owned = await findOwnedInstallment(projectId, installmentId);
  if (!owned) return false;
  await db.delete(projectClientPaymentInstallments).where(eq(projectClientPaymentInstallments.id, installmentId));
  await recalculatePlanTotal(owned.planId);
  return true;
}

export async function markInstallmentPaid(
  projectId: string,
  installmentId: string,
  input: { paidAmount?: number; paidAt?: string; invoiceId?: string | null },
): Promise<ClientPaymentPlanView["installments"][number] | null> {
  const owned = await findOwnedInstallment(projectId, installmentId);
  if (!owned) return null;

  if (input.invoiceId) {
    const [invoice] = await db
      .select()
      .from(projectInvoices)
      .where(and(eq(projectInvoices.id, input.invoiceId), eq(projectInvoices.projectId, projectId)))
      .limit(1);
    if (!invoice) return null;
  }

  const amount = Number(owned.amount);
  const paidAmount = input.paidAmount != null ? Math.min(Math.max(0, input.paidAmount), amount) : amount;
  const status = paidAmount <= 0 ? "prevista" : paidAmount + 0.009 >= amount ? "paga" : "parcial";
  const [row] = await db
    .update(projectClientPaymentInstallments)
    .set({
      paidAmount: paidAmount.toFixed(2),
      status,
      paidAt: status === "prevista" ? null : (input.paidAt ?? todayIso()),
      invoiceId: input.invoiceId === undefined ? owned.invoiceId : input.invoiceId,
    })
    .where(eq(projectClientPaymentInstallments.id, installmentId))
    .returning();
  return mapInstallment(row);
}

async function findOwnedInstallment(projectId: string, installmentId: string) {
  const [row] = await db
    .select({
      id: projectClientPaymentInstallments.id,
      planId: projectClientPaymentInstallments.planId,
      amount: projectClientPaymentInstallments.amount,
      invoiceId: projectClientPaymentInstallments.invoiceId,
      projectId: projectClientPaymentPlans.projectId,
    })
    .from(projectClientPaymentInstallments)
    .innerJoin(projectClientPaymentPlans, eq(projectClientPaymentInstallments.planId, projectClientPaymentPlans.id))
    .where(and(eq(projectClientPaymentInstallments.id, installmentId), eq(projectClientPaymentPlans.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

async function recalculatePlanTotal(planId: string) {
  const rows = await db
    .select({ amount: projectClientPaymentInstallments.amount })
    .from(projectClientPaymentInstallments)
    .where(eq(projectClientPaymentInstallments.planId, planId));
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  await db
    .update(projectClientPaymentPlans)
    .set({ totalAmount: total.toFixed(2), updatedAt: new Date() })
    .where(eq(projectClientPaymentPlans.id, planId));
}
