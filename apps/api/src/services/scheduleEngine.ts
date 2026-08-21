import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetSections,
  lineItems,
  measurementLines,
  measurementCertificateLines,
  measurementCertificates,
  extractedRooms,
  plants,
  projects,
  projectSchedulePlanningProfiles,
  scheduleDependencies,
  scheduleTasks,
  siteDiaryEntries,
  siteDiaryTaskProgress,
} from "../db/schema.js";
import { getBudgetDocumentSummary, type LineItemNode } from "./boqEngine.js";
import { computeCompositionUnitCostV2, getCompositionLabourQuantitiesV2 as getCompositionLabourQuantities } from "./costEngineV2.js";
import {
  addWorkingDays,
  buildExecutionPlan,
  buildPlanningContext,
  computeSuccessorDates,
  isWorkingDay,
  planningTradeForSource,
  shiftWorkingDays,
  validatePlanCoverage,
  validateValueShares,
  workingDaysInclusive,
  type DurationBasis,
  type PlannedNode,
  type PlanningSourceNode,
  type PlanningSourceSection,
  type SchedulePhysicalContext,
  type PlanningWarning,
} from "./schedulePlanning.js";
import {
  buildPlanningQuestions,
  DEFAULT_FALLBACK_CREW_SIZE,
  mergeSchedulePlanningProfile,
  validateSchedulePlanningProfile,
  type PlanningContext,
  type SchedulePlanningProfile,
} from "./schedulePlanningProfile.js";
import { resolveProjectFloors } from "./scheduleFloorDetection.js";
import { buildValueSCurve, computeCpmNetwork, inLookahead, lookaheadWindow } from "./scheduleCpm.js";
import { buildScheduleMaterialAlerts } from "./scheduleLogisticsAlerts.js";
import { loadProjectWorkCalendar, toWorkCalendarOptions } from "./workCalendar.js";

export { addWorkingDays, computeSuccessorDates, isWorkingDay, shiftWorkingDays, workingDaysInclusive } from "./schedulePlanning.js";

const HOURS_PER_WORKING_DAY = 8;
const GENERIC_MZN_PER_DAY = 12_000;

/**
 * Duração de uma folha executável.
 *
 * Base preferencial: horas de mão-de-obra da composição × quantidade / (equipa × 8h).
 * `maxCrewSize` é tratado como a equipa disponível nessa frente; não usamos raiz quadrada,
 * percentagens do capítulo nem outro factor escondido para fabricar duração.
 *
 * Se a composição não fornecer horas, a função cai explicitamente para valor; sem valor, para
 * mínimo de 1 dia. A base segue para a tarefa e para `weightBasis` da resposta.
 */
export function computeItemDurationDays(
  item: LineItemNode,
  hoursCache: Map<string, number>,
  maxCrewSize: number = DEFAULT_FALLBACK_CREW_SIZE,
  productivityCache: Map<string, number> = new Map(),
): { days: number; basis: DurationBasis } {
  if (item.compositionId && (item.quantity ?? 0) > 0) {
    const outputPerDay = productivityCache.get(item.compositionId) ?? 0;
    if (outputPerDay > 0) return { days: Math.max(1, Math.ceil((item.quantity ?? 0) / outputPerDay)), basis: "produtividade" };
    const hoursPerUnit = hoursCache.get(item.compositionId) ?? 0;
    const totalHours = hoursPerUnit * (item.quantity ?? 0);
    if (totalHours > 0) {
      const requestedCrew = Math.max(1, Math.min(60, Math.round(maxCrewSize)));
      // Uma frente nunca recebe mais pessoas do que as necessárias para consumir as horas num dia.
      const usefulCrew = Math.max(1, Math.min(requestedCrew, Math.ceil(totalHours / HOURS_PER_WORKING_DAY)));
      return {
        days: Math.max(1, Math.ceil(totalHours / (usefulCrew * HOURS_PER_WORKING_DAY))),
        basis: "horas",
      };
    }
  }
  if (item.totalPrice > 0) {
    return { days: Math.max(1, Math.ceil(item.totalPrice / GENERIC_MZN_PER_DAY)), basis: "valor" };
  }
  return { days: 1, basis: "minimo" };
}

// Mantida como função pura/exportada porque já é usada por testes e outros módulos. O planeador
// novo não usa a duração de capítulos como prazo de obra; os resumos são recalculados pelo span
// real dos filhos depois do grafo de precedências ser calendarizado.
type ScheduledNode = {
  node: LineItemNode;
  durationDays: number;
  basis: DurationBasis | "soma";
  children: ScheduledNode[];
};

export function computeNodeDurations(
  node: LineItemNode,
  hoursCache: Map<string, number>,
  maxCrewSize: number = DEFAULT_FALLBACK_CREW_SIZE,
  productivityCache: Map<string, number> = new Map(),
): ScheduledNode | null {
  if (node.kind === "nota") return null;
  if (node.kind === "item") {
    const result = computeItemDurationDays(node, hoursCache, maxCrewSize, productivityCache);
    return { node, durationDays: result.days, basis: result.basis, children: [] };
  }
  const children = node.children
    .map((child) => computeNodeDurations(child, hoursCache, maxCrewSize, productivityCache))
    .filter((child): child is ScheduledNode => child !== null);
  return {
    node,
    durationDays: children.reduce((sum, child) => sum + child.durationDays, 0) || 1,
    basis: "soma",
    children,
  };
}

async function buildLabourHoursPerUnitCache(
  node: LineItemNode,
  companyId: string | null,
  zoneId: string | null,
  cache: Map<string, number>,
): Promise<void> {
  if (node.kind === "item" && (node.quantity ?? 0) > 0 && node.compositionId && !cache.has(node.compositionId)) {
    const lines = await getCompositionLabourQuantities(node.compositionId, companyId, zoneId);
    cache.set(node.compositionId, lines.reduce((sum, line) => sum + line.hoursPerUnit, 0));
  }
  for (const child of node.children) await buildLabourHoursPerUnitCache(child, companyId, zoneId, cache);
}

