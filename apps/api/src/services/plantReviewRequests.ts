import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  companies,
  extractedOpenings,
  extractedRooms,
  plantReviewRequests,
  plants,
  projects,
  users,
} from "../db/schema.js";
import { notifyUsers } from "./notifications.js";
import { emailLayout, escapeHtml, sendEmail } from "./mailer.js";
import { env } from "../env.js";

export const PLANT_REVIEW_SLA_HOURS = 5;

type ReviewReason = "erro_processamento" | "extraccao_incompleta" | "pedido_utilizador";

export type PlantExtractionGapsInput = {
  processingStatus: "pendente" | "processando" | "concluido" | "erro";
  errorMessage?: string | null;
  discipline: "arquitectura" | "estrutura";
  documentAnalysis?: {
    sections?: Array<{ discipline: string }>;
    qualityIssues?: Array<{ message: string; severity: string }>;
  } | null;
  structuralSummary?: {
    footingsCount: number;
    columnsCount: number;
    beamsCount: number;
    slabsCount: number;
    totalSteelWeightKg: number;
  } | null;
  roomsCount: number;
  openingsCount: number;
  openingsNeedingConfirmation: number;
  rebarLinesCount: number;
};

export function assessPlantExtractionGaps(input: PlantExtractionGapsInput): string[] {
  const structuredIssues = input.documentAnalysis?.qualityIssues ?? [];
  if (structuredIssues.length > 0) {
    return structuredIssues
      .filter((issue) => issue.severity !== "info")
      .map((issue) => issue.message);
  }
  const gaps: string[] = [];
  const detected = new Set((input.documentAnalysis?.sections ?? []).map((section) => section.discipline));
  const hasArchitecture = detected.size > 0 ? detected.has("arquitectura") : input.discipline === "arquitectura";
  const hasStructure = detected.size > 0 ? detected.has("estrutura") : input.discipline === "estrutura";

  if (input.processingStatus === "erro") {
    gaps.push(
      input.errorMessage
        ? `Processamento interrompido: ${input.errorMessage}`
        : "Processamento interrompido antes de concluir a leitura da planta.",
    );
    return gaps;
  }

  if (hasStructure) {
    const summary = input.structuralSummary;
    if (!summary) {
      gaps.push("Nenhum elemento estrutural identificado (sapatas, pilares, vigas ou lajes).");
    } else {
      if (summary.footingsCount === 0) gaps.push("Sapatas/fundações não identificadas.");
      if (summary.columnsCount === 0) gaps.push("Pilares não identificados.");
      if (summary.beamsCount === 0) gaps.push("Vigas não identificadas.");
      if (summary.slabsCount === 0) gaps.push("Lajes não identificadas.");
      if (
        summary.totalSteelWeightKg === 0
        && input.rebarLinesCount === 0
        && (summary.footingsCount > 0 || summary.columnsCount > 0 || summary.beamsCount > 0)
      ) {
        gaps.push("Mapa de aço / peso total não identificado.");
      }
    }
  }

  if (hasArchitecture && input.roomsCount === 0) {
    gaps.push("Compartimentos (áreas) não identificados.");
  }
  if (hasArchitecture && input.openingsCount === 0) {
    gaps.push("Portas e janelas não identificadas.");
  } else if (input.openingsNeedingConfirmation > 0) {
    gaps.push(`${input.openingsNeedingConfirmation} vão(s) precisam de confirmação.`);
  }

  return gaps;
}

export function plantNeedsEngineReview(gaps: string[], processingStatus: string): boolean {
  if (processingStatus === "erro") return true;
  return gaps.length >= 2;
}

async function getSuperAdmins() {
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
}

async function notifySuperAdminsAboutPlantReview(row: typeof plantReviewRequests.$inferSelect, context: {
  companyName: string;
  projectName: string;
  fileName: string | null;
}) {
  const admins = await getSuperAdmins();
  if (!admins.length) return;

  const reasonLabel =
    row.reason === "erro_processamento"
      ? "falha a meio da análise"
      : row.reason === "extraccao_incompleta"
        ? "extracção incompleta"
        : "pedido do utilizador";

  const gapsHtml = row.gaps.length
    ? `<ul>${row.gaps.map((gap) => `<li>${escapeHtml(gap)}</li>`).join("")}</ul>`
    : "<p>Sem lacunas listadas.</p>";

  void sendEmail(
    {
      to: admins.map((admin) => admin.email),
      subject: `SIGO — Melhorar motor de plantas: ${context.projectName}`,
      html: emailLayout(
        "Revisão do motor de análise de plantas",
        `<p>A planta <strong>${escapeHtml(context.fileName ?? row.plantId)}</strong> da obra <strong>${escapeHtml(context.projectName)}</strong> (${escapeHtml(context.companyName)}) precisa de revisão.</p>
         <p>Motivo: <strong>${escapeHtml(reasonLabel)}</strong>${row.progressAtFailure != null ? ` · progresso ${row.progressAtFailure}%` : ""}.</p>
         <p>SLA comunicado ao cliente: <strong>${row.slaHours} horas</strong>.</p>
         ${row.errorMessage ? `<p>Erro: ${escapeHtml(row.errorMessage)}</p>` : ""}
         ${gapsHtml}`,
        `${env.publicUrl}/admin#plant-reviews`,
        "Abrir painel admin",
      ),
    },
    undefined,
  );

  await notifyUsers(
    admins.map((admin) => admin.id),
    "Planta para melhorar o motor",
    `${context.projectName}: ${context.fileName ?? "PDF"} (${reasonLabel}). Responder em até ${row.slaHours}h.`,
    "/admin#plant-reviews",
  );
}

