import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetDocuments,
  lineItems,
  measurementCertificateLines,
  measurementCertificates,
  scheduleDependencies,
  scheduleTasks,
  siteDiaryEntries,
  siteDiaryTaskProgress,
} from "../db/schema.js";
import { getBudgetDocumentSummary, type LineItemNode } from "./boqEngine.js";

const DAY_MS = 86_400_000;

export function addWorkingDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + 1);
    if (value.getUTCDay() !== 0) remaining -= 1; // obra: segunda a sábado
  }
  return value.toISOString().slice(0, 10);
}

export function workingDaysInclusive(startDate: string, endDate: string) {
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  while (cursor <= end) {
    if (cursor.getUTCDay() !== 0) count += 1;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

export function allocateDurations(weights: number[], requestedTotal: number, minimum = 3) {
  if (!weights.length) return [];
  const total = Math.max(requestedTotal, weights.length * minimum);
  const positiveWeights = weights.map((weight) => Math.max(0, weight));
  const safeWeights = positiveWeights.some((weight) => weight > 0) ? positiveWeights : weights.map(() => 1);
  const sum = safeWeights.reduce((value, weight) => value + weight, 0);
  const raw = safeWeights.map((weight) => minimum + ((total - weights.length * minimum) * weight) / sum);
  const result = raw.map(Math.floor);
  let remaining = total - result.reduce((value, days) => value + days, 0);
  raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, remaining)
    .forEach(({ index }) => { result[index] += 1; remaining -= 1; });
  return result;
}

function collectScheduleRoots(summary: Awaited<ReturnType<typeof getBudgetDocumentSummary>>) {
  if (!summary) return [];
  const roots: LineItemNode[] = [];
  for (const section of summary.sections) {
    for (const item of section.items) {
      if (item.kind === "capitulo" || item.kind === "grupo") roots.push(item);
    }
  }
  return roots;
}

export async function generateSchedule(args: {
  projectId: string;
  budgetDocumentId: string;
  startDate: string;
  totalDurationDays: number;
}) {
  const summary = await getBudgetDocumentSummary(args.budgetDocumentId);
  if (!summary) throw new Error("Mapa de Quantidades não encontrado");
  const roots = collectScheduleRoots(summary);
  if (!roots.length) throw new Error("O Mapa de Quantidades ainda não tem capítulos para gerar a WBS");
  const durations = allocateDurations(roots.map((root) => root.totalPrice), args.totalDurationDays);

  await db.delete(scheduleTasks).where(eq(scheduleTasks.projectId, args.projectId));
  let cursor = args.startDate;
  const inserted: Array<typeof scheduleTasks.$inferSelect> = [];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    const durationDays = durations[index];
    const endDate = addWorkingDays(cursor, durationDays - 1);
    const [task] = await db.insert(scheduleTasks).values({
      projectId: args.projectId,
      budgetDocumentId: args.budgetDocumentId,
      code: root.code ?? String(index + 1),
      name: root.description,
      budgetChapterCode: root.code ?? String(index + 1),
      startDate: cursor,
      endDate,
      baselineStartDate: cursor,
      baselineEndDate: endDate,
      durationDays,
      sortOrder: index,
    }).returning();
    inserted.push(task);
    cursor = addWorkingDays(endDate, 1);
  }
  if (inserted.length > 1) {
    await db.insert(scheduleDependencies).values(inserted.slice(1).map((task, index) => ({
      predecessorTaskId: inserted[index].id,
      successorTaskId: task.id,
      type: "FS" as const,
      lagDays: 0,
    })));
  }
  return getProjectSchedule(args.projectId);
}

function findNodeByCode(nodes: LineItemNode[], code: string): LineItemNode | null {
  for (const node of nodes) {
    if (node.code === code) return node;
    const child = findNodeByCode(node.children, code);
    if (child) return child;
  }
  return null;
}