function toPlanningSourceNode(
  node: LineItemNode,
  hoursCache: Map<string, number>,
  productivityCache: Map<string, number>,
  fallbackCrewSize: number,
  profile: SchedulePlanningProfile | null,
): PlanningSourceNode | null {
  if (node.kind === "nota") return null;
  if (node.kind === "item") {
    // O cronograma contém todas as linhas aprovadas realmente medidas; linhas de catálogo com 0
    // ficam no BOQ, mas não são trabalhos a executar.
    if ((node.quantity ?? 0) <= 0) return null;
    const trade = planningTradeForSource({ code: node.code, name: node.description });
    const crewSize = trade && profile?.crewSizes[trade] ? profile.crewSizes[trade]! : fallbackCrewSize;
    const { days, basis } = computeItemDurationDays(node, hoursCache, crewSize, productivityCache);
    return {
      id: node.id,
      kind: node.kind,
      code: node.code,
      name: node.description,
      quantity: node.quantity,
      durationDays: days,
      durationBasis: basis,
      sortOrder: node.sortOrder,
      children: [],
    };
  }

  const children = node.children
    .map((child) => toPlanningSourceNode(child, hoursCache, productivityCache, fallbackCrewSize, profile))
    .filter((child): child is PlanningSourceNode => child !== null);
  if (!children.length) return null;
  return {
    id: node.id,
    kind: node.kind,
    code: node.code,
    name: node.description,
    quantity: node.quantity,
    durationDays: children.reduce((sum, child) => sum + child.durationDays, 0) || 1,
    durationBasis: "soma",
    sortOrder: node.sortOrder,
    children,
  };
}

function planningSections(
  summary: NonNullable<Awaited<ReturnType<typeof getBudgetDocumentSummary>>>,
  hoursCache: Map<string, number>,
  productivityCache: Map<string, number>,
  fallbackCrewSize: number,
  profile: SchedulePlanningProfile | null = null,
): PlanningSourceSection[] {
  return summary.sections.map((section) => {
    return {
      id: section.id,
      name: section.name,
      sortOrder: section.sortOrder,
      templateKey: section.templateKey,
      roots: section.items
        .map((root) => toPlanningSourceNode(root, hoursCache, productivityCache, fallbackCrewSize, profile))
        .filter((root): root is PlanningSourceNode => root !== null),
    };
  });
}

function flattenPlannedNodes(roots: PlannedNode[]): PlannedNode[] {
  const result: PlannedNode[] = [];
  const walk = (node: PlannedNode) => {
    result.push(node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return result;
}

function weightBasisFromPlanned(roots: PlannedNode[]): "produtividade" | "horas" | "valor" | "minimo" | "misto" {
  const bases = new Set(
    flattenPlannedNodes(roots)
      .filter((node) => node.kind === "activity")
      .map((node) => node.durationBasis)
      .filter((basis): basis is DurationBasis => basis !== "soma"),
  );
  if (bases.size === 1) return [...bases][0];
  if (bases.size > 1) return "misto";
  return "minimo";
}

async function insertPlannedNode(
  node: PlannedNode,
  args: { projectId: string; budgetDocumentId: string },
  parentId: string | null,
  idByPlanKey: Map<string, string>,
): Promise<void> {
  const [task] = await db.insert(scheduleTasks).values({
    projectId: args.projectId,
    parentId,
    budgetDocumentId: args.budgetDocumentId,
    budgetLineItemId: node.sourceLineItemId,
    code: node.wbsCode,
    name: node.name.slice(0, 240),
    budgetChapterCode: node.sourceCode,
    valueShare: node.valueShare.toFixed(4),
    durationBasis: node.durationBasis,
    startDate: node.startDate,
    endDate: node.endDate,
    baselineStartDate: node.startDate,
    baselineEndDate: node.endDate,
    durationDays: node.durationDays,
    sortOrder: node.sortOrder,
  }).returning();
  idByPlanKey.set(node.key, task.id);
  for (const child of node.children) await insertPlannedNode(child, args, task.id, idByPlanKey);
}

function plannerValidationWarnings(planWarnings: PlanningWarning[]) {
  return planWarnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    sourceCode: warning.sourceCode ?? null,
    activityName: warning.activityName ?? null,
  }));
}



type PlanningPrepared = {
  summary: NonNullable<Awaited<ReturnType<typeof getBudgetDocumentSummary>>>;
  sections: PlanningSourceSection[];
  context: PlanningContext;
  floors: number;
  fallbackCrewSize: number;
  physicalContext: SchedulePhysicalContext;
};