export async function createPlantReviewRequest(input: {
  plantId: string;
  reason: ReviewReason;
  requestedByUserId?: string | null;
  gaps?: string[];
  progressAtFailure?: number | null;
  errorMessage?: string | null;
  userNotes?: string | null;
  forceNotify?: boolean;
}): Promise<typeof plantReviewRequests.$inferSelect | null> {
  const [plant] = await db.select().from(plants).where(eq(plants.id, input.plantId)).limit(1);
  if (!plant) return null;

  const [project] = await db.select().from(projects).where(eq(projects.id, plant.projectId)).limit(1);
  if (!project) return null;

  const [company] = await db.select().from(companies).where(eq(companies.id, project.companyId)).limit(1);

  const open = await db
    .select()
    .from(plantReviewRequests)
    .where(and(
      eq(plantReviewRequests.plantId, plant.id),
      inArray(plantReviewRequests.status, ["aberto", "em_analise"]),
    ))
    .orderBy(desc(plantReviewRequests.createdAt))
    .limit(1);

  if (open[0]) {
    const [updated] = await db
      .update(plantReviewRequests)
      .set({
        gaps: input.gaps?.length ? input.gaps : open[0].gaps,
        errorMessage: input.errorMessage ?? open[0].errorMessage,
        progressAtFailure: input.progressAtFailure ?? open[0].progressAtFailure,
        userNotes: input.userNotes ?? open[0].userNotes,
        requestedByUserId: input.requestedByUserId ?? open[0].requestedByUserId,
      })
      .where(eq(plantReviewRequests.id, open[0].id))
      .returning();
    if (input.forceNotify && updated) {
      await notifySuperAdminsAboutPlantReview(updated, {
        companyName: company?.name ?? project.companyId,
        projectName: project.name,
        fileName: plant.originalFileName,
      });
    }
    return updated ?? open[0];
  }

  const [created] = await db
    .insert(plantReviewRequests)
    .values({
      plantId: plant.id,
      projectId: plant.projectId,
      companyId: project.companyId,
      requestedByUserId: input.requestedByUserId ?? null,
      reason: input.reason,
      gaps: input.gaps ?? [],
      progressAtFailure: input.progressAtFailure ?? null,
      errorMessage: input.errorMessage ?? null,
      userNotes: input.userNotes ?? null,
      slaHours: PLANT_REVIEW_SLA_HOURS,
    })
    .returning();

  if (created) {
    await notifySuperAdminsAboutPlantReview(created, {
      companyName: company?.name ?? project.companyId,
      projectName: project.name,
      fileName: plant.originalFileName,
    });
  }
  return created ?? null;
}

export async function collectPlantGapsForReview(plantId: string): Promise<{
  plant: typeof plants.$inferSelect;
  gaps: string[];
} | null> {
  const [plant] = await db.select().from(plants).where(eq(plants.id, plantId)).limit(1);
  if (!plant) return null;
  const rooms = await db.select({ id: extractedRooms.id }).from(extractedRooms).where(eq(extractedRooms.plantId, plantId));
  const openings = await db.select({
    id: extractedOpenings.id,
    needsConfirmation: extractedOpenings.needsConfirmation,
    widthM: extractedOpenings.widthM,
    heightM: extractedOpenings.heightM,
    location: extractedOpenings.location,
  }).from(extractedOpenings).where(eq(extractedOpenings.plantId, plantId));
  const openingsNeedingConfirmation = openings.filter((opening) =>
    opening.needsConfirmation
    || !opening.widthM
    || !opening.heightM
    || opening.location === "desconhecida"
  ).length;

  const gaps = assessPlantExtractionGaps({
    processingStatus: plant.processingStatus,
    errorMessage: plant.errorMessage,
    discipline: plant.discipline,
    documentAnalysis: plant.documentAnalysis,
    structuralSummary: plant.structuralSummary,
    roomsCount: rooms.length,
    openingsCount: openings.length,
    openingsNeedingConfirmation,
    rebarLinesCount: 0,
  });
  return { plant, gaps };
}

export async function maybeOpenPlantReviewAfterProcessing(plantId: string): Promise<void> {
  const collected = await collectPlantGapsForReview(plantId);
  if (!collected) return;
  if (!plantNeedsEngineReview(collected.gaps, collected.plant.processingStatus)) return;
  await createPlantReviewRequest({
    plantId,
    reason: collected.plant.processingStatus === "erro" ? "erro_processamento" : "extraccao_incompleta",
    gaps: collected.gaps,
    progressAtFailure: collected.plant.processingProgress,
    errorMessage: collected.plant.errorMessage,
  });
}
