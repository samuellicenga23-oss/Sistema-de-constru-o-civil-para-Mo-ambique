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
import { getCompositionLabourQuantities } from "./costEngine.js";

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

// Horas de mão-de-obra por unidade de saída de cada composição, em cache por composição (a
// mesma composição repete-se em muitos itens do mapa, ex: "Alvenaria de bloco 20").
async function buildLabourHoursPerUnitCache(
  node: LineItemNode,
  companyId: string | null,
  zoneId: string | null,
  cache: Map<string, number>,
): Promise<void> {
  if (node.kind === "item" && node.compositionId && !cache.has(node.compositionId)) {
    const lines = await getCompositionLabourQuantities(node.compositionId, companyId, zoneId);
    cache.set(node.compositionId, lines.reduce((sum, line) => sum + line.hoursPerUnit, 0));
  }
  for (const child of node.children) await buildLabourHoursPerUnitCache(child, companyId, zoneId, cache);
}

const HOURS_PER_WORKING_DAY = 8;
// Preço médio de referência (MZN) que uma frente sem composição ligada processa por dia — só
// entra quando o item não tem mão-de-obra conhecida (preço manual, sem composição). É uma
// aproximação grosseira assumida, nunca escondida: fica marcada como tal no resultado.
const GENERIC_MZN_PER_DAY = 12_000;

// Duração de UM pacote de trabalho (item medido), calculada a partir do seu próprio conteúdo —
// nunca de uma fatia proporcional de um total maior. Horas reais = horas/unidade da composição ×
// quantidade medida deste item; a equipa é dimensionada ao volume do PRÓPRIO item (tecto baixo —
// uma linha de 5 m³ de betão não ganha uma equipa de 40 pessoas só porque a obra é grande).
export function computeItemDurationDays(item: LineItemNode, hoursCache: Map<string, number>): { days: number; basis: "horas" | "valor" | "minimo" } {
  if (item.compositionId && item.quantity) {
    const hoursPerUnit = hoursCache.get(item.compositionId) ?? 0;
    const totalHours = hoursPerUnit * item.quantity;
    if (totalHours > 0) {
      const crewSize = Math.max(1, Math.min(12, Math.round(Math.sqrt(totalHours / HOURS_PER_WORKING_DAY))));
      return { days: Math.max(1, Math.round(totalHours / (crewSize * HOURS_PER_WORKING_DAY))), basis: "horas" };
    }
  }
  if (item.totalPrice > 0) {
    return { days: Math.max(1, Math.round(item.totalPrice / GENERIC_MZN_PER_DAY)), basis: "valor" };
  }
  return { days: 1, basis: "minimo" };
}

type ScheduledNode = {
  node: LineItemNode;
  durationDays: number;
  basis: "horas" | "valor" | "minimo" | "soma";
  children: ScheduledNode[];
};

// Calcula a duração de cada nó da árvore de baixo para cima: um item (pacote de trabalho) tem
// duração própria, calculada do seu conteúdo real; um capítulo/grupo é sempre a SOMA das suas
// subactividades (encadeadas em sequência), nunca um número inventado ao nível do capítulo. Isto
// substitui o desenho anterior (repartir proporcionalmente um total pré-calculado), que perdia
// detalhe e produzia números pouco realistas para pacotes de trabalho individuais.
export function computeNodeDurations(node: LineItemNode, hoursCache: Map<string, number>): ScheduledNode | null {
  if (node.kind === "nota") return null;
  if (node.kind === "item") {
    const { days, basis } = computeItemDurationDays(node, hoursCache);
    return { node, durationDays: days, basis, children: [] };
  }
  const children = node.children.map((child) => computeNodeDurations(child, hoursCache)).filter((c): c is ScheduledNode => c !== null);
  const durationDays = children.reduce((sum, c) => sum + c.durationDays, 0) || 1;
  return { node, durationDays, basis: "soma", children };
}

// Escala só as folhas (pacotes de trabalho) por um factor uniforme e recalcula os totais dos
// capítulos/grupos como soma — usado apenas quando o utilizador escolhe substituir o cálculo
// automático por um prazo próprio; nunca inventa uma duração ao nível do capítulo.
export function scaleScheduledTree(node: ScheduledNode, factor: number): ScheduledNode {
  if (!node.children.length) return { ...node, durationDays: Math.max(1, Math.round(node.durationDays * factor)) };
  const children = node.children.map((child) => scaleScheduledTree(child, factor));
  return { ...node, durationDays: children.reduce((sum, child) => sum + child.durationDays, 0) || 1, children };
}

