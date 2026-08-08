import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  projects,
  budgetDocuments,
  scheduleTasks,
  siteDiaryEntries,
  projectClientShareSettings,
  projectClientPaymentPlans,
  projectClientPaymentInstallments,
  projectContracts,
  contractVariations,
} from "../db/schema.js";
import { getMeasurementDashboard } from "./measurementEngine.js";
import { calendarDaysUntil, localTodayIso } from "../lib/calendarDate.js";

export type ShareSettings = {
  showProgress: boolean;
  showCertifiedValue: boolean;
  showContractValue: boolean;
  showSchedule: boolean;
  showCurrentPhase: boolean;
  showDiaryEvidences: boolean;
  showPaymentSchedule: boolean;
  showNextPayment: boolean;
};

const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  showProgress: true,
  showCertifiedValue: true,
  showContractValue: true,
  showSchedule: true,
  showCurrentPhase: true,
  showDiaryEvidences: true,
  showPaymentSchedule: true,
  showNextPayment: true,
};

export async function ensureShareSettings(projectId: string): Promise<ShareSettings> {
  const [existing] = await db
    .select()
    .from(projectClientShareSettings)
    .where(eq(projectClientShareSettings.projectId, projectId))
    .limit(1);
  if (existing) {
    return {
      showProgress: existing.showProgress,
      showCertifiedValue: existing.showCertifiedValue,
      showContractValue: existing.showContractValue,
      showSchedule: existing.showSchedule,
      showCurrentPhase: existing.showCurrentPhase,
      showDiaryEvidences: existing.showDiaryEvidences,
      showPaymentSchedule: existing.showPaymentSchedule,
      showNextPayment: existing.showNextPayment,
    };
  }
  const [created] = await db
    .insert(projectClientShareSettings)
    .values({ projectId, ...DEFAULT_SHARE_SETTINGS })
    .returning();
  return {
    showProgress: created.showProgress,
    showCertifiedValue: created.showCertifiedValue,
    showContractValue: created.showContractValue,
    showSchedule: created.showSchedule,
    showCurrentPhase: created.showCurrentPhase,
    showDiaryEvidences: created.showDiaryEvidences,
    showPaymentSchedule: created.showPaymentSchedule,
    showNextPayment: created.showNextPayment,
  };
}

export async function updateShareSettings(projectId: string, patch: Partial<ShareSettings>): Promise<ShareSettings> {
  await ensureShareSettings(projectId);
  const [row] = await db
    .update(projectClientShareSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projectClientShareSettings.projectId, projectId))
    .returning();
  return {
    showProgress: row.showProgress,
    showCertifiedValue: row.showCertifiedValue,
    showContractValue: row.showContractValue,
    showSchedule: row.showSchedule,
    showCurrentPhase: row.showCurrentPhase,
    showDiaryEvidences: row.showDiaryEvidences,
    showPaymentSchedule: row.showPaymentSchedule,
    showNextPayment: row.showNextPayment,
  };
}

export async function generatePublicShareToken(projectId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.update(projects).set({ publicShareToken: token }).where(eq(projects.id, projectId));
  await ensureShareSettings(projectId);
  return token;
}

export async function revokePublicShareToken(projectId: string): Promise<void> {
  await db.update(projects).set({ publicShareToken: null }).where(eq(projects.id, projectId));
}

function daysUntil(dueDate: string): number {
  return calendarDaysUntil(dueDate);
}

export type InstallmentPublic = {
  id: string;
  sequence: number;
  title: string;
  dueDate: string;
  amount: number;
  status: "prevista" | "parcial" | "paga" | "atrasada";
  overdue: boolean;
  paidAmount: number;
};

function resolveInstallmentStatus(
  status: "prevista" | "parcial" | "paga",
  dueDate: string,
): { status: InstallmentPublic["status"]; overdue: boolean } {
  const overdue = status !== "paga" && daysUntil(dueDate) < 0;
  if (status === "paga") return { status: "paga", overdue: false };
  if (status === "parcial") return { status: "parcial", overdue };
  return { status: overdue ? "atrasada" : "prevista", overdue };
}