export async function getProjectSchedule(projectId: string) {
  const tasks = await db.select().from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId)).orderBy(scheduleTasks.sortOrder);
  if (!tasks.length) return { tasks: [], dependencies: [], startDate: null, endDate: null, overallProgress: 0, plannedValue: 0, executedValue: 0 };
  const taskIds = tasks.map((task) => task.id);
  const dependencies = await db.select().from(scheduleDependencies).where(inArray(scheduleDependencies.successorTaskId, taskIds));

  const documentIds = Array.from(new Set(tasks.map((task) => task.budgetDocumentId).filter((id): id is string => Boolean(id))));
  const summaries = new Map<string, NonNullable<Awaited<ReturnType<typeof getBudgetDocumentSummary>>>>();
  for (const id of documentIds) {
    const summary = await getBudgetDocumentSummary(id);
    if (summary) summaries.set(id, summary);
  }

  const approved = await db
    .select()
    .from(measurementCertificates)
    .where(and(eq(measurementCertificates.projectId, projectId), eq(measurementCertificates.status, "aprovado")))
    .orderBy(desc(measurementCertificates.number));
  const latestByDocument = new Map<string, typeof approved[number]>();
  for (const certificate of approved) if (!latestByDocument.has(certificate.budgetDocumentId)) latestByDocument.set(certificate.budgetDocumentId, certificate);
  const latestCertificateIds = Array.from(latestByDocument.values(), (certificate) => certificate.id);
  const measured = latestCertificateIds.length
    ? await db
        .select({ certificateId: measurementCertificateLines.certificateId, code: lineItems.code, qty: measurementCertificateLines.cumulativeQty, unitPrice: lineItems.unitPrice })
        .from(measurementCertificateLines)
        .innerJoin(lineItems, eq(measurementCertificateLines.lineItemId, lineItems.id))
        .where(inArray(measurementCertificateLines.certificateId, latestCertificateIds))
    : [];

  const diaryProgressRows = await db
    .select({ progress: siteDiaryTaskProgress, date: siteDiaryEntries.date })
    .from(siteDiaryTaskProgress)
    .innerJoin(siteDiaryEntries, eq(siteDiaryTaskProgress.diaryEntryId, siteDiaryEntries.id))
    .where(inArray(siteDiaryTaskProgress.scheduleTaskId, taskIds))
    .orderBy(desc(siteDiaryEntries.date));
  const latestDiaryProgress = new Map<string, number>();
  for (const row of diaryProgressRows) if (!latestDiaryProgress.has(row.progress.scheduleTaskId)) latestDiaryProgress.set(row.progress.scheduleTaskId, Number(row.progress.progressPercent));

  const enriched = tasks.map((task) => {
    const summary = task.budgetDocumentId ? summaries.get(task.budgetDocumentId) : null;
    const root = summary && task.budgetChapterCode
      ? summary.sections.flatMap((section) => section.items).map((node) => findNodeByCode([node], task.budgetChapterCode!)).find(Boolean)
      : null;
    const plannedValue = root?.totalPrice ?? 0;
    const certificate = task.budgetDocumentId ? latestByDocument.get(task.budgetDocumentId) : null;
    const executedValue = certificate && task.budgetChapterCode
      ? measured
          .filter((line) => line.certificateId === certificate.id && (line.code === task.budgetChapterCode || line.code?.startsWith(`${task.budgetChapterCode}.`)))
          .reduce((sum, line) => sum + Number(line.qty) * Number(line.unitPrice ?? 0), 0)
      : 0;
    const measuredProgress = plannedValue > 0 ? Math.min(100, (executedValue / plannedValue) * 100) : 0;
    const diaryProgress = latestDiaryProgress.get(task.id) ?? 0;
    const manualProgress = Number(task.manualProgress ?? 0);
    const progress = Math.max(measuredProgress, diaryProgress, manualProgress);
    const effectiveStatus = task.status === "bloqueado"
      ? task.status
      : progress >= 100 ? "concluido" : progress > 0 ? "em_curso" : task.status;
    const predecessor = dependencies.find((dependency) => dependency.successorTaskId === task.id);
    return {
      ...task,
      progress,
      status: effectiveStatus,
      plannedValue,
      executedValue,
      progressSource: progress <= 0
        ? "planeamento"
        : measuredProgress >= diaryProgress && measuredProgress >= manualProgress
          ? "autos"
          : diaryProgress >= manualProgress
            ? "diario"
            : "manual",
      predecessorTaskId: predecessor?.predecessorTaskId ?? null,
      dependencyType: predecessor?.type ?? null,
      lagDays: predecessor?.lagDays ?? 0,
    };
  });
  const plannedValue = enriched.reduce((sum, task) => sum + task.plannedValue, 0);
  const executedValue = enriched.reduce((sum, task) => sum + task.executedValue, 0);
  return {
    tasks: enriched,
    dependencies,
    startDate: enriched.reduce((min, task) => task.startDate < min ? task.startDate : min, enriched[0].startDate),
    endDate: enriched.reduce((max, task) => task.endDate > max ? task.endDate : max, enriched[0].endDate),
    overallProgress: plannedValue > 0
      ? Math.min(100, enriched.reduce((sum, task) => sum + task.plannedValue * task.progress / 100, 0) / plannedValue * 100)
      : enriched.reduce((sum, task) => sum + task.progress, 0) / enriched.length,
    plannedValue,
    executedValue,
  };
}

export async function upsertTaskDependency(taskId: string, predecessorTaskId?: string | null, type: "FS" | "SS" | "FF" | "SF" = "FS", lagDays = 0) {
  await db.delete(scheduleDependencies).where(eq(scheduleDependencies.successorTaskId, taskId));
  if (predecessorTaskId && predecessorTaskId !== taskId) {
    await db.insert(scheduleDependencies).values({ predecessorTaskId, successorTaskId: taskId, type, lagDays });
  }
}

export async function getTaskDependency(taskId: string) {
  const [dependency] = await db.select().from(scheduleDependencies).where(eq(scheduleDependencies.successorTaskId, taskId)).limit(1);
  return dependency ?? null;
}

export async function validateTaskDependency(projectId: string, taskId: string, predecessorTaskId: string | null) {
  if (!predecessorTaskId) return;
  if (predecessorTaskId === taskId) throw new Error("Uma actividade não pode depender de si própria");
  const projectTasks = await db.select({ id: scheduleTasks.id }).from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId));
  const taskIds = projectTasks.map((task) => task.id);
  if (!taskIds.includes(predecessorTaskId)) throw new Error("A predecessora não pertence ao cronograma desta obra");
  const dependencies = taskIds.length
    ? await db.select().from(scheduleDependencies).where(inArray(scheduleDependencies.successorTaskId, taskIds))
    : [];
  const predecessorBySuccessor = new Map(dependencies.map((dependency) => [dependency.successorTaskId, dependency.predecessorTaskId]));
  const visited = new Set<string>();
  let cursor: string | undefined = predecessorTaskId;
  while (cursor) {
    if (cursor === taskId) throw new Error("Esta dependência criaria um ciclo no cronograma");
    if (visited.has(cursor)) break;
    visited.add(cursor);
    cursor = predecessorBySuccessor.get(cursor);
  }
}