async function preparePlanning(args: {
  projectId: string;
  budgetDocumentId: string;
  companyId?: string | null;
  zoneId?: string | null;
  profile?: SchedulePlanningProfile | null;
}): Promise<PlanningPrepared> {
  const summary = await getBudgetDocumentSummary(args.budgetDocumentId);
  if (!summary) throw new Error("Mapa de Quantidades não encontrado");
  const allRoots = summary.sections.flatMap((section) => section.items);
  if (!allRoots.length) throw new Error("O Mapa de Quantidades ainda não tem capítulos para gerar a WBS");

  const hoursCache = new Map<string, number>();
  for (const root of allRoots) await buildLabourHoursPerUnitCache(root, args.companyId ?? null, args.zoneId ?? null, hoursCache);
  const productivityCache = new Map<string, number>();
  for (const compositionId of hoursCache.keys()) {
    try {
      const breakdown = await computeCompositionUnitCostV2(compositionId, args.companyId ?? null, args.zoneId ?? null);
      if (Number(breakdown.productivity.outputPerDay) > 0) productivityCache.set(compositionId, Number(breakdown.productivity.outputPerDay));
    } catch { /* mantém horas/valor/mínimo como fallback auditável */ }
  }

  const fallbackCrewSize = DEFAULT_FALLBACK_CREW_SIZE;
  const [[project], roomRows, plantRows, measurementRows] = await Promise.all([
    db.select({ floors: projects.floors }).from(projects).where(eq(projects.id, args.projectId)).limit(1),
    db.select({ id: extractedRooms.id, name: extractedRooms.name, number: extractedRooms.number, floor: extractedRooms.floor, areaM2: extractedRooms.areaM2, perimeterM: extractedRooms.perimeterM })
      .from(extractedRooms)
      .innerJoin(plants, eq(extractedRooms.plantId, plants.id))
      .where(eq(plants.projectId, args.projectId)),
    db.select({ structuralSummary: plants.structuralSummary })
      .from(plants)
      .where(eq(plants.projectId, args.projectId)),
    db.select({ description: measurementLines.description })
      .from(measurementLines)
      .innerJoin(lineItems, eq(measurementLines.lineItemId, lineItems.id))
      .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
      .where(and(eq(budgetSections.documentId, args.budgetDocumentId), eq(measurementLines.isActive, true))),
  ]);
  const structuralLabels = plantRows.flatMap((row) => row.structuralSummary?.slabs?.map((slab) => slab.floor) ?? []);
  const resolvedFloors = resolveProjectFloors(project?.floors ?? 1, [
    ...roomRows.map((row) => row.floor),
    ...structuralLabels,
    ...measurementRows.map((row) => row.description),
  ]);
  const floors = resolvedFloors.floors;
  const roomKeys = new Set<string>();
  const rooms = roomRows.flatMap((row) => {
    const label = `${row.name}${row.number ? ` ${row.number}` : ""}`.trim();
    const identity = `${label.toLowerCase()}|${row.floor ?? ""}|${Number(row.areaM2).toFixed(2)}`;
    if (roomKeys.has(identity)) return [];
    roomKeys.add(identity);
    return [{
      key: row.id,
      label,
      floorLabel: row.floor,
      weight: Math.max(0.01, Number(row.perimeterM ?? row.areaM2 ?? 1)),
    }];
  });
  // footingsCount vem de leitura por IA da planta — sem tecto, uma leitura errada (escala mal
  // interpretada, um número de divisão confundido com contagem de sapatas) gera um array gigante
  // e um WBS com milhares de linhas, ou um RangeError se ultrapassar o limite de um array em JS.
  const footingCount = Math.min(300, plantRows.reduce((max, row) => Math.max(max, row.structuralSummary?.footingsCount ?? 0), 0));
  const footings = Array.from({ length: footingCount }, (_, index) => ({
    key: `footing-${index + 1}`,
    label: `Sapata S${String(index + 1).padStart(2, "0")}`,
    floorLabel: null,
    weight: 1,
  }));
  const slabKeys = new Set<string>();
  const slabs = plantRows.flatMap((row) => row.structuralSummary?.slabs ?? []).flatMap((slab, index) => {
    const label = slab.name?.trim() || `Laje ${index + 1}`;
    const identity = `${label.toLowerCase()}|${slab.floor ?? ""}|${slab.areaM2 ?? ""}|${slab.thicknessCm}`;
    if (slabKeys.has(identity)) return [];
    slabKeys.add(identity);
    return [{
      key: `slab-${slabKeys.size}`,
      label: `${label}${slab.thicknessCm ? ` (${slab.thicknessCm.toFixed(2)} cm)` : ""}`,
      floorLabel: slab.floor,
      weight: Math.max(0.01, slab.areaM2 ?? 1),
    }];
  });
  const physicalContext: SchedulePhysicalContext = {
    source: footings.length || slabs.length || rooms.length ? "plants" : measurementRows.length ? "measurements" : "budget",
    footings,
    slabs,
    rooms,
  };
  const sections = planningSections(summary, hoursCache, productivityCache, fallbackCrewSize, args.profile ?? null);
  const context = {
    ...buildPlanningContext(sections, floors, resolvedFloors.labels),
    configuredFloors: resolvedFloors.configuredFloors,
    floorSource: resolvedFloors.source,
  };
  return { summary, sections, context, floors, fallbackCrewSize, physicalContext };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readPlanningRow(projectId: string, budgetDocumentId: string) {
  const [row] = await db.select().from(projectSchedulePlanningProfiles).where(and(
    eq(projectSchedulePlanningProfiles.projectId, projectId),
    eq(projectSchedulePlanningProfiles.budgetDocumentId, budgetDocumentId),
  )).limit(1);
  return row ?? null;
}

function planningSourceFingerprint(sections: PlanningSourceSection[]) {
  const serializeNode = (node: PlanningSourceNode): unknown => ({
    id: node.id,
    kind: node.kind,
    code: node.code,
    name: node.name,
    quantity: node.quantity,
    durationDays: node.durationDays,
    durationBasis: node.durationBasis,
    sortOrder: node.sortOrder,
    children: node.children.map(serializeNode),
  });
  return sections.map((section) => ({
    id: section.id,
    name: section.name,
    sortOrder: section.sortOrder,
    templateKey: section.templateKey,
    roots: section.roots.map(serializeNode),
  }));
}

function planningPlanFingerprint(args: {
  budgetDocumentId: string;
  profile: SchedulePlanningProfile;
  sections: PlanningSourceSection[];
  plan: ReturnType<typeof buildExecutionPlan>;
}) {
  const leaves = flattenPlannedNodes(args.plan.roots)
    .filter((node) => node.kind === "activity")
    .map((node) => ({
      key: node.key,
      wbsCode: node.wbsCode,
      name: node.name,
      sourceLineItemId: node.sourceLineItemId,
      sourceCode: node.sourceCode,
      valueShare: node.valueShare,
      durationDays: node.durationDays,
      durationBasis: node.durationBasis,
      floorIndex: node.floorIndex,
      zoneId: node.zoneId,
      allocationBasis: node.allocationBasis,
      startDate: node.startDate,
      endDate: node.endDate,
    }));
  return hashJson({
    budgetDocumentId: args.budgetDocumentId,
    profile: args.profile,
    source: planningSourceFingerprint(args.sections),
    leaves,
    dependencies: args.plan.dependencies,
  });
}

export async function saveSchedulePlanningProfile(args: {
  projectId: string;
  budgetDocumentId: string;
  profile: SchedulePlanningProfile;
  companyId?: string | null;
  zoneId?: string | null;
}) {
  const firstPass = await preparePlanning({ ...args, profile: null });
  const profile = mergeSchedulePlanningProfile(firstPass.context, args.profile.startDate, args.profile);
  const errors = validateSchedulePlanningProfile(profile, firstPass.context);
  if (errors.length) throw new Error(errors.join(" "));
  const profileFingerprint = hashJson(profile);

  const existing = await readPlanningRow(args.projectId, args.budgetDocumentId);
  const values = {
    profile,
    profileFingerprint,
    status: "draft",
    lastPreviewFingerprint: null,
    lastPreviewStartDate: null,
    previewedAt: null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(projectSchedulePlanningProfiles).set(values).where(eq(projectSchedulePlanningProfiles.id, existing.id));
  } else {
    await db.insert(projectSchedulePlanningProfiles).values({
      projectId: args.projectId,
      budgetDocumentId: args.budgetDocumentId,
      ...values,
    });
  }
  return profile;
}

export async function getSchedulePlanningSetup(args: {
  projectId: string;
  budgetDocumentId: string;
  startDate: string;
  companyId?: string | null;
  zoneId?: string | null;
}) {
  const prepared = await preparePlanning(args);
  const saved = await readPlanningRow(args.projectId, args.budgetDocumentId);
  const savedProfile = saved?.profile ? saved.profile as Partial<SchedulePlanningProfile> : null;
  const profile = mergeSchedulePlanningProfile(prepared.context, args.startDate, savedProfile);
  const validationErrors = validateSchedulePlanningProfile(profile, prepared.context);
  let needsRegeneration = false;
  const regenerationReasons: string[] = [];
  if (saved?.status === "generated") {
    if (savedProfile?.floorLabels?.length !== prepared.context.floors) {
      regenerationReasons.push(`A obra passou a ter ${prepared.context.floors} piso(s) confirmado(s).`);
    }
    if (!validationErrors.length) {
      const currentPlan = buildExecutionPlan({
        sections: prepared.sections,
        floors: prepared.floors,
        startDate: profile.startDate,
        profile,
        physicalContext: prepared.physicalContext,
      });
      const currentFingerprint = planningPlanFingerprint({
        budgetDocumentId: args.budgetDocumentId,
        profile,
        sections: prepared.sections,
        plan: currentPlan,
      });
      needsRegeneration = !saved.lastPreviewFingerprint || saved.lastPreviewFingerprint !== currentFingerprint;
      if (needsRegeneration && !regenerationReasons.length) {
        regenerationReasons.push("As medições, quantidades ou regras de execução mudaram desde a última linha de base.");
      }
    } else {
      needsRegeneration = true;
      regenerationReasons.push("Os dados actuais precisam de confirmação antes de actualizar a linha de base.");
    }
  }
  return {
    context: prepared.context,
    questions: buildPlanningQuestions(prepared.context),
    profile,
    status: saved?.status ?? "draft",
    previewFingerprint: saved?.lastPreviewFingerprint ?? null,
    previewedAt: saved?.previewedAt ?? null,
    generatedAt: saved?.generatedAt ?? null,
    validationErrors,
    needsRegeneration,
    regenerationReasons,
  };
}

function planPreviewRows(roots: PlannedNode[]) {
  const leaves = flattenPlannedNodes(roots).filter((node) => node.kind === "activity");
  const durationBasis = { horas: 0, valor: 0, minimo: 0 };
  const allocationBasis = { boq: 0, informado: 0, assumido: 0 };
  for (const task of leaves) {
    if (task.durationBasis === "horas" || task.durationBasis === "valor" || task.durationBasis === "minimo") durationBasis[task.durationBasis] += 1;
    allocationBasis[task.allocationBasis] += 1;
  }
  return {
    activityCount: leaves.length,
    durationBasis,
    allocationBasis,
    sampleActivities: leaves.slice(0, 40).map((task) => ({
      code: task.wbsCode,
      name: task.name,
      durationDays: task.durationDays,
      durationBasis: task.durationBasis,
      startDate: task.startDate,
      endDate: task.endDate,
      sourceCode: task.sourceCode,
      valueShare: task.valueShare,
      allocationBasis: task.allocationBasis,
    })),
  };
}

async function buildPersistedPlanningPlan(args: {
  projectId: string;
  budgetDocumentId: string;
  startDate: string;
  companyId?: string | null;
  zoneId?: string | null;
}) {
  const firstPass = await preparePlanning(args);
  const row = await readPlanningRow(args.projectId, args.budgetDocumentId);
  if (!row?.profile) throw new Error("Complete e guarde o Assistente de Planeamento antes de pré-visualizar a EAP");
  const profile = mergeSchedulePlanningProfile(firstPass.context, args.startDate, row.profile as Partial<SchedulePlanningProfile>);
  const errors = validateSchedulePlanningProfile(profile, firstPass.context);
  if (errors.length) throw new Error(errors.join(" "));
  const prepared = await preparePlanning({ ...args, profile });
  const plan = buildExecutionPlan({
    sections: prepared.sections,
    floors: prepared.floors,
    startDate: profile.startDate,
    profile,
    physicalContext: prepared.physicalContext,
  });
  const shareRows = validateValueShares(plan.roots);
  const shareIssues = shareRows.filter((item) => Math.abs(item.totalShare - 1) > 0.0001);
  const coverage = validatePlanCoverage(prepared.sections, plan.roots);
  return { row, profile, prepared, plan, shareRows, shareIssues, coverage };
}

export async function previewSchedulePlanning(args: {
  projectId: string;
  budgetDocumentId: string;
  startDate: string;
  companyId?: string | null;
  zoneId?: string | null;
}) {
  const built = await buildPersistedPlanningPlan(args);
  const errors: string[] = [];
  if (built.shareIssues.length) errors.push(`${built.shareIssues.length} linha(s) do BOQ não fecham valueShare em 100%.`);
  if (built.coverage.missingSourceLineItemIds.length) errors.push(`${built.coverage.missingSourceLineItemIds.length} linha(s) medidas do BOQ ficaram fora da EAP.`);
  if (built.coverage.unexpectedSourceLineItemIds.length) errors.push(`${built.coverage.unexpectedSourceLineItemIds.length} actividade(s) não têm origem no BOQ aprovado.`);

  const previewFingerprint = errors.length ? null : planningPlanFingerprint({
    budgetDocumentId: args.budgetDocumentId,
    profile: built.profile,
    sections: built.prepared.sections,
    plan: built.plan,
  });
  await db.update(projectSchedulePlanningProfiles).set({
    status: errors.length ? "draft" : "previewed",
    lastPreviewFingerprint: previewFingerprint,
    lastPreviewStartDate: errors.length ? null : built.profile.startDate,
    previewedAt: errors.length ? null : new Date(),
    updatedAt: new Date(),
  }).where(eq(projectSchedulePlanningProfiles.id, built.row.id));

  const rows = planPreviewRows(built.plan.roots);
  return {
    valid: errors.length === 0,
    readyToGenerate: errors.length === 0,
    errors,
    previewFingerprint,
    context: built.prepared.context,
    profile: built.profile,
    strategy: {
      floors: built.prepared.floors,
      locationStrategy: built.profile.locationStrategy,
      sequencePolicy: built.profile.sequencePolicy,
      roofKind: built.plan.roofKind,
      activeTrades: built.prepared.context.activeTrades,
      tradeFronts: built.profile.tradeFronts,
      crewSizes: built.profile.crewSizes,
      cureLags: built.profile.cureLags,
      zones: built.profile.zones,
      physicalScope: {
        source: built.prepared.physicalContext.source,
        footings: built.prepared.physicalContext.footings.length,
        slabs: built.prepared.physicalContext.slabs.length,
        rooms: built.prepared.physicalContext.rooms.length,
      },
    },
    naturalDurationDays: built.plan.naturalDurationDays,
    targetDurationDays: built.plan.targetDurationDays,
    plannedDurationDays: built.plan.durationDays,
    startDate: built.plan.startDate,
    endDate: built.plan.endDate,
    warnings: plannerValidationWarnings(built.plan.warnings),
    assumptions: built.plan.assumptions,
    validation: {
      valueSharesValid: built.shareIssues.length === 0,
      checkedBudgetItems: built.shareRows.length,
      coverage: built.coverage,
      dependencyCount: built.plan.dependencies.length,
      ...rows,
    },
  };
}

/**
 * Gera a EAP apenas quando existe uma pré-visualização válida da MESMA estratégia.
 * O fingerprint inclui perfil, linhas BOQ repartidas, durações, datas e dependências.
 */
export async function generateSchedule(args: {
  projectId: string;
  budgetDocumentId: string;
  startDate: string;
  previewFingerprint: string;
  companyId?: string | null;
  zoneId?: string | null;
}) {
  const built = await buildPersistedPlanningPlan(args);
  if (built.shareIssues.length || built.coverage.missingSourceLineItemIds.length || built.coverage.unexpectedSourceLineItemIds.length) {
    throw new Error("A validação automática falhou. Reveja a pré-visualização antes de gerar a EAP.");
  }
  const currentFingerprint = planningPlanFingerprint({
    budgetDocumentId: args.budgetDocumentId,
    profile: built.profile,
    sections: built.prepared.sections,
    plan: built.plan,
  });
  if (built.row.status !== "previewed" || !built.row.lastPreviewFingerprint) {
    throw new Error("Faça a pré-visualização da estratégia antes de gerar a EAP");
  }
  if (args.previewFingerprint !== currentFingerprint || built.row.lastPreviewFingerprint !== currentFingerprint) {
    throw new Error("A estratégia, a data de início ou o plano calculado mudou desde a pré-visualização. Gere uma nova pré-visualização.");
  }

  // Só apaga a linha de base antiga depois de toda a nova EAP estar construída e auditada em memória.
  await db.delete(scheduleTasks).where(eq(scheduleTasks.projectId, args.projectId));
  const idByPlanKey = new Map<string, string>();
  for (const root of built.plan.roots) await insertPlannedNode(root, args, null, idByPlanKey);
  const dependencyRows = built.plan.dependencies.flatMap((dependency) => {
    const predecessorTaskId = idByPlanKey.get(dependency.predecessorKey);
    const successorTaskId = idByPlanKey.get(dependency.successorKey);
    if (!predecessorTaskId || !successorTaskId) return [];
    return [{ predecessorTaskId, successorTaskId, type: dependency.type, lagDays: dependency.lagDays } satisfies typeof scheduleDependencies.$inferInsert];
  });
  if (dependencyRows.length) await db.insert(scheduleDependencies).values(dependencyRows);

  await db.update(projectSchedulePlanningProfiles).set({
    status: "generated",
    generatedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(projectSchedulePlanningProfiles.id, built.row.id));

  const schedule = await getProjectSchedule(args.projectId);
  return {
    ...schedule,
    weightBasis: weightBasisFromPlanned(built.plan.roots),
    roofKind: built.plan.roofKind,
    generationWarnings: plannerValidationWarnings(built.plan.warnings),
    planningAssumptions: built.plan.assumptions,
    planningProfile: built.profile,
    validation: {
      ...schedule.validation,
      valueSharesValid: true,
      checkedBudgetItems: built.shareRows.length,
      coverage: built.coverage,
    },
  };
}

function findNodeByCode(nodes: LineItemNode[], code: string): LineItemNode | null {
  for (const node of nodes) {
    if (node.code === code) return node;
    const child = findNodeByCode(node.children, code);
    if (child) return child;
  }
  return null;
}

function findNodeById(nodes: LineItemNode[], id: string): LineItemNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children, id);
    if (child) return child;
  }
  return null;
}