async function loadContractValue(projectId: string): Promise<number | null> {
  // Um contrato em rascunho ainda não foi acordado, e um cancelado deixou de valer — nenhum dos
  // dois deve aparecer como valor "do contrato" no link público, sob risco de mostrar ao dono da
  // obra um número que nunca foi combinado (ou que já não é válido).
  const [contract] = await db
    .select()
    .from(projectContracts)
    .where(and(eq(projectContracts.projectId, projectId), inArray(projectContracts.status, ["activo", "concluido"])))
    .limit(1);
  if (!contract) return null;
  const variations = await db
    .select()
    .from(contractVariations)
    .where(and(eq(contractVariations.contractId, contract.id), eq(contractVariations.status, "aprovada")));
  const approved = variations.reduce((sum, v) => sum + Number(v.amount), 0);
  return Number(contract.originalAmount) + approved;
}

function deriveCurrentPhase(
  tasks: Array<{ name: string; status: string; startDate: string; endDate: string; manualProgress: string | null }>,
): { name: string; progressPercent: number } | null {
  if (!tasks.length) return null;
  const inProgress = tasks
    .filter((t) => t.status === "em_curso")
    .sort((a, b) => Number(b.manualProgress ?? 0) - Number(a.manualProgress ?? 0));
  if (inProgress[0]) {
    return { name: inProgress[0].name, progressPercent: Number(inProgress[0].manualProgress ?? 0) };
  }
  const today = localTodayIso();
  const upcoming = tasks
    .filter((t) => t.status !== "concluido" && t.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (upcoming[0]) {
    return { name: upcoming[0].name, progressPercent: Number(upcoming[0].manualProgress ?? 0) };
  }
  const last = [...tasks].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  return last ? { name: last.name, progressPercent: Number(last.manualProgress ?? (last.status === "concluido" ? 100 : 0)) } : null;
}

export type PublicProjectSummary = {
  projectName: string;
  currency: string;
  settings: ShareSettings;
  currentPhase: { name: string; progressPercent: number } | null;
  progress: {
    hasCertificates: boolean;
    latestCertificateNumber?: number;
    percentExecutado?: number;
    certificadoAoDono?: number;
    valorContrato?: number;
  } | null;
  schedule: {
    hasSchedule: boolean;
    startDate?: string;
    endDate?: string;
    daysElapsed?: number;
    daysTotal?: number;
    percentTimeElapsed?: number;
  } | null;
  nextPayment: { title: string; dueDate: string; amount: number; daysUntil: number; status: InstallmentPublic["status"] } | null;
  paymentSchedule: { mode: "total" | "parcelado"; totalAmount: number; currency: string; installments: InstallmentPublic[] } | null;
  diary: Array<{ date: string; workDone: string; photoUrls: string[] }>;
};

/** Só é chamada depois de confirmar que o token existe — nunca expõe custos internos. */
export async function getPublicProjectSummary(token: string): Promise<PublicProjectSummary | null> {
  const [project] = await db.select().from(projects).where(eq(projects.publicShareToken, token)).limit(1);
  if (!project || project.trashedAt) return null;

  const settings = await ensureShareSettings(project.id);

  const [approvedBudget] = await db
    .select({ id: budgetDocuments.id })
    .from(budgetDocuments)
    .where(and(eq(budgetDocuments.projectId, project.id), eq(budgetDocuments.documentType, "orcamento"), eq(budgetDocuments.status, "aprovado")))
    .orderBy(desc(budgetDocuments.createdAt))
    .limit(1);

  const dashboard = approvedBudget ? await getMeasurementDashboard(approvedBudget.id) : { hasCertificates: false as const };
  const contractValue = settings.showContractValue ? await loadContractValue(project.id) : null;

  const tasks = await db
    .select({
      name: scheduleTasks.name,
      status: scheduleTasks.status,
      startDate: scheduleTasks.startDate,
      endDate: scheduleTasks.endDate,
      manualProgress: scheduleTasks.manualProgress,
    })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, project.id));

  let schedule: PublicProjectSummary["schedule"] = null;
  if (settings.showSchedule) {
    schedule = { hasSchedule: false };
    if (tasks.length) {
      const starts = tasks.map((t) => new Date(t.startDate).getTime());
      const ends = tasks.map((t) => new Date(t.endDate).getTime());
      const start = new Date(Math.min(...starts));
      const end = new Date(Math.max(...ends));
      const now = new Date();
      const daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
      const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((now.getTime() - start.getTime()) / 86_400_000)));
      schedule = {
        hasSchedule: true,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        daysElapsed,
        daysTotal,
        percentTimeElapsed: (daysElapsed / daysTotal) * 100,
      };
    }
  }

  const currentPhase = settings.showCurrentPhase ? deriveCurrentPhase(tasks) : null;

  let progress: PublicProjectSummary["progress"] = null;
  if (settings.showProgress || settings.showCertifiedValue || settings.showContractValue) {
    progress = {
      hasCertificates: Boolean(dashboard.hasCertificates),
      ...(dashboard.hasCertificates
        ? {
            latestCertificateNumber: dashboard.latestCertificateNumber,
            percentExecutado: settings.showProgress ? dashboard.percentExecutado : undefined,
            certificadoAoDono: settings.showCertifiedValue ? dashboard.executadoTotal : undefined,
            valorContrato: settings.showContractValue
              ? (contractValue ?? dashboard.previstoTotal)
              : undefined,
          }
        : settings.showContractValue && contractValue != null
          ? { valorContrato: contractValue }
          : {}),
    };
  }

  const [plan] = await db
    .select()
    .from(projectClientPaymentPlans)
    .where(eq(projectClientPaymentPlans.projectId, project.id))
    .limit(1);

  let installments: InstallmentPublic[] = [];
  if (plan) {
    const rows = await db
      .select()
      .from(projectClientPaymentInstallments)
      .where(eq(projectClientPaymentInstallments.planId, plan.id))
      .orderBy(asc(projectClientPaymentInstallments.sequence), asc(projectClientPaymentInstallments.dueDate));
    installments = rows.map((row) => {
      const derived = resolveInstallmentStatus(row.status, row.dueDate);
      return {
        id: row.id,
        sequence: row.sequence,
        title: row.title,
        dueDate: row.dueDate,
        amount: Number(row.amount),
        status: derived.status,
        overdue: derived.overdue,
        paidAmount: Number(row.paidAmount),
      };
    });
  }

  const unpaid = installments.filter((i) => i.status !== "paga").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = unpaid[0] ?? null;

  let diary: PublicProjectSummary["diary"] = [];
  if (settings.showDiaryEvidences) {
    const diaryRows = await db
      .select({ date: siteDiaryEntries.date, workDone: siteDiaryEntries.workDone, photoUrls: siteDiaryEntries.photoUrls })
      .from(siteDiaryEntries)
      .where(eq(siteDiaryEntries.projectId, project.id))
      .orderBy(desc(siteDiaryEntries.date))
      .limit(12);
    diary = diaryRows.map((row) => ({
      date: row.date,
      workDone: row.workDone,
      photoUrls: row.photoUrls.map((url) => url.replace("/api/files/site-diary/", `/api/public/obra/${token}/foto/`)),
    }));
  }

  return {
    projectName: project.name,
    currency: project.currency,
    settings,
    currentPhase,
    progress,
    schedule,
    nextPayment:
      settings.showNextPayment && next
        ? {
            title: next.title,
            dueDate: next.dueDate,
            amount: next.amount,
            daysUntil: daysUntil(next.dueDate),
            status: next.status,
          }
        : null,
    paymentSchedule:
      settings.showPaymentSchedule && plan
        ? {
            mode: plan.mode,
            totalAmount: Number(plan.totalAmount),
            currency: plan.currency,
            installments,
          }
        : null,
    diary,
  };
}
