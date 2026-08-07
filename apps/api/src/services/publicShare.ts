import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, budgetDocuments, scheduleTasks, siteDiaryEntries } from "../db/schema.js";
import { getMeasurementDashboard } from "./measurementEngine.js";

export async function generatePublicShareToken(projectId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.update(projects).set({ publicShareToken: token }).where(eq(projects.id, projectId));
  return token;
}

export async function revokePublicShareToken(projectId: string): Promise<void> {
  await db.update(projects).set({ publicShareToken: null }).where(eq(projects.id, projectId));
}

export type PublicProjectSummary = {
  projectName: string;
  currency: string;
  progress: {
    hasCertificates: boolean;
    latestCertificateNumber?: number;
    previstoTotal?: number;
    executadoTotal?: number;
    percentExecutado?: number;
  };
  schedule: {
    hasSchedule: boolean;
    startDate?: string;
    endDate?: string;
    daysElapsed?: number;
    daysTotal?: number;
    percentTimeElapsed?: number;
  };
  diary: Array<{ date: string; workDone: string; photoUrls: string[] }>;
};

/** Só é chamada depois de confirmar que o token existe — nunca expõe preços internos,
 * composições ou dados de outros projectos: apenas o que já é client-facing (valor de venda
 * dos autos aprovados, progresso do cronograma, e o diário de obra). */
export async function getPublicProjectSummary(token: string): Promise<PublicProjectSummary | null> {
  const [project] = await db.select().from(projects).where(eq(projects.publicShareToken, token)).limit(1);
  if (!project || project.trashedAt) return null;

  const [approvedBudget] = await db
    .select({ id: budgetDocuments.id })
    .from(budgetDocuments)
    .where(and(eq(budgetDocuments.projectId, project.id), eq(budgetDocuments.documentType, "orcamento"), eq(budgetDocuments.status, "aprovado")))
    .orderBy(desc(budgetDocuments.createdAt))
    .limit(1);

  const dashboard = approvedBudget ? await getMeasurementDashboard(approvedBudget.id) : { hasCertificates: false as const };

  const tasks = await db
    .select({ startDate: scheduleTasks.startDate, endDate: scheduleTasks.endDate })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, project.id));
  let schedule: PublicProjectSummary["schedule"] = { hasSchedule: false };
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

  const diaryRows = await db
    .select({ date: siteDiaryEntries.date, workDone: siteDiaryEntries.workDone, photoUrls: siteDiaryEntries.photoUrls })
    .from(siteDiaryEntries)
    .where(eq(siteDiaryEntries.projectId, project.id))
    .orderBy(desc(siteDiaryEntries.date))
    .limit(12);

  return {
    projectName: project.name,
    currency: project.currency,
    progress: dashboard.hasCertificates
      ? {
          hasCertificates: true,
          latestCertificateNumber: dashboard.latestCertificateNumber,
          previstoTotal: dashboard.previstoTotal,
          executadoTotal: dashboard.executadoTotal,
          percentExecutado: dashboard.percentExecutado,
        }
      : { hasCertificates: false },
    schedule,
    diary: diaryRows.map((row) => ({
      date: row.date,
      workDone: row.workDone,
      // Converte para o caminho público — o mesmo ficheiro, servido pela rota pública com o
      // token em vez de sessão, com a mesma verificação de posse do lado do servidor.
      photoUrls: row.photoUrls.map((url) => url.replace("/api/files/site-diary/", `/api/public/obra/${token}/foto/`)),
    })),
  };
}
