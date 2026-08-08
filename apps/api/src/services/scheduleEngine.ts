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
import { mapToPhase, type PhaseKey } from "./phaseMapping.js";

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

// Divide um total de dias em N partes o mais iguais possível, sem nenhuma parte cair a 0.
function splitEvenly(total: number, parts: number): number[] {
  const safeParts = Math.max(1, Math.round(parts));
  const base = Math.floor(total / safeParts);
  const remainder = total - base * safeParts;
  return Array.from({ length: safeParts }, (_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));
}

type StructuralStage = "limpeza" | "sapatas" | "pilares" | "vigas" | "lajes" | "apoio";

// Reconhece o papel de um item de "Betões, Aços e Cofragens" pela descrição (estável mesmo
// quando o código do item muda) — permite reordenar/repartir por piso sem depender de que o
// utilizador tenha usado exactamente os códigos 3.1..3.8 do modelo SIGO.
function classifyStructuralLeaf(description: string): StructuralStage | null {
  const d = normalizeText(description);
  if (d.includes("limpeza") && d.includes("bet")) return "limpeza";
  if (d.includes("sapata")) return "sapatas";
  if (d.includes("aco") || d.includes("malhasol") || d.includes("malha") || d.includes("cofragem")) return "apoio";
  if (d.includes("pilar")) return "pilares";
  if (d.includes("viga") || d.includes("lintel") || d.includes("linteis")) return "vigas";
  if (d.includes("laje")) return "lajes";
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

// Reordena e, quando a edificação tem mais de um piso, repete a estrutura (Betões/Aços/
// Cofragens) piso a piso — sequência real de obra: limpeza → sapatas → arranque dos pilares →
// viga de fundação → laje de pavimento (térreo); depois, por cada piso seguinte: pilares → viga/
// cinta → laje, terminando em "laje de cobertura" no último piso. Devolve null quando o capítulo
// não tem os itens mínimos reconhecíveis (pilares, vigas e lajes) — nesse caso o chamador mantém
// o comportamento genérico anterior, sem arriscar perder âmbito do mapa.
function buildFloorAwareStructuralPlan(root: ScheduledNode, floors: number): ScheduledNode | null {
  const stage: Record<StructuralStage, ScheduledNode[]> = { limpeza: [], sapatas: [], pilares: [], vigas: [], lajes: [], apoio: [] };
  for (const child of root.children) {
    if (child.children.length) return null;
    const key = classifyStructuralLeaf(child.node.description);
    if (!key) return null;
    stage[key].push(child);
  }
  if (!stage.pilares.length || !stage.vigas.length || !stage.lajes.length) return null;
  // Só sabemos repartir um item por piso — se o mapa tiver mais do que um item por etapa (ex:
  // duas linhas de "pilares"), não arriscamos perder o valor de nenhuma; mantém-se o genérico.
  if (stage.limpeza.length > 1 || stage.sapatas.length > 1 || stage.pilares.length > 1 || stage.vigas.length > 1 || stage.lajes.length > 1) return null;

  const sum = (nodes: ScheduledNode[]) => nodes.reduce((s, n) => s + n.durationDays, 0);
  const floorCount = Math.max(1, Math.min(20, Math.round(floors)));
  const pilaresPerFloor = splitEvenly(sum(stage.pilares), floorCount);
  const vigasPerFloor = splitEvenly(sum(stage.vigas), floorCount);
  const lajesPerFloor = splitEvenly(sum(stage.lajes), floorCount);
  // Cada item de apoio (aço, malhasol, cofragem...) é repartido pela SUA PRÓPRIA duração — nunca
  // pela soma de todos, senão cada item ficaria com a duração combinada dos outros também.
  const apoioPerFloorByItem = stage.apoio.map((item) => splitEvenly(item.durationDays, floorCount));

  const floorGroups: ScheduledNode[] = [];
  for (let floor = 0; floor < floorCount; floor++) {
    const isGround = floor === 0;
    const isTop = floor === floorCount - 1;
    const children: ScheduledNode[] = [];
    const source = stage.pilares[0];

    if (isGround) {
      if (stage.limpeza.length) children.push(relabelLeaf(stage.limpeza[0], "Betão de limpeza", sum(stage.limpeza), 1));
      if (stage.sapatas.length) children.push(relabelLeaf(stage.sapatas[0], "Sapatas de fundação", sum(stage.sapatas), 1));
    }
    // Cofragem/aço primeiro (preparação), depois betonagem — ordem real de obra no piso.
    stage.apoio.forEach((apoioSource, apoioIndex) => {
      const perFloor = apoioPerFloorByItem[apoioIndex];
      const totalForItem = perFloor.reduce((a, b) => a + b, 0) || 1;
      children.push(relabelLeaf(
        apoioSource,
        `${apoioSource.node.description}${floorCount > 1 ? ` — Piso ${floor}` : ""}`,
        perFloor[floor],
        perFloor[floor] / totalForItem,
      ));
    });
    children.push(relabelLeaf(
      source,
      isGround ? "Arranque dos pilares" : floorCount > 1 ? `Pilares — Piso ${floor}` : "Pilares",
      pilaresPerFloor[floor],
      pilaresPerFloor[floor] / (pilaresPerFloor.reduce((a, b) => a + b, 0) || 1),
    ));
    children.push(relabelLeaf(
      stage.vigas[0],
      isGround ? "Viga de fundação" : floorCount > 1 ? `Viga/cinta — Piso ${floor}` : "Vigas e lintéis",
      vigasPerFloor[floor],
      vigasPerFloor[floor] / (vigasPerFloor.reduce((a, b) => a + b, 0) || 1),
    ));
    children.push(relabelLeaf(
      stage.lajes[0],
      isGround && floorCount === 1 ? "Laje de pavimento" : isGround ? "Laje de pavimento térreo" : isTop ? "Laje de cobertura" : `Laje — Piso ${floor}`,
      lajesPerFloor[floor],
      lajesPerFloor[floor] / (lajesPerFloor.reduce((a, b) => a + b, 0) || 1),
    ));
    const label = floorCount > 1 ? `Estrutura — Piso ${floor}` : "Estrutura";
    floorGroups.push(makeGroup(root, label, children));
  }
  return makeGroup(root, root.node.description, floorGroups);
}

// Mesma lógica de repetição por piso para Alvenarias — paredes de cada piso só fazem sentido
// depois da estrutura desse piso estar de pé, por isso seguem a mesma ordem "térreo primeiro".
function buildFloorAwareWallsPlan(root: ScheduledNode, floors: number): ScheduledNode | null {
  const floorCount = Math.max(1, Math.min(20, Math.round(floors)));
  if (floorCount <= 1) return null;
  const leaves = root.children.filter((c) => !c.children.length);
  if (leaves.length !== root.children.length || !leaves.length) return null;

  const totalPerLeaf = leaves.map((leaf) => splitEvenly(leaf.durationDays, floorCount));
  const floorGroups: ScheduledNode[] = [];
  for (let floor = 0; floor < floorCount; floor++) {
    const children = leaves.map((leaf, leafIndex) =>
      relabelLeaf(leaf, `${leaf.node.description} — Piso ${floor}`, totalPerLeaf[leafIndex][floor], totalPerLeaf[leafIndex][floor] / (totalPerLeaf[leafIndex].reduce((a, b) => a + b, 0) || 1)),
    );
    floorGroups.push(makeGroup(root, `Alvenarias — Piso ${floor}`, children));
  }
  return makeGroup(root, root.node.description, floorGroups);
}

/** Repete folhas planas por piso (rebocos, revestimentos, pinturas…). */
function buildFloorAwareFinishesPlan(root: ScheduledNode, floors: number, groupPrefix: string): ScheduledNode | null {
  const floorCount = Math.max(1, Math.min(20, Math.round(floors)));
  if (floorCount <= 1) return null;
  const leaves = collectFlatLeaves(root);
  if (!leaves.length) return null;
  // Só aplica quando o capítulo é "plano" (filhos = folhas) ou só tem um nível de grupos a achatar.
  if (root.children.some((c) => c.children.some((g) => g.children.length))) return null;

  const flatLeaves = leaves;
  const totalPerLeaf = flatLeaves.map((leaf) => splitEvenly(leaf.durationDays, floorCount));
  const floorGroups: ScheduledNode[] = [];
  for (let floor = 0; floor < floorCount; floor++) {
    const children = flatLeaves.map((leaf, leafIndex) =>
      relabelLeaf(
        leaf,
        `${leaf.node.description} — Piso ${floor}`,
        totalPerLeaf[leafIndex][floor],
        totalPerLeaf[leafIndex][floor] / (totalPerLeaf[leafIndex].reduce((a, b) => a + b, 0) || 1),
      ),
    );
    floorGroups.push(makeGroup(root, `${groupPrefix} — Piso ${floor}`, children));
  }
  return makeGroup(root, root.node.description, floorGroups);
}

function collectFlatLeaves(node: ScheduledNode): ScheduledNode[] {
  if (!node.children.length) return [node];
  return node.children.flatMap((child) => collectFlatLeaves(child));
}

/** Reordena folhas por prioridade de palavras-chave (sequência de obra), agrupando reconhecíveis. */
function reorderLeavesByKeywords(root: ScheduledNode, stages: Array<{ label: string; keywords: string[] }>): ScheduledNode | null {
  const leaves = root.children.filter((c) => !c.children.length);
  if (!leaves.length || leaves.length !== root.children.length) return null;

  const used = new Set<string>();
  const groups: ScheduledNode[] = [];
  for (const stage of stages) {
    const matched = leaves.filter((leaf) => {
      if (used.has(leaf.node.id)) return false;
      const text = normalizeText(leaf.node.description);
      return stage.keywords.some((k) => text.includes(normalizeText(k)));
    });
    if (!matched.length) continue;
    matched.forEach((m) => used.add(m.node.id));
    if (matched.length === 1) groups.push({ ...matched[0], node: { ...matched[0].node, description: `${stage.label}: ${matched[0].node.description}` } });
    else groups.push(makeGroup(root, stage.label, matched));
  }
  const rest = leaves.filter((leaf) => !used.has(leaf.node.id));
  if (!groups.length) return null;
  return makeGroup(root, root.node.description, [...groups, ...rest]);
}

function applyChapterConstructionPlan(root: ScheduledNode, floors: number): ScheduledNode {
  const name = normalizeText(root.node.description);
  if (name.includes("betoe") || name.includes("acos e cofrage") || (name.includes("aco") && name.includes("cofragem"))) {
    return buildFloorAwareStructuralPlan(root, floors) ?? reorderLeavesByKeywords(root, [
      { label: "Fundações", keywords: ["limpeza", "sapata", "fundac"] },
      { label: "Pilares", keywords: ["pilar"] },
      { label: "Vigas e lintéis", keywords: ["viga", "lintel", "linteis"] },
      { label: "Lajes", keywords: ["laje"] },
      { label: "Aço e cofragem", keywords: ["aco", "malha", "cofragem"] },
    ]) ?? root;
  }
  if (name.includes("alvenaria")) {
    return buildFloorAwareWallsPlan(root, floors)
      ?? reorderLeavesByKeywords(root, [
        { label: "Paredes exteriores", keywords: ["exterior", "fachada"] },
        { label: "Paredes interiores", keywords: ["interior", "divis"] },
        { label: "Cintas e reforços", keywords: ["cinta", "lintel", "verga"] },
      ])
      ?? root;
  }
  if (name.includes("movimento") || name.includes("terra") || name.includes("terraplen")) {
    return reorderLeavesByKeywords(root, [
      { label: "Limpeza do terreno", keywords: ["limpeza", "desmat", "regulariz"] },
      { label: "Escavação", keywords: ["escav"] },
      { label: "Aterros e compactação", keywords: ["aterro", "compact", "enchimento"] },
      { label: "Drenagem provisória", keywords: ["drenagem", "esgot"] },
    ]) ?? root;
  }
  if (name.includes("preliminar") || name.includes("estaleiro") || name.includes("instalacao de estaleiro")) {
    return reorderLeavesByKeywords(root, [
      { label: "Implantação e demolições", keywords: ["implant", "demoli", "vedacao", "tapume"] },
      { label: "Estaleiro e logística", keywords: ["estaleiro", "armazem", "sanitario", "electricidade provis"] },
      { label: "Replanteio", keywords: ["replanteio", "piquet", "marcacao"] },
    ]) ?? root;
  }
  if (name.includes("betonilha") || name.includes("reboco")) {
    return buildFloorAwareFinishesPlan(root, floors, "Rebocos e betonilhas")
      ?? reorderLeavesByKeywords(root, [
        { label: "Betonilhas", keywords: ["betonilha"] },
        { label: "Rebocos", keywords: ["reboco"] },
      ])
      ?? root;
  }
  if (name.includes("revestimento") || name.includes("pavimento") || name.includes("rodape")) {
    return buildFloorAwareFinishesPlan(root, floors, "Revestimentos")
      ?? reorderLeavesByKeywords(root, [
        { label: "Pavimentos", keywords: ["piso", "pavimento", "ceramica chao", "lajeta"] },
        { label: "Paredes", keywords: ["azulejo", "parede", "revest"] },
        { label: "Rodapés e remates", keywords: ["rodape", "remate"] },
      ])
      ?? root;
  }
  if (name.includes("pintura")) {
    return buildFloorAwareFinishesPlan(root, floors, "Pinturas")
      ?? reorderLeavesByKeywords(root, [
        { label: "Preparação", keywords: ["prepar", "massa", "lixag", "primario"] },
        { label: "Interiores", keywords: ["interior", "teto", "tecto"] },
        { label: "Exteriores", keywords: ["exterior", "fachada"] },
      ])
      ?? root;
  }
  if (name.includes("cobertura")) {
    return reorderLeavesByKeywords(root, [
      { label: "Estrutura de cobertura", keywords: ["asna", "madre", "estrutura", "madeira", "metal"] },
      { label: "Impermeabilização", keywords: ["impermeab", "manta"] },
      { label: "Cobertura e remates", keywords: ["chapa", "telha", "cumeeira", "remate", "beiral"] },
    ]) ?? root;
  }
  if (name.includes("hidraul") || name.includes("saneamento") || name.includes("esgoto") || name.includes("pluvial")) {
    return reorderLeavesByKeywords(root, [
      { label: "Redes enterradas", keywords: ["enterrada", "coletor", "colector", "ramal"] },
      { label: "Distribuição de água", keywords: ["agua", "tubagem", "pcd", "ppr", "pressao"] },
      { label: "Drenagem e esgotos", keywords: ["esgoto", "drenagem", "pluvial", "caixa"] },
      { label: "Aparelhos e acessórios", keywords: ["sanit", "torneira", "lavatorio", "autoclismo", "duche", "pia"] },
    ]) ?? root;
  }
  if (name.includes("electric") || name.includes("eletric")) {
    return buildFloorAwareFinishesPlan(root, floors, "Instalações eléctricas")
      ?? reorderLeavesByKeywords(root, [
        { label: "Tubagem e cablagem", keywords: ["tubo", "cabo", "electroduto", "canaliz"] },
        { label: "Quadros e protecções", keywords: ["quadro", "disjuntor", "diferencial"] },
        { label: "Pontos de utilização", keywords: ["tomada", "interrup", "luminar", "ponto"] },
      ])
      ?? root;
  }
  if (name.includes("esquadri") || name.includes("portal") || name.includes("janela") || name.includes("serralh")) {
    return reorderLeavesByKeywords(root, [
      { label: "Caixilharias", keywords: ["janela", "caixilh", "aluminio", "pvc"] },
      { label: "Portas", keywords: ["porta", "portal"] },
      { label: "Protecções e gradis", keywords: ["grade", "protec", "guanicho"] },
    ]) ?? root;
  }
  return root;
}

const PHASE_RANK: Record<PhaseKey, number> = {
  mobilizacao: 0,
  terraplenagem_fundacoes: 1,
  estrutura: 2,
  alvenaria: 3,
  cobertura: 4,
  instalacoes: 4,
  revestimentos: 5,
  esquadrias: 5,
  acabamentos: 6,
  obras_exteriores: 6,
  entrega_garantia: 7,
  nao_classificado: 50,
};

function chapterPhaseRank(description: string): number {
  return PHASE_RANK[mapToPhase(description, [], "")] ?? 50;
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

  // Sequência real de obra por capítulo (fundações→estrutura por piso, redes antes de aparelhos,
  // acabamentos por piso, …). Capítulos sem padrões reconhecíveis mantêm a árvore do mapa.
  const [project] = await db.select({ floors: projects.floors }).from(projects).where(eq(projects.id, args.projectId)).limit(1);
  const floors = project?.floors ?? 1;
  scheduledRoots = scheduledRoots.map((root) => applyChapterConstructionPlan(root, floors));

  if (args.totalDurationDays) {
    const naturalTotal = scheduledRoots.reduce((sum, root) => sum + root.durationDays, 0) || 1;
    const factor = args.totalDurationDays / naturalTotal;
    scheduledRoots = scheduledRoots.map((root) => scaleScheduledTree(root, factor));
  }

  await db.delete(scheduleTasks).where(eq(scheduleTasks.projectId, args.projectId));
  const sortOrderRef = { value: 0 };
  const rootTasks: Array<typeof scheduleTasks.$inferSelect & { phaseRank: number }> = [];
  const dependencyValues: Array<typeof scheduleDependencies.$inferInsert> = [];

  // Capítulos na mesma fase de obra avançam em paralelo (SS); fases seguintes começam após a
  // fase anterior (FS). Alvenaria / instalações podem arrancar com avanço sobre a estrutura
  // (SS + lag), evitando o encadeamento ingénuo capítulo-a-capítulo que alongava a obra irrealisticamente.
  for (let index = 0; index < scheduledRoots.length; index += 1) {
    const root = scheduledRoots[index];
    const rank = chapterPhaseRank(root.node.description);
    const priorPhase = [...rootTasks].reverse().find((t) => t.phaseRank < rank);
    const samePhase = [...rootTasks].reverse().find((t) => t.phaseRank === rank);

    let startDate = args.startDate;
    let predecessor: (typeof rootTasks)[number] | undefined;
    let depType: "FS" | "SS" = "FS";
    let lagDays = 0;

    if (samePhase) {
      predecessor = samePhase;
      depType = "SS";
      lagDays = 0;
      startDate = samePhase.startDate;
    } else if (priorPhase) {
      predecessor = priorPhase;
      // Estrutura → alvenaria/instalações: começa depois de ~1/3 da estrutura (piso térreo tipicamente pronto).
      const earlyStart = (rank === 3 || rank === 4) && priorPhase.phaseRank === 2;
      if (earlyStart) {
        depType = "SS";
        lagDays = Math.max(1, Math.floor(priorPhase.durationDays * 0.35));
        startDate = shiftWorkingDays(priorPhase.startDate, lagDays);
      } else {
        depType = "FS";
        lagDays = 0;
        startDate = addWorkingDays(priorPhase.endDate, 1);
      }
    }

    const rootTask = await insertScheduledNode(root, args, null, String(index + 1), startDate, sortOrderRef, dependencyValues);
    if (predecessor) {
      dependencyValues.push({
        predecessorTaskId: predecessor.id,
        successorTaskId: rootTask.id,
        type: depType,
        lagDays,
      });
    }
    rootTasks.push({ ...rootTask, phaseRank: rank });
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