function weightBasisFromPersistedTasks(
  tasks: Array<typeof scheduleTasks.$inferSelect>,
  hasChildren: (taskId: string) => boolean,
): "horas" | "valor" | "minimo" | "manual" | "misto" {
  const leaves = tasks.filter((task) => !hasChildren(task.id));
  const bases = new Set(leaves.map((task) => task.durationBasis ?? "manual").filter((basis) => basis !== "soma"));
  if (bases.size === 1) return [...bases][0] as "horas" | "valor" | "minimo" | "manual";
  return bases.size > 1 ? "misto" : "manual";
}

export async function getProjectSchedule(projectId: string) {
  const workCalendar = await loadProjectWorkCalendar(projectId);
  const calendar = toWorkCalendarOptions(workCalendar);
  const tasks: Array<typeof scheduleTasks.$inferSelect> = await db.select().from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId)).orderBy(scheduleTasks.sortOrder);
  if (!tasks.length) {
    return {
      tasks: [],
      dependencies: [],
      startDate: null,
      endDate: null,
      overallProgress: 0,
      plannedValue: 0,
      executedValue: 0,
      weightBasis: "manual" as const,
      validation: { valueSharesValid: true, checkedBudgetItems: 0, valueShareIssues: [], longActivities: [] },
      lookahead: { weeks: 2, start: null, end: null, tasks: [] },
      sCurve: [],
    };
  }

  const taskIds = tasks.map((task) => task.id);
  const dependencies: Array<typeof scheduleDependencies.$inferSelect> = await db.select().from(scheduleDependencies).where(inArray(scheduleDependencies.successorTaskId, taskIds));
  const documentIds = Array.from(new Set(tasks.map((task) => task.budgetDocumentId).filter((id): id is string => Boolean(id))));
  const summaries = new Map<string, NonNullable<Awaited<ReturnType<typeof getBudgetDocumentSummary>>>>();
  for (const id of documentIds) {
    const summary = await getBudgetDocumentSummary(id);
    if (summary) summaries.set(id, summary);
  }

  const approved: Array<typeof measurementCertificates.$inferSelect> = await db
    .select()
    .from(measurementCertificates)
    .where(and(eq(measurementCertificates.projectId, projectId), eq(measurementCertificates.status, "aprovado")))
    .orderBy(desc(measurementCertificates.number));
  const latestByDocument = new Map<string, typeof approved[number]>();
  for (const certificate of approved) if (!latestByDocument.has(certificate.budgetDocumentId)) latestByDocument.set(certificate.budgetDocumentId, certificate);
  const latestCertificateIds = Array.from(latestByDocument.values(), (certificate) => certificate.id);
  const measured: Array<{ certificateId: string; lineItemId: string; code: string | null; qty: string; unitPrice: string | null }> = latestCertificateIds.length
    ? await db
        .select({
          certificateId: measurementCertificateLines.certificateId,
          lineItemId: measurementCertificateLines.lineItemId,
          code: lineItems.code,
          qty: measurementCertificateLines.cumulativeQty,
          unitPrice: lineItems.unitPrice,
        })
        .from(measurementCertificateLines)
        .innerJoin(lineItems, eq(measurementCertificateLines.lineItemId, lineItems.id))
        .where(inArray(measurementCertificateLines.certificateId, latestCertificateIds))
    : [];

  const diaryProgressRows: Array<{ progress: typeof siteDiaryTaskProgress.$inferSelect; date: string }> = await db
    .select({ progress: siteDiaryTaskProgress, date: siteDiaryEntries.date })
    .from(siteDiaryTaskProgress)
    .innerJoin(siteDiaryEntries, eq(siteDiaryTaskProgress.diaryEntryId, siteDiaryEntries.id))
    .where(inArray(siteDiaryTaskProgress.scheduleTaskId, taskIds))
    .orderBy(desc(siteDiaryEntries.date));
  const latestDiaryProgress = new Map<string, number>();
  for (const row of diaryProgressRows) if (!latestDiaryProgress.has(row.progress.scheduleTaskId)) latestDiaryProgress.set(row.progress.scheduleTaskId, Number(row.progress.progressPercent));

  const baseEnriched = tasks.map((task) => {
    const summary = task.budgetDocumentId ? summaries.get(task.budgetDocumentId) : null;
    const summaryRoots = summary?.sections.flatMap((section) => section.items) ?? [];
    const budgetNode = summary
      ? task.budgetLineItemId
        ? findNodeById(summaryRoots, task.budgetLineItemId)
        : task.budgetChapterCode
          ? findNodeByCode(summaryRoots, task.budgetChapterCode)
          : null
      : null;
    const valueShare = Number(task.valueShare ?? 1);
    const plannedValue = (budgetNode?.totalPrice ?? 0) * valueShare;
    const certificate = task.budgetDocumentId ? latestByDocument.get(task.budgetDocumentId) : null;
    const executedValue = certificate
      ? measured
          .filter((line) => {
            if (line.certificateId !== certificate.id) return false;
            if (task.budgetLineItemId) return line.lineItemId === task.budgetLineItemId;
            return Boolean(task.budgetChapterCode && (line.code === task.budgetChapterCode || line.code?.startsWith(`${task.budgetChapterCode}.`)));
          })
          .reduce((sum, line) => sum + Number(line.qty) * Number(line.unitPrice ?? 0), 0) * valueShare
      : 0;
    const measuredProgress = plannedValue > 0 ? Math.min(100, (executedValue / plannedValue) * 100) : 0;
    const diaryProgress = latestDiaryProgress.get(task.id) ?? 0;
    const manualProgress = Number(task.manualProgress ?? 0);
    const progress = Math.max(measuredProgress, diaryProgress, manualProgress);
    const effectiveStatus = task.status === "bloqueado"
      ? task.status
      : progress >= 100 ? "concluido" : progress > 0 ? "em_curso" : task.status;
    const predecessorRows = dependencies.filter((dependency) => dependency.successorTaskId === task.id);
    const predecessor = predecessorRows[0];
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
      predecessorTaskIds: predecessorRows.map((row) => row.predecessorTaskId),
      dependencyCount: predecessorRows.length,
      dependencyType: predecessor?.type ?? null,
      lagDays: predecessor?.lagDays ?? 0,
      isMilestone: task.name.startsWith("◆ Marco"),
    };
  });

  const childrenByParent = new Map<string, typeof baseEnriched>();
  const byId = new Map(baseEnriched.map((task) => [task.id, task]));
  for (const task of baseEnriched) {
    if (!task.parentId) continue;
    const children = childrenByParent.get(task.parentId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentId, children);
  }
  for (const [, children] of childrenByParent) children.sort((a, b) => a.sortOrder - b.sortOrder);

  function wbsDepth(taskId: string): number {
    let depth = 0;
    let cursor = byId.get(taskId);
    const seen = new Set<string>();
    while (cursor?.parentId) {
      if (seen.has(cursor.id)) break;
      seen.add(cursor.id);
      depth += 1;
      cursor = byId.get(cursor.parentId);
    }
    return depth;
  }

  type EnrichedTask = Omit<(typeof baseEnriched)[number], "progressSource"> & {
    isSummary: boolean;
    wbsDepth: number;
    progressSource: "autos" | "diario" | "manual" | "planeamento" | "subactividades";
  };
  const rolled = new Map<string, EnrichedTask>();

  function rollup(taskId: string): EnrichedTask {
    const cached = rolled.get(taskId);
    if (cached) return cached;
    const task = byId.get(taskId)!;
    const children = childrenByParent.get(taskId) ?? [];
    if (!children.length) {
      const leaf = { ...task, isSummary: false as const, wbsDepth: wbsDepth(taskId) };
      rolled.set(taskId, leaf);
      return leaf;
    }

    const rolledChildren = children.map((child) => rollup(child.id));
    const childrenPlannedValue = rolledChildren.reduce((sum, child) => sum + child.plannedValue, 0);
    const plannedValue = childrenPlannedValue > 0 ? childrenPlannedValue : task.plannedValue;
    const executedValue = childrenPlannedValue > 0 ? rolledChildren.reduce((sum, child) => sum + child.executedValue, 0) : task.executedValue;
    const progress = childrenPlannedValue > 0
      ? rolledChildren.reduce((sum, child) => sum + child.plannedValue * child.progress / 100, 0) / childrenPlannedValue * 100
      : rolledChildren.reduce((sum, child) => sum + child.progress, 0) / rolledChildren.length;
    const status = rolledChildren.some((child) => child.status === "bloqueado")
      ? "bloqueado" as const
      : rolledChildren.every((child) => child.status === "concluido")
        ? "concluido" as const
        : rolledChildren.some((child) => child.status === "em_curso" || child.progress > 0)
          ? "em_curso" as const
          : "nao_iniciado" as const;
    const startDate = rolledChildren.reduce((min, child) => child.startDate < min ? child.startDate : min, rolledChildren[0].startDate);
    const endDate = rolledChildren.reduce((max, child) => child.endDate > max ? child.endDate : max, rolledChildren[0].endDate);
    const baselineChildren = rolledChildren.filter((child) => child.baselineStartDate && child.baselineEndDate);
    const baselineStartDate = baselineChildren.length
      ? baselineChildren.reduce((min, child) => child.baselineStartDate! < min ? child.baselineStartDate! : min, baselineChildren[0].baselineStartDate!)
      : task.baselineStartDate;
    const baselineEndDate = baselineChildren.length
      ? baselineChildren.reduce((max, child) => child.baselineEndDate! > max ? child.baselineEndDate! : max, baselineChildren[0].baselineEndDate!)
      : task.baselineEndDate;
    const summaryTask: EnrichedTask = {
      ...task,
      isSummary: true,
      wbsDepth: wbsDepth(taskId),
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
    rolled.set(taskId, summaryTask);
    return summaryTask;
  }

  for (const task of baseEnriched) rollup(task.id);

  function walk(taskId: string): EnrichedTask[] {
    const task = rolled.get(taskId)!;
    const children = childrenByParent.get(taskId) ?? [];
    return [task, ...children.flatMap((child) => walk(child.id))];
  }

  const roots = baseEnriched.filter((task) => !task.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const orderedEnriched = roots.flatMap((root) => walk(root.id));
  const topLevelTasks = roots.map((root) => rolled.get(root.id)!);
  const plannedValue = topLevelTasks.reduce((sum, task) => sum + task.plannedValue, 0);
  const executedValue = topLevelTasks.reduce((sum, task) => sum + task.executedValue, 0);

  // Auditoria persistente da ligação BOQ ↔ WBS. Só folhas contam; resumos não devem reclamar valor.
  const persistedLeafTasks = tasks.filter((task) => !(childrenByParent.get(task.id)?.length));
  const shareByBudgetItem = new Map<string, number>();
  for (const task of persistedLeafTasks) {
    const key = task.budgetLineItemId ?? (task.budgetDocumentId && task.budgetChapterCode ? `${task.budgetDocumentId}:${task.budgetChapterCode}` : null);
    if (!key) continue;
    shareByBudgetItem.set(key, (shareByBudgetItem.get(key) ?? 0) + Number(task.valueShare ?? 1));
  }
  const valueShareIssues = [...shareByBudgetItem.entries()]
    .map(([budgetItem, totalShare]) => ({ budgetItem, totalShare: Math.round(totalShare * 10_000) / 10_000 }))
    .filter((row) => Math.abs(row.totalShare - 1) > 0.0001);
  const longActivities = persistedLeafTasks
    .filter((task) => task.durationDays > 20)
    .map((task) => ({ id: task.id, code: task.code, name: task.name, durationDays: task.durationDays }));

  const leavesForCpm = orderedEnriched.filter((task) => !task.isSummary);
  const cpm = computeCpmNetwork(
    leavesForCpm.map((task) => ({ id: task.id, durationDays: task.durationDays })),
    dependencies.map((dep) => ({
      predecessorId: dep.predecessorTaskId,
      successorId: dep.successorTaskId,
      type: dep.type,
      lagDays: dep.lagDays,
    })),
    orderedEnriched.reduce((min, task) => task.startDate < min ? task.startDate : min, orderedEnriched[0].startDate),
  );
  const asOf = new Date().toISOString().slice(0, 10);
  const window2 = lookaheadWindow(asOf, 2, calendar);
  const window4 = lookaheadWindow(asOf, 4, calendar);
  const window6 = lookaheadWindow(asOf, 6, calendar);
  const withCpm = orderedEnriched.map((task) => {
    const row = cpm.get(task.id);
    return {
      ...task,
      isMilestone: task.durationDays <= 0,
      earlyStart: row?.earlyStart ?? task.startDate,
      earlyFinish: row?.earlyFinish ?? task.endDate,
      lateStart: row?.lateStart ?? task.startDate,
      lateFinish: row?.lateFinish ?? task.endDate,
      totalFloatDays: row?.totalFloatDays ?? 0,
      isCritical: row?.isCritical ?? false,
      dateVarianceDays: task.baselineEndDate ? workingDaysInclusive(task.baselineEndDate, task.endDate, calendar) - 1 : 0,
      durationVarianceDays: task.baselineStartDate && task.baselineEndDate
        ? task.durationDays - workingDaysInclusive(task.baselineStartDate, task.baselineEndDate, calendar)
        : 0,
      progressVariance: task.progress,
    };
  });

  const materialAlerts = await buildScheduleMaterialAlerts({
    projectId,
    asOf,
    calendar,
    tasks: withCpm.map((task) => ({ id: task.id, name: task.name, startDate: task.startDate, status: task.status })),
  });

  return {
    tasks: withCpm,
    dependencies,
    calendar: {
      saturdayWorking: workCalendar.saturdayWorking,
      hoursPerDay: workCalendar.hoursPerDay,
      useNationalHolidays: workCalendar.useNationalHolidays,
      holidayCount: Array.isArray(workCalendar.holidays)
        ? workCalendar.holidays.length
        : (workCalendar.holidays instanceof Set ? workCalendar.holidays.size : 0),
    },
    startDate: withCpm.reduce((min, task) => task.startDate < min ? task.startDate : min, withCpm[0].startDate),
    endDate: withCpm.reduce((max, task) => task.endDate > max ? task.endDate : max, withCpm[0].endDate),
    overallProgress: plannedValue > 0
      ? Math.min(100, topLevelTasks.reduce((sum, task) => sum + task.plannedValue * task.progress / 100, 0) / plannedValue * 100)
      : topLevelTasks.length ? topLevelTasks.reduce((sum, task) => sum + task.progress, 0) / topLevelTasks.length : 0,
    plannedValue,
    executedValue,
    weightBasis: weightBasisFromPersistedTasks(tasks, (taskId) => Boolean(childrenByParent.get(taskId)?.length)),
    validation: {
      valueSharesValid: valueShareIssues.length === 0,
      checkedBudgetItems: shareByBudgetItem.size,
      valueShareIssues,
      longActivities,
    },
    lookahead: {
      weeks: 2,
      start: window2.start,
      end: window2.end,
      tasks: withCpm.filter((task) => !task.isSummary && inLookahead(task, window2)).map((task) => ({
        id: task.id,
        name: task.name,
        startDate: task.startDate,
        endDate: task.endDate,
        status: task.status,
        isCritical: task.isCritical,
      })),
      windows: {
        2: withCpm.filter((task) => !task.isSummary && inLookahead(task, window2)).length,
        4: withCpm.filter((task) => !task.isSummary && inLookahead(task, window4)).length,
        6: withCpm.filter((task) => !task.isSummary && inLookahead(task, window6)).length,
      },
      materialAlerts,
    },
    sCurve: buildValueSCurve(withCpm, asOf, 16),
  };
}

export async function upsertTaskDependency(
  taskId: string,
  predecessorTaskId?: string | null,
  type: "FS" | "SS" | "FF" | "SF" = "FS",
  lagDays = 0,
) {
  // Edição manual do predecessor significa substituir a lógica de entrada desta tarefa por uma
  // única ligação escolhida pelo utilizador. A WBS gerada pode ter múltiplas predecessoras; elas
  // permanecem intactas enquanto a tarefa não for editada.
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

  const projectTasks: Array<{ id: string }> = await db.select({ id: scheduleTasks.id }).from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId));
  const taskIds = projectTasks.map((task) => task.id);
  if (!taskIds.includes(predecessorTaskId)) throw new Error("A predecessora não pertence ao cronograma desta obra");

  const dependencies: Array<typeof scheduleDependencies.$inferSelect> = taskIds.length
    ? await db.select().from(scheduleDependencies).where(inArray(scheduleDependencies.successorTaskId, taskIds))
    : [];
  const predecessorsBySuccessor = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const list = predecessorsBySuccessor.get(dependency.successorTaskId) ?? [];
    list.push(dependency.predecessorTaskId);
    predecessorsBySuccessor.set(dependency.successorTaskId, list);
  }

  // Ao acrescentar predecessor → task, há ciclo se task já estiver a montante de predecessor.
  const stack = [predecessorTaskId];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) throw new Error("Esta dependência criaria um ciclo no cronograma");
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(predecessorsBySuccessor.get(current) ?? []));
  }
}