async function insertScheduledNode(
  node: ScheduledNode,
  args: { projectId: string; budgetDocumentId: string },
  parentId: string | null,
  fallbackCode: string,
  startDate: string,
  sortOrderRef: { value: number },
  dependencyValues: Array<typeof scheduleDependencies.$inferInsert>,
): Promise<typeof scheduleTasks.$inferSelect> {
  const code = node.node.code ?? fallbackCode;
  const endDate = addWorkingDays(startDate, node.durationDays - 1);
  const [task] = await db.insert(scheduleTasks).values({
    projectId: args.projectId,
    parentId,
    budgetDocumentId: args.budgetDocumentId,
    code,
    name: node.node.description,
    budgetChapterCode: code,
    startDate,
    endDate,
    baselineStartDate: startDate,
    baselineEndDate: endDate,
    durationDays: node.durationDays,
    sortOrder: sortOrderRef.value++,
  }).returning();

  let childCursor = startDate;
  let previousChild: typeof scheduleTasks.$inferSelect | null = null;
  for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
    const childTask = await insertScheduledNode(node.children[childIndex], args, task.id, `${code}.${childIndex + 1}`, childCursor, sortOrderRef, dependencyValues);
    if (previousChild) dependencyValues.push({ predecessorTaskId: previousChild.id, successorTaskId: childTask.id, type: "FS", lagDays: 0 });
    previousChild = childTask;
    childCursor = addWorkingDays(childTask.endDate, 1);
  }
  return task;
}

function collectLeafBasis(node: ScheduledNode, into: Set<string>) {
  if (!node.children.length) into.add(node.basis);
  for (const child of node.children) collectLeafBasis(child, into);
}

