import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetDocuments,
  lineItems,
  measurementCertificateLines,
  measurementCertificates,
  projects,
  scheduleDependencies,
  scheduleTasks,
  siteDiaryEntries,
  siteDiaryTaskProgress,
} from "../db/schema.js";
import { getBudgetDocumentSummary, type LineItemNode } from "./boqEngine.js";
import { getCompositionLabourQuantities } from "./costEngine.js";

const DAY_MS = 86_400_000;

// Obra: segunda a sábado — domingo nunca é dia útil.
export function isWorkingDay(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;
}

// Desloca uma data um número (positivo OU negativo) de dias úteis — usada para andar para a
// frente (FS/SS com lag positivo) e para trás (calcular o início de uma tarefa a partir de um
// fim fixo, em FF/SF).
export function shiftWorkingDays(date: string, days: number): string {
  if (days === 0) return date;
  const value = new Date(`${date}T00:00:00Z`);
  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + step);
    if (value.getUTCDay() !== 0) remaining -= 1; // obra: segunda a sábado
  }
  return value.toISOString().slice(0, 10);
}

export function addWorkingDays(date: string, days: number) {
  return shiftWorkingDays(date, days);
}

// Data de uma tarefa sucessora a partir da predecessora, do tipo de dependência e da folga
// (lagDays, pode ser negativa = avanço). Isto é o que faltava para FS/SS/FF/SF deixarem de ser
// só rótulos — passam a determinar mesmo as datas.
export function computeSuccessorDates(
  predecessor: { startDate: string; endDate: string },
  type: "FS" | "SS" | "FF" | "SF",
  lagDays: number,
  durationDays: number,
): { startDate: string; endDate: string } {
  const duration = Math.max(1, durationDays);
  if (type === "SS") {
    const startDate = shiftWorkingDays(predecessor.startDate, lagDays);
    return { startDate, endDate: addWorkingDays(startDate, duration - 1) };
  }
  if (type === "FF") {
    const endDate = shiftWorkingDays(predecessor.endDate, lagDays);
    return { startDate: shiftWorkingDays(endDate, -(duration - 1)), endDate };
  }
  if (type === "SF") {
    const endDate = shiftWorkingDays(predecessor.startDate, lagDays);
    return { startDate: shiftWorkingDays(endDate, -(duration - 1)), endDate };
  }
  // FS (omissão): só começa no dia útil seguinte ao fim da predecessora, mais a folga.
  const startDate = shiftWorkingDays(predecessor.endDate, 1 + lagDays);
  return { startDate, endDate: addWorkingDays(startDate, duration - 1) };
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

const DEFAULT_MAX_CREW_SIZE = 12;

// Duração de UM pacote de trabalho (item medido), calculada a partir do seu próprio conteúdo —
// nunca de uma fatia proporcional de um total maior. Horas reais = horas/unidade da composição ×
// quantidade medida deste item; a equipa é dimensionada ao volume do PRÓPRIO item (tecto baixo —
// uma linha de 5 m³ de betão não ganha uma equipa de 40 pessoas só porque a obra é grande).
//
// maxCrewSize é o TECTO de trabalhadores que a obra consegue pôr numa só frente em simultâneo
// (por omissão 12, equivalente ao comportamento anterior). A equipa "óptima" de cada item continua
// a ser calculada por raiz quadrada das horas — nunca linear — por isso uma tarefa pequena não
// ganha uma equipa enorme só porque há mais gente disponível; só as tarefas que já "pediam" uma
// equipa maior (muitas horas) é que aproveitam o tecto mais alto e ficam mais rápidas.
export function computeItemDurationDays(
  item: LineItemNode,
  hoursCache: Map<string, number>,
  maxCrewSize: number = DEFAULT_MAX_CREW_SIZE,
): { days: number; basis: "horas" | "valor" | "minimo" } {
  if (item.compositionId && item.quantity) {
    const hoursPerUnit = hoursCache.get(item.compositionId) ?? 0;
    const totalHours = hoursPerUnit * item.quantity;
    if (totalHours > 0) {
      const crewSize = Math.max(1, Math.min(maxCrewSize, Math.round(Math.sqrt(totalHours / HOURS_PER_WORKING_DAY))));
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
  // Fracção do valor de refCode que esta tarefa representa (ver comentário em scheduleTasks no
  // schema). Só < 1 quando o mesmo item do mapa é repartido por vários pisos.
  valueShare?: number;
  // Código real do item do mapa a usar para ir buscar o valor orçamentado/executado — quando
  // omitido, usa-se node.code (comportamento normal). Uma tarefa sintética (ex: "Pilares — Piso
  // 1") tem node.code a null (para ganhar uma numeração WBS própria e legível) mas refCode
  // continua a apontar ao código real do mapa, para o valor nunca se perder.
  refCode?: string | null;
};

// Calcula a duração de cada nó da árvore de baixo para cima: um item (pacote de trabalho) tem
// duração própria, calculada do seu conteúdo real; um capítulo/grupo é sempre a SOMA das suas
// subactividades (encadeadas em sequência), nunca um número inventado ao nível do capítulo. Isto
// substitui o desenho anterior (repartir proporcionalmente um total pré-calculado), que perdia
// detalhe e produzia números pouco realistas para pacotes de trabalho individuais.
export function computeNodeDurations(node: LineItemNode, hoursCache: Map<string, number>, maxCrewSize: number = DEFAULT_MAX_CREW_SIZE): ScheduledNode | null {
  if (node.kind === "nota") return null;
  if (node.kind === "item") {
    const { days, basis } = computeItemDurationDays(node, hoursCache, maxCrewSize);
    return { node, durationDays: days, basis, children: [] };
  }
  const children = node.children.map((child) => computeNodeDurations(child, hoursCache, maxCrewSize)).filter((c): c is ScheduledNode => c !== null);
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
  const budgetChapterCode = node.refCode !== undefined ? node.refCode : code;
  const endDate = addWorkingDays(startDate, node.durationDays - 1);
  const [task] = await db.insert(scheduleTasks).values({
    projectId: args.projectId,
    parentId,
    budgetDocumentId: args.budgetDocumentId,
    code,
    name: node.node.description,
    budgetChapterCode,
    startDate,
    endDate,
    baselineStartDate: startDate,
    baselineEndDate: endDate,
    durationDays: node.durationDays,
    valueShare: String(node.valueShare ?? 1),
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

function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Divide um total de dias em N partes cuja SOMA = total (nunca inflacionar).
// Devolve null se não há dias suficientes para repartir sem inventar duração.
function splitEvenly(total: number, parts: number): number[] | null {
  const safeParts = Math.max(1, Math.round(parts));
  const safeTotal = Math.max(0, Math.round(total));
  if (safeTotal < safeParts) return null;
  const base = Math.floor(safeTotal / safeParts);
  const remainder = safeTotal - base * safeParts;
  return Array.from({ length: safeParts }, (_, i) => base + (i < remainder ? 1 : 0));
}

type StructuralStage = "limpeza" | "sapatas" | "pilares" | "vigas" | "lajes" | "apoio";

// Reconhece o papel de um item de "Betões, Aços e Cofragens" pela descrição.
function classifyStructuralLeaf(description: string): StructuralStage | null {
  const d = normalizeText(description);
  if (d.includes("limpeza") && d.includes("bet")) return "limpeza";
  if (d.includes("sapata")) return "sapatas";
  // "apoio" só se não for claramente um elemento estrutural (ex.: "aço em pilares").
  if ((d.includes("aco") || d.includes("malhasol") || d.includes("malha") || d.includes("cofragem"))
    && !d.includes("pilar") && !d.includes("viga") && !d.includes("laje") && !d.includes("sapata")) {
    return "apoio";
  }
  if (d.includes("pilar")) return "pilares";
  if (d.includes("viga") || d.includes("lintel") || d.includes("linteis")) return "vigas";
  if (d.includes("laje")) return "lajes";
  if (d.includes("aco") || d.includes("malhasol") || d.includes("malha") || d.includes("cofragem")) return "apoio";
  return null;
}

function relabelLeaf(source: ScheduledNode, description: string, durationDays: number, valueShare: number): ScheduledNode {
  return {
    node: { ...source.node, description, code: null },
    durationDays: Math.max(1, Math.round(durationDays)),
    basis: source.basis,
    children: [],
    valueShare,
    refCode: source.node.code,
  };
}

function makeGroup(source: ScheduledNode, description: string, children: ScheduledNode[]): ScheduledNode {
  return {
    node: { ...source.node, description, code: null },
    durationDays: children.reduce((sum, c) => sum + c.durationDays, 0) || 1,
    basis: "soma",
    children,
    refCode: source.node.code,
  };
}

function withReorderedChildren(root: ScheduledNode, children: ScheduledNode[]): ScheduledNode {
  return {
    ...root,
    children,
    durationDays: children.reduce((sum, c) => sum + c.durationDays, 0) || 1,
    basis: "soma",
  };
}

function classifyStructuralChildren(root: ScheduledNode): Record<StructuralStage, ScheduledNode[]> | null {
  const stage: Record<StructuralStage, ScheduledNode[]> = { limpeza: [], sapatas: [], pilares: [], vigas: [], lajes: [], apoio: [] };
  for (const child of root.children) {
    if (child.children.length) return null;
    const key = classifyStructuralLeaf(child.node.description);
    if (!key) return null;
    stage[key].push(child);
  }
  if (!stage.pilares.length || !stage.vigas.length || !stage.lajes.length) return null;
  if (stage.limpeza.length > 1 || stage.sapatas.length > 1 || stage.pilares.length > 1 || stage.vigas.length > 1 || stage.lajes.length > 1) return null;
  return stage;
}

/** Ordem de execução sem inventar nomes — mantém as descrições do mapa. */
function reorderStructuralFlat(root: ScheduledNode): ScheduledNode | null {
  const stage = classifyStructuralChildren(root);
  if (!stage) return null;
  const ordered = [
    ...stage.limpeza,
    ...stage.sapatas,
    ...stage.apoio,
    ...stage.pilares,
    ...stage.vigas,
    ...stage.lajes,
  ];
  return withReorderedChildren(root, ordered);
}

/**
 * Em edifícios multi-piso: estrutura piso a piso.
 * Mantém a descrição do mapa + sufixo "— Piso N" (sem renomear para rótulos inventados).
 * Só aplica se cada etapa tiver dias suficientes para não inflacionar a duração.
 */
function buildFloorAwareStructuralPlan(root: ScheduledNode, floors: number): ScheduledNode | null {
  const floorCount = Math.max(1, Math.min(20, Math.round(floors)));
  if (floorCount <= 1) return reorderStructuralFlat(root);

  const stage = classifyStructuralChildren(root);
  if (!stage) return null;

  const sum = (nodes: ScheduledNode[]) => nodes.reduce((s, n) => s + n.durationDays, 0);
  const pilaresPerFloor = splitEvenly(sum(stage.pilares), floorCount);
  const vigasPerFloor = splitEvenly(sum(stage.vigas), floorCount);
  const lajesPerFloor = splitEvenly(sum(stage.lajes), floorCount);
  if (!pilaresPerFloor || !vigasPerFloor || !lajesPerFloor) return reorderStructuralFlat(root);

  const apoioPerFloorByItem: number[][] = [];
  for (const item of stage.apoio) {
    const split = splitEvenly(item.durationDays, floorCount);
    if (!split) return reorderStructuralFlat(root);
    apoioPerFloorByItem.push(split);
  }

  const floorGroups: ScheduledNode[] = [];
  for (let floor = 0; floor < floorCount; floor++) {
    const children: ScheduledNode[] = [];
    if (floor === 0) {
      for (const n of stage.limpeza) children.push(n);
      for (const n of stage.sapatas) children.push(n);
    }
    stage.apoio.forEach((apoioSource, apoioIndex) => {
      const perFloor = apoioPerFloorByItem[apoioIndex];
      const totalForItem = perFloor.reduce((a, b) => a + b, 0) || 1;
      children.push(relabelLeaf(
        apoioSource,
        `${apoioSource.node.description} — Piso ${floor}`,
        perFloor[floor],
        perFloor[floor] / totalForItem,
      ));
    });
    children.push(relabelLeaf(
      stage.pilares[0],
      `${stage.pilares[0].node.description} — Piso ${floor}`,
      pilaresPerFloor[floor],
      pilaresPerFloor[floor] / (pilaresPerFloor.reduce((a, b) => a + b, 0) || 1),
    ));
    children.push(relabelLeaf(
      stage.vigas[0],
      `${stage.vigas[0].node.description} — Piso ${floor}`,
      vigasPerFloor[floor],
      vigasPerFloor[floor] / (vigasPerFloor.reduce((a, b) => a + b, 0) || 1),
    ));
    children.push(relabelLeaf(
      stage.lajes[0],
      `${stage.lajes[0].node.description} — Piso ${floor}`,
      lajesPerFloor[floor],
      lajesPerFloor[floor] / (lajesPerFloor.reduce((a, b) => a + b, 0) || 1),
    ));
    floorGroups.push(makeGroup(root, `Estrutura — Piso ${floor}`, children));
  }
  return withReorderedChildren(root, floorGroups);
}

function buildFloorAwareWallsPlan(root: ScheduledNode, floors: number): ScheduledNode | null {
  const floorCount = Math.max(1, Math.min(20, Math.round(floors)));
  if (floorCount <= 1) return null;
  const leaves = root.children.filter((c) => !c.children.length);
  if (leaves.length !== root.children.length || !leaves.length) return null;

  const totalPerLeaf: number[][] = [];
  for (const leaf of leaves) {
    const split = splitEvenly(leaf.durationDays, floorCount);
    if (!split) return null;
    totalPerLeaf.push(split);
  }

  const floorGroups: ScheduledNode[] = [];
  for (let floor = 0; floor < floorCount; floor++) {
    const children = leaves.map((leaf, leafIndex) =>
      relabelLeaf(
        leaf,
        `${leaf.node.description} — Piso ${floor}`,
        totalPerLeaf[leafIndex][floor],
        totalPerLeaf[leafIndex][floor] / (totalPerLeaf[leafIndex].reduce((a, b) => a + b, 0) || 1),
      ),
    );
    floorGroups.push(makeGroup(root, `Alvenarias — Piso ${floor}`, children));
  }
  return withReorderedChildren(root, floorGroups);
}

/**
 * Afina um capítulo sem inventar WBS falsa.
 * - Estrutura: reordena (ou reparte por piso se floors>1 e houver dias suficientes)
 * - Alvenarias: reparte por piso só com floors>1
 * - Restantes capítulos: mantém exactamente a árvore do mapa
 */
function refineChapterForSchedule(root: ScheduledNode, floors: number): ScheduledNode {
  const name = normalizeText(root.node.description);
  if (name.includes("betoe") || name.includes("acos e cofrage") || (name.includes("aco") && name.includes("cofragem"))) {
    return buildFloorAwareStructuralPlan(root, floors) ?? root;
  }
  if (name.includes("alvenaria")) {
    return buildFloorAwareWallsPlan(root, floors) ?? root;
  }
  return root;
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
  // Trabalhadores disponíveis por frente de trabalho — quanto maior, mais rápido ficam prontos
  // os pacotes de trabalho que já "pedem" uma equipa grande (nunca inventa equipa numa tarefa
  // pequena; ver computeItemDurationDays). Por omissão 12 — igual ao comportamento anterior.
  maxCrewSize?: number;
}) {
  const summary = await getBudgetDocumentSummary(args.budgetDocumentId);
  if (!summary) throw new Error("Mapa de Quantidades não encontrado");
  const roots = collectScheduleRoots(summary);
  if (!roots.length) throw new Error("O Mapa de Quantidades ainda não tem capítulos para gerar a WBS");

  const hoursCache = new Map<string, number>();
  for (const root of roots) await buildLabourHoursPerUnitCache(root, args.companyId ?? null, args.zoneId ?? null, hoursCache);

  const maxCrewSize = Math.max(1, Math.min(60, Math.round(args.maxCrewSize ?? DEFAULT_MAX_CREW_SIZE)));
  let scheduledRoots = roots
    .map((root) => computeNodeDurations(root, hoursCache, maxCrewSize))
    .filter((node): node is ScheduledNode => node !== null);
  if (!scheduledRoots.length) throw new Error("O Mapa de Quantidades ainda não tem itens medidos para gerar a WBS");

  // Princípio: WBS = árvore do mapa. Só se afina estrutura/alvenaria (ordem e pisos).
  // Nunca inventar fases por palavras-chave nem reescrever datas fora da ordem do BOQ.
  const [project] = await db.select({ floors: projects.floors }).from(projects).where(eq(projects.id, args.projectId)).limit(1);
  const floors = project?.floors ?? 1;
  scheduledRoots = scheduledRoots.map((root) => refineChapterForSchedule(root, floors));

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

  // Capítulos na ordem do mapa, encadeados FS (Finish-to-Start) — sequência previsível e auditável.
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
    // valueShare < 1 quando o gerador dividiu este item do mapa por vários pisos — cada
    // fracção reclama só a sua parte do valor real, nunca o valor inteiro do item várias vezes.
    const valueShare = Number(task.valueShare ?? 1);
    const plannedValue = (root?.totalPrice ?? 0) * valueShare;
    const certificate = task.budgetDocumentId ? latestByDocument.get(task.budgetDocumentId) : null;
    const executedValue = certificate && task.budgetChapterCode
      ? measured
          .filter((line) => line.certificateId === certificate.id && (line.code === task.budgetChapterCode || line.code?.startsWith(`${task.budgetChapterCode}.`)))
          .reduce((sum, line) => sum + Number(line.qty) * Number(line.unitPrice ?? 0), 0) * valueShare
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
  const byId = new Map(baseEnriched.map((task) => [task.id, task]));
  for (const task of baseEnriched) {
    if (!task.parentId) continue;
    const children = childrenByParent.get(task.parentId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentId, children);
  }
  for (const [, children] of childrenByParent) {
    children.sort((a, b) => a.sortOrder - b.sortOrder);
  }

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

  // Roll-up de baixo para cima (netos → pais → avós) — crítico com WBS multi-nível por piso.
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
    const summary: EnrichedTask = {
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
    rolled.set(taskId, summary);
    return summary;
  }

  for (const task of baseEnriched) rollup(task.id);

  function walk(taskId: string): EnrichedTask[] {
    const task = rolled.get(taskId)!;
    const kids = childrenByParent.get(taskId) ?? [];
    return [task, ...kids.flatMap((child) => walk(child.id))];
  }

  const roots = baseEnriched.filter((task) => !task.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const orderedEnriched = roots.flatMap((root) => walk(root.id));
  // Os totais usam apenas o primeiro nível: cada actividade principal já agrega as suas
  // subactividades. Assim, uma WBS detalhada nunca duplica o valor do orçamento.
  const topLevelTasks = roots.map((root) => rolled.get(root.id)!);
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

// Depois de uma tarefa mudar de datas (edição directa, ou porque a própria predecessora dela
// mudou), recalcula em cascata todas as tarefas que dependem dela — sem isto, mudar o início de
// uma predecessora deixava as sucessoras "penduradas" nas datas antigas, mesmo com FS/SS/FF/SF
// e folga configurados. `visited` evita voltar a processar a mesma tarefa (defesa extra, já que
// validateTaskDependency impede ciclos na origem).
export async function cascadeSuccessorDates(taskId: string, visited: Set<string> = new Set()): Promise<void> {
  if (visited.has(taskId)) return;
  visited.add(taskId);
  const [task] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, taskId)).limit(1);
  if (!task) return;
  const successorDeps = await db.select().from(scheduleDependencies).where(eq(scheduleDependencies.predecessorTaskId, taskId));
  for (const dependency of successorDeps) {
    const [successor] = await db.select().from(scheduleTasks).where(eq(scheduleTasks.id, dependency.successorTaskId)).limit(1);
    if (!successor) continue;
    const { startDate, endDate } = computeSuccessorDates(task, dependency.type, dependency.lagDays, successor.durationDays);
    if (startDate !== successor.startDate || endDate !== successor.endDate) {
      await db.update(scheduleTasks).set({ startDate, endDate, updatedAt: new Date() }).where(eq(scheduleTasks.id, successor.id));
    }
    await cascadeSuccessorDates(successor.id, visited);
  }
}