async function recalculateTaskFromAllPredecessors(taskId: string): Promise<boolean> {
  const [task] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, taskId)).limit(1);
  if (!task) return false;
  const dependencies: Array<typeof scheduleDependencies.$inferSelect> = await db.select().from(scheduleDependencies).where(eq(scheduleDependencies.successorTaskId, taskId));
  if (!dependencies.length) return false;

  let nextStart: string | null = null;
  for (const dependency of dependencies) {
    const [predecessor] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, dependency.predecessorTaskId)).limit(1);
    if (!predecessor) continue;
    const candidate = computeSuccessorDates(predecessor, dependency.type, dependency.lagDays, task.durationDays);
    if (!nextStart || candidate.startDate > nextStart) nextStart = candidate.startDate;
  }
  if (!nextStart) return false;
  const nextEnd = addWorkingDays(nextStart, task.durationDays - 1);
  if (nextStart === task.startDate && nextEnd === task.endDate) return false;
  await db.update(scheduleTasks).set({ startDate: nextStart, endDate: nextEnd, updatedAt: new Date() }).where(eq(scheduleTasks.id, task.id));
  return true;
}

/**
 * Propaga uma alteração por todo o DAG. Diferente do motor antigo, cada sucessora é recalculada
 * contra TODAS as suas predecessoras e usa a restrição mais tardia; uma ligação não pode
 * sobrescrever silenciosamente a outra.
 */
export async function cascadeSuccessorDates(taskId: string, visited: Set<string> = new Set()): Promise<void> {
  if (visited.has(taskId)) return;
  visited.add(taskId);
  const successorRows: Array<{ successorTaskId: string }> = await db.select({ successorTaskId: scheduleDependencies.successorTaskId })
    .from(scheduleDependencies)
    .where(eq(scheduleDependencies.predecessorTaskId, taskId));
  const successorIds = Array.from(new Set(successorRows.map((row) => row.successorTaskId)));
  for (const successorId of successorIds) {
    await recalculateTaskFromAllPredecessors(successorId);
    await cascadeSuccessorDates(successorId, visited);
  }
}