// Gera o cronograma directamente do que foi medido: cada pacote de trabalho (item do Mapa de
// Quantidades, em qualquer profundidade — capítulo, grupo ou item) recebe a sua própria duração,
// calculada das suas próprias horas de mão-de-obra e quantidade — nunca de uma fatia
// proporcional de um total maior. A duração total nunca é uma pergunta obrigatória: é sempre a
// soma real do trabalho medido; só é substituída quando o utilizador escolhe explicitamente um
// prazo próprio (nesse caso, escala todas as folhas pelo mesmo factor, mantendo as proporções
// reais entre pacotes de trabalho).
export async function generateSchedule(args: {
  projectId: string;
  budgetDocumentId: string;
  startDate: string;
  totalDurationDays?: number;
  companyId?: string | null;
  zoneId?: string | null;
}) {
  const summary = await getBudgetDocumentSummary(args.budgetDocumentId);
  if (!summary) throw new Error("Mapa de Quantidades não encontrado");
  const roots = collectScheduleRoots(summary);
  if (!roots.length) throw new Error("O Mapa de Quantidades ainda não tem capítulos para gerar a WBS");

  const hoursCache = new Map<string, number>();
  for (const root of roots) await buildLabourHoursPerUnitCache(root, args.companyId ?? null, args.zoneId ?? null, hoursCache);

  let scheduledRoots = roots
    .map((root) => computeNodeDurations(root, hoursCache))
    .filter((node): node is ScheduledNode => node !== null);
  if (!scheduledRoots.length) throw new Error("O Mapa de Quantidades ainda não tem itens medidos para gerar a WBS");

  if (args.totalDurationDays) {
    const naturalTotal = scheduledRoots.reduce((sum, root) => sum + root.durationDays, 0) || 1;
    const factor = args.totalDurationDays / naturalTotal;
    scheduledRoots = scheduledRoots.map((root) => scaleScheduledTree(root, factor));
  }

  await db.delete(scheduleTasks).where(eq(scheduleTasks.projectId, args.projectId));
  let cursor = args.startDate;
  const sortOrderRef = { value: 0 };
  const rootTasks: Array<typeof scheduleTasks.$inferSelect> = [];
  const dependencyValues: Array<typeof scheduleDependencies.$inferInsert> = [];
  for (let index = 0; index < scheduledRoots.length; index += 1) {
    const rootTask = await insertScheduledNode(scheduledRoots[index], args, null, String(index + 1), cursor, sortOrderRef, dependencyValues);
    rootTasks.push(rootTask);
    cursor = addWorkingDays(rootTask.endDate, 1);
  }
  if (rootTasks.length > 1) {
    dependencyValues.push(...rootTasks.slice(1).map((task, index) => ({
      predecessorTaskId: rootTasks[index].id,
      successorTaskId: task.id,
      type: "FS" as const,
      lagDays: 0,
    })));
  }
  if (dependencyValues.length) await db.insert(scheduleDependencies).values(dependencyValues);
  const schedule = await getProjectSchedule(args.projectId);

  const basisSet = new Set<string>();
  for (const root of scheduledRoots) collectLeafBasis(root, basisSet);
  const weightBasis = basisSet.has("horas") ? (basisSet.size > 1 ? "misto" : "horas") : basisSet.has("valor") ? "valor" : "minimo";
  // Informa a origem do cálculo — permite à interface avisar quando o cronograma ainda não
  // reflecte trabalho real (itens sem composição ligada, a usar a aproximação por valor).
  return { ...schedule, weightBasis };
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

  const baseEnriched = tasks.map((task) => {
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
    const progressSource: "autos" | "diario" | "manual" | "planeamento" = progress <= 0
      ? "planeamento"
      : measuredProgress >= diaryProgress && measuredProgress >= manualProgress
        ? "autos"
        : diaryProgress >= manualProgress
          ? "diario"
          : "manual";
    return {
      ...task,
      progress,
      status: effectiveStatus,
      plannedValue,
      executedValue,
      progressSource,
      predecessorTaskId: predecessor?.predecessorTaskId ?? null,
      dependencyType: predecessor?.type ?? null,
      lagDays: predecessor?.lagDays ?? 0,
    };
  });
  const childrenByParent = new Map<string, typeof baseEnriched>();
  for (const task of baseEnriched) {
    if (!task.parentId) continue;
    const children = childrenByParent.get(task.parentId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentId, children);
  }
  const enriched = baseEnriched.map((task) => {
    const children = childrenByParent.get(task.id) ?? [];
    if (!children.length) return { ...task, isSummary: false as const };
    const childrenPlannedValue = children.reduce((sum, child) => sum + child.plannedValue, 0);
    const plannedValue = childrenPlannedValue > 0 ? childrenPlannedValue : task.plannedValue;
    const executedValue = childrenPlannedValue > 0 ? children.reduce((sum, child) => sum + child.executedValue, 0) : task.executedValue;
    const progress = childrenPlannedValue > 0
      ? children.reduce((sum, child) => sum + child.plannedValue * child.progress / 100, 0) / childrenPlannedValue * 100
      : children.reduce((sum, child) => sum + child.progress, 0) / children.length;
    const status = children.some((child) => child.status === "bloqueado")
      ? "bloqueado" as const
      : children.every((child) => child.status === "concluido")
        ? "concluido" as const
        : children.some((child) => child.status === "em_curso" || child.progress > 0)
          ? "em_curso" as const
          : "nao_iniciado" as const;
    const startDate = children.reduce((min, child) => child.startDate < min ? child.startDate : min, children[0].startDate);
    const endDate = children.reduce((max, child) => child.endDate > max ? child.endDate : max, children[0].endDate);
    const baselineChildren = children.filter((child) => child.baselineStartDate && child.baselineEndDate);
    const baselineStartDate = baselineChildren.length
      ? baselineChildren.reduce((min, child) => child.baselineStartDate! < min ? child.baselineStartDate! : min, baselineChildren[0].baselineStartDate!)
      : task.baselineStartDate;
    const baselineEndDate = baselineChildren.length
      ? baselineChildren.reduce((max, child) => child.baselineEndDate! > max ? child.baselineEndDate! : max, baselineChildren[0].baselineEndDate!)
      : task.baselineEndDate;
    return {
      ...task,
      isSummary: true as const,
      startDate,
      endDate,
      baselineStartDate,
      baselineEndDate,
      durationDays: workingDaysInclusive(startDate, endDate),
      plannedValue,
      executedValue,
      progress,
      status,
      progressSource: "subactividades" as const,
    };
  });
  const orderedEnriched = enriched
    .filter((task) => !task.parentId)
    .flatMap((task) => [task, ...enriched.filter((child) => child.parentId === task.id)]);
  // Os totais usam apenas o primeiro nível: cada actividade principal já agrega as suas
  // subactividades. Assim, uma WBS detalhada nunca duplica o valor do orçamento.
  const topLevelTasks = enriched.filter((task) => !task.parentId);
  const plannedValue = topLevelTasks.reduce((sum, task) => sum + task.plannedValue, 0);
  const executedValue = topLevelTasks.reduce((sum, task) => sum + task.executedValue, 0);
  return {
    tasks: orderedEnriched,
    dependencies,
    startDate: orderedEnriched.reduce((min, task) => task.startDate < min ? task.startDate : min, orderedEnriched[0].startDate),
    endDate: orderedEnriched.reduce((max, task) => task.endDate > max ? task.endDate : max, orderedEnriched[0].endDate),
    overallProgress: plannedValue > 0
      ? Math.min(100, topLevelTasks.reduce((sum, task) => sum + task.plannedValue * task.progress / 100, 0) / plannedValue * 100)
      : topLevelTasks.length ? topLevelTasks.reduce((sum, task) => sum + task.progress, 0) / topLevelTasks.length : 0,
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

