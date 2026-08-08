import { DEFAULT_ASSUMED_FRONT_COUNT, DEFAULT_FALLBACK_CREW_SIZE, type PlanningContext, type PlanningTrade, type SchedulePlanningProfile } from "./schedulePlanningProfile.js";
import { executionActivityName } from "./scheduleActivityNames.js";

export type DurationBasis = "produtividade" | "horas" | "valor" | "minimo";
export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type PlanningSourceNode = {
  id: string;
  kind: "capitulo" | "grupo" | "item" | "nota";
  code: string | null;
  name: string;
  quantity: number | null;
  durationDays: number;
  durationBasis: DurationBasis | "soma";
  sortOrder: number;
  children: PlanningSourceNode[];
};

export type PlanningSourceSection = {
  id: string;
  name: string;
  sortOrder: number;
  templateKey: string | null;
  roots: PlanningSourceNode[];
};

export type PlanningWarning = {
  code:
    | "LONG_ACTIVITY"
    | "UNSPLIT_FLOOR_ACTIVITY"
    | "LOCATION_DURATION_MINIMUM"
    | "UNMAPPED_STANDARD_ITEM"
    | "GENERIC_STRUCTURAL_RESOURCE"
    | "UNIFORM_FLOOR_DISTRIBUTION"
    | "IMPORTED_SCOPE_PRESERVED"
    | "CUSTOM_BOQ_HIERARCHY_PRESERVED"
    | "TARGET_DURATION_UNREACHABLE"
    | "CREW_SIZE_DEFAULT"
    | "FRONT_COUNT_DEFAULT"
    | "FRONT_CAPACITY_APPLIED"
    | "PROFILE_SCOPE_FALLBACK"
    | "PHYSICAL_SCOPE_FROM_PLANTS"
    | "PHYSICAL_SCOPE_FALLBACK";
  message: string;
  sourceCode?: string | null;
  activityName?: string;
};

export type SchedulePhysicalElement = {
  key: string;
  label: string;
  floorLabel: string | null;
  /** Peso relativo para repartir uma linha agregada sem alterar o total do BOQ. */
  weight: number;
};

export type SchedulePhysicalContext = {
  source: "plants" | "measurements" | "budget";
  footings: SchedulePhysicalElement[];
  slabs: SchedulePhysicalElement[];
  rooms: SchedulePhysicalElement[];
};

export type PlannedNode = {
  key: string;
  wbsCode: string;
  name: string;
  kind: "summary" | "activity";
  sourceLineItemId: string | null;
  sourceCode: string | null;
  valueShare: number;
  durationDays: number;
  durationBasis: DurationBasis | "soma";
  floorIndex: number | null;
  zoneId: string | null;
  zoneLabel: string | null;
  allocationBasis: "boq" | "informado" | "assumido";
  executionStage: string;
  children: PlannedNode[];
  startDate: string;
  endDate: string;
  sortOrder: number;
};

export type PlannedDependency = {
  predecessorKey: string;
  successorKey: string;
  type: DependencyType;
  lagDays: number;
};

export type ExecutionPlan = {
  roots: PlannedNode[];
  dependencies: PlannedDependency[];
  warnings: PlanningWarning[];
  roofKind: "sheet" | "slab" | "unknown";
  startDate: string;
  endDate: string;
  /** Prazo do grafo antes de qualquer ajuste ao prazo contratual. */
  naturalDurationDays: number;
  /** Prazo contratual pedido, quando existe. */
  targetDurationDays: number | null;
  durationDays: number;
  assumptions: string[];
};

const DAY_MS = 86_400_000;
// Lags em DIAS ÚTEIS (calendário segunda–sábado). São restrições de cura/ganho inicial de
// resistência, não tarefas fictícias: não têm quantidade nem valor próprio no BOQ.
export const DEFAULT_FOUNDATION_CURE_LAG_DAYS = 2;
export const DEFAULT_COLUMN_CURE_LAG_DAYS = 1;
export const DEFAULT_SLAB_CURE_LAG_DAYS = 6;

const PLANNING_TRADE_LABELS: Record<PlanningTrade, string> = {
  earthworks: "Movimentos de terra / fundações",
  structure: "Estrutura",
  masonry: "Alvenarias",
  mep: "Instalações",
  finishes: "Acabamentos",
  roofing: "Cobertura",
  external: "Trabalhos exteriores",
};

export function isWorkingDay(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;
}

export function shiftWorkingDays(date: string, days: number): string {
  if (days === 0) return date;
  const value = new Date(`${date}T00:00:00Z`);
  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    value.setUTCDate(value.getUTCDate() + step);
    if (value.getUTCDay() !== 0) remaining -= 1;
  }
  return value.toISOString().slice(0, 10);
}

export function addWorkingDays(date: string, days: number): string {
  return shiftWorkingDays(date, days);
}

export function workingDaysInclusive(startDate: string, endDate: string): number {
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  while (cursor <= end) {
    if (cursor.getUTCDay() !== 0) count += 1;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

export function computeSuccessorDates(
  predecessor: { startDate: string; endDate: string },
  type: DependencyType,
  lagDays: number,
  durationDays: number,
): { startDate: string; endDate: string } {
  const duration = Math.max(1, Math.round(durationDays));
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
  const startDate = shiftWorkingDays(predecessor.endDate, 1 + lagDays);
  return { startDate, endDate: addWorkingDays(startDate, duration - 1) };
}

type FloorScope = "project" | "floor" | "deck" | "roof" | "footing" | "room_wall";

export type StandardRule = {
  scope: FloorScope;
  stage:
    | "prelim"
    | "earth"
    | "foundation"
    | "structure"
    | "masonry"
    | "mep_rough"
    | "plaster"
    | "screed"
    | "finish"
    | "openings"
    | "paint"
    | "fixtures"
    | "roof"
    | "external";
};

// Regras semânticas EXPLÍCITAS do mapa padrão SIGO. A chave é o código contratual do template,
// nunca palavras da descrição. Um mapa importado sem template SIGO não entra neste catálogo.
export const STANDARD_RULES: Record<string, StandardRule> = {
  "1.1": { scope: "project", stage: "prelim" },
  "1.2": { scope: "project", stage: "prelim" },
  "1.3": { scope: "project", stage: "prelim" },
  "2.1": { scope: "footing", stage: "earth" },
  "2.2": { scope: "project", stage: "earth" },
  "2.3": { scope: "project", stage: "earth" },
  "2.4": { scope: "project", stage: "earth" },
  "2.5": { scope: "project", stage: "earth" },
  "3.1": { scope: "footing", stage: "foundation" },
  "3.2": { scope: "footing", stage: "foundation" },
  "3.3": { scope: "floor", stage: "structure" },
  "3.4": { scope: "floor", stage: "structure" },
  "3.5": { scope: "deck", stage: "structure" },
  "3.6": { scope: "floor", stage: "structure" },
  "3.7": { scope: "roof", stage: "structure" },
  "3.8": { scope: "floor", stage: "structure" },
  "4.1": { scope: "room_wall", stage: "masonry" },
  "4.2": { scope: "room_wall", stage: "masonry" },
  "5.1": { scope: "floor", stage: "screed" },
  "5.2": { scope: "floor", stage: "plaster" },
  "5.3": { scope: "floor", stage: "plaster" },
  "6.1": { scope: "floor", stage: "finish" },
  "6.2": { scope: "floor", stage: "finish" },
  "7.1": { scope: "floor", stage: "paint" },
  "7.2": { scope: "floor", stage: "paint" },
  "7.3": { scope: "floor", stage: "paint" },
  "8.1": { scope: "floor", stage: "mep_rough" },
  "8.2": { scope: "floor", stage: "mep_rough" },
  "8.3": { scope: "project", stage: "external" },
  "9.1": { scope: "project", stage: "roof" },
  "10.1": { scope: "roof", stage: "roof" },
  "10.2": { scope: "roof", stage: "roof" },
  "10.3": { scope: "roof", stage: "roof" },
  "11.1": { scope: "floor", stage: "fixtures" },
  "11.2": { scope: "floor", stage: "fixtures" },
  "11.3": { scope: "floor", stage: "fixtures" },
  "11.4": { scope: "floor", stage: "fixtures" },
  "11.5": { scope: "floor", stage: "fixtures" },
  "11.6": { scope: "floor", stage: "mep_rough" },
  "11.7": { scope: "project", stage: "fixtures" },
  "12.1": { scope: "project", stage: "external" },
  "12.2": { scope: "project", stage: "external" },
  "13.1": { scope: "project", stage: "fixtures" },
  "13.2": { scope: "floor", stage: "mep_rough" },
  "13.3": { scope: "floor", stage: "mep_rough" },
  "13.4": { scope: "project", stage: "external" },
  "15.1": { scope: "floor", stage: "openings" },
  "15.2": { scope: "floor", stage: "openings" },
  "15.3": { scope: "floor", stage: "openings" },
  "15.4": { scope: "floor", stage: "openings" },
};

export function planningTradeForCode(code: string | null): PlanningTrade | null {
  if (!code) return null;
  const rule = STANDARD_RULES[code];
  if (!rule) return null;
  if (rule.stage === "earth" || rule.stage === "prelim" || rule.stage === "foundation") return "earthworks";
  if (rule.stage === "structure") return "structure";
  if (rule.stage === "masonry") return "masonry";
  if (rule.stage === "mep_rough" || rule.stage === "fixtures") return "mep";
  if (rule.stage === "roof") return "roofing";
  if (rule.stage === "external") return "external";
  return "finishes";
}

const FLOOR_GROUP_LABELS: Record<string, string> = {
  "3": "Estrutura",
  "4": "Alvenarias",
  "5": "Rebocos e betonilhas",
  "6": "Revestimentos",
  "7": "Pinturas",
  "8": "Drenagem de esgotos",
  "11": "Instalação hidráulica",
  "13": "Instalações eléctricas",
  "15": "Esquadrias e vãos",
};

function isSigoTemplate(templateKey: string | null): boolean {
  return Boolean(templateKey?.startsWith("sigo_"));
}

function measuredLeaf(node: PlanningSourceNode): boolean {
  return node.kind === "item" && (node.quantity ?? 0) > 0;
}

function hasMeasuredDescendant(node: PlanningSourceNode): boolean {
  if (measuredLeaf(node)) return true;
  return node.children.some(hasMeasuredDescendant);
}

function flattenMeasuredLeaves(sections: PlanningSourceSection[]): PlanningSourceNode[] {
  const result: PlanningSourceNode[] = [];
  const walk = (node: PlanningSourceNode) => {
    if (measuredLeaf(node)) result.push(node);
    for (const child of node.children) walk(child);
  };
  for (const section of sections) for (const root of section.roots) walk(root);
  return result;
}

function allocateExactShares(parts: number): number[] {
  if (parts <= 1) return [1];
  const units = 10_000;
  const base = Math.floor(units / parts);
  const remainder = units - base * parts;
  return Array.from({ length: parts }, (_, i) => (base + (i < remainder ? 1 : 0)) / units);
}

function allocateDuration(totalDays: number, parts: number): number[] | null {
  return allocateDurationByShares(totalDays, Array.from({ length: parts }, () => 1 / Math.max(1, parts)));
}

function allocateDurationByShares(totalDays: number, shares: number[]): number[] | null {
  const total = Math.max(1, Math.round(totalDays));
  if (shares.length <= 1) return [total];
  // Cada pacote físico precisa de pelo menos um dia executável. Manter a actividade agregada
  // esconderia pisos/frentes reais; para edifícios altos é preferível explicitar todos os locais
  // e tornar visível o mínimo operacional aplicado.
  if (total < shares.length) return shares.map(() => 1);
  const positiveTotal = shares.reduce((sum, share) => sum + Math.max(0, share), 0) || 1;
  const normalized = shares.map((share) => Math.max(0, share) / positiveTotal);
  // Reserva pelo menos 1 dia por pacote e reparte o remanescente pelo método dos maiores restos.
  const remaining = total - shares.length;
  const quotas = normalized.map((share) => share * remaining);
  const extras = quotas.map(Math.floor);
  let leftover = remaining - extras.reduce((sum, value) => sum + value, 0);
  const ranking = quotas
    .map((quota, index) => ({ index, remainder: quota - Math.floor(quota) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < leftover; i++) extras[ranking[i % ranking.length].index] += 1;
  return extras.map((extra) => extra + 1);
}

function normalizeShares(values: number[] | null | undefined, parts: number): { shares: number[]; basis: "informado" | "assumido" } {
  if (values && values.length === parts && values.every((value) => Number.isFinite(value) && value >= 0)) {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total > 0) return { shares: values.map((value) => value / total), basis: "informado" };
  }
  return { shares: allocateExactShares(parts), basis: "assumido" };
}

function roofKindFromMeasuredCodes(leaves: PlanningSourceNode[]): "sheet" | "slab" | "unknown" {
  const positiveCodes = new Set(leaves.filter(measuredLeaf).map((leaf) => leaf.code).filter((code): code is string => Boolean(code)));
  if (positiveCodes.has("10.2")) return "sheet";
  // 3.7 é Malhasol de cobertura no template padrão (o Quick Estimate só o mede em cobertura plana).
  if (positiveCodes.has("10.1") || positiveCodes.has("3.7")) return "slab";
  return "unknown";
}

export function defaultFloorLabels(floorsInput: number): string[] {
  const floors = Math.max(1, Math.min(20, Math.round(floorsInput)));
  return Array.from({ length: floors }, (_, index) => index === 0 ? "Piso térreo" : `Piso ${index}`);
}

export function buildPlanningContext(sections: PlanningSourceSection[], floorsInput: number, detectedFloorLabels?: string[]): PlanningContext {
  const floors = Math.max(1, Math.min(20, Math.round(floorsInput)));
  const leaves = flattenMeasuredLeaves(sections);
  const measuredSections = sections.filter((section) => section.roots.some(hasMeasuredDescendant));
  const hasSigoTemplate = measuredSections.some((section) => isSigoTemplate(section.templateKey));
  const hasImportedScope = measuredSections.some((section) => !isSigoTemplate(section.templateKey));
  const standardHierarchySafe = measuredSections
    .filter((section) => isSigoTemplate(section.templateKey))
    .every((section) => section.roots.every((root) => !hasMeasuredDescendant(root) || (root.kind === "capitulo" && !root.children.some((child) => child.kind === "grupo"))));
  const supportsFloorPlanning = measuredSections.length > 0 && !hasImportedScope && hasSigoTemplate && standardHierarchySafe;
  const rules = leaves
    .map((leaf) => leaf.code ? STANDARD_RULES[leaf.code] : undefined)
    .filter((rule): rule is StandardRule => Boolean(rule));
  const trades = new Set(leaves.map((leaf) => planningTradeForCode(leaf.code)).filter((trade): trade is PlanningTrade => Boolean(trade)));
  const aggregatedFloorCodes = leaves
    .filter((leaf) => leaf.code && ["floor", "deck"].includes(STANDARD_RULES[leaf.code]?.scope ?? ""))
    .map((leaf) => leaf.code!)
    .filter((code, index, allCodes) => allCodes.indexOf(code) === index);
  const aggregatedStructuralCodes = ["3.6", "3.8"].filter((code) => leaves.some((leaf) => leaf.code === code));
  return {
    floors,
    floorLabels: detectedFloorLabels?.length === floors ? detectedFloorLabels : defaultFloorLabels(floors),
    measuredItemCount: leaves.length,
    hasSigoTemplate,
    hasImportedScope,
    supportsFloorPlanning,
    detectedRoofKind: roofKindFromMeasuredCodes(leaves),
    hasStructure: trades.has("structure") || rules.some((rule) => rule.stage === "foundation"),
    hasMasonry: trades.has("masonry"),
    hasMep: trades.has("mep"),
    hasFinishes: trades.has("finishes"),
    hasRoof: trades.has("roofing") || rules.some((rule) => rule.scope === "roof"),
    hasExternal: trades.has("external"),
    activeTrades: [...trades],
    aggregatedFloorCodes,
    aggregatedStructuralCodes,
  };
}

function makeActivity(
  source: PlanningSourceNode,
  key: string,
  name: string,
  durationDays: number,
  valueShare: number,
  floorIndex: number | null,
  options: { zoneId?: string | null; zoneLabel?: string | null; allocationBasis?: "boq" | "informado" | "assumido"; executionStage?: string } = {},
): PlannedNode {
  return {
    key,
    wbsCode: "",
    name,
    kind: "activity",
    sourceLineItemId: source.id,
    sourceCode: source.code,
    valueShare,
    durationDays: Math.max(1, Math.round(durationDays)),
    durationBasis: source.durationBasis === "soma" ? "minimo" : source.durationBasis,
    floorIndex,
    zoneId: options.zoneId ?? null,
    zoneLabel: options.zoneLabel ?? null,
    allocationBasis: options.allocationBasis ?? "boq",
    executionStage: options.executionStage ?? (source.code ? STANDARD_RULES[source.code]?.stage ?? "boq" : "boq"),
    children: [],
    startDate: "",
    endDate: "",
    sortOrder: 0,
  };
}

function makeSummary(key: string, name: string, source: PlanningSourceNode | null, children: PlannedNode[]): PlannedNode {
  return {
    key,
    wbsCode: "",
    name,
    kind: "summary",
    sourceLineItemId: source?.id ?? null,
    sourceCode: source?.code ?? null,
    valueShare: 1,
    durationDays: 1,
    durationBasis: "soma",
    floorIndex: null,
    zoneId: null,
    zoneLabel: null,
    allocationBasis: "boq",
    executionStage: "summary",
    children,
    startDate: "",
    endDate: "",
    sortOrder: 0,
  };
}

function makeControlActivity(key: string, name: string, durationDays: number, stage: string, floorIndex: number | null = null): PlannedNode {
  return {
    key,
    wbsCode: "",
    name,
    kind: "activity",
    sourceLineItemId: null,
    sourceCode: null,
    valueShare: 0,
    durationDays: Math.max(1, Math.round(durationDays)),
    durationBasis: "minimo",
    floorIndex,
    zoneId: null,
    zoneLabel: null,
    allocationBasis: "informado",
    executionStage: stage,
    children: [],
    startDate: "",
    endDate: "",
    sortOrder: 0,
  };
}

function addLifecycleControls(roots: PlannedNode[], slabCureDays: number) {
  const walk = (node: PlannedNode) => {
    const expanded: PlannedNode[] = [];
    for (const child of node.children) {
      walk(child);
      expanded.push(child);
      if (child.kind === "activity" && child.sourceCode === "3.5") {
        const location = child.name.includes("—") ? child.name.split("—").slice(1).join("—").trim() : child.zoneLabel ?? "laje";
        const cure = makeControlActivity(`control:cure:${child.key}`, `Curar e proteger a laje — ${location}`, slabCureDays, "structure", child.floorIndex);
        const milestone = makeControlActivity(`control:milestone:slab:${child.key}`, `◆ Marco — laje curada e piso libertado — ${location}`, 1, "milestone", child.floorIndex);
        expanded.push(cure, milestone);
      }
    }
    node.children = expanded;
  };
  roots.forEach(walk);

  if (activityNodes(roots).some((node) => node.sourceCode === "3.2")) {
    const foundationMilestone = makeControlActivity("control:milestone:foundations", "◆ Marco — fundações concluídas e libertadas", 1, "milestone");
    roots.push(makeSummary("control:milestones", "Marcos de controlo", null, [foundationMilestone]));
  }
}

function wireLifecycleControls(roots: PlannedNode[], dependencies: PlannedDependency[]): PlannedDependency[] {
  const leaves = activityNodes(roots);
  const deps = [...dependencies];
  const seen = new Set(deps.map((dep) => `${dep.predecessorKey}>${dep.successorKey}>${dep.type}>${dep.lagDays}`));
  const foundations = leaves.filter((node) => node.sourceCode === "3.2");
  const foundationMilestone = leaves.find((node) => node.key === "control:milestone:foundations");
  for (const foundation of foundations) addUniqueDependency(deps, seen, foundation, foundationMilestone);

  for (const slab of leaves.filter((node) => node.sourceCode === "3.5")) {
    const cure = leaves.find((node) => node.key === `control:cure:${slab.key}`);
    const milestone = leaves.find((node) => node.key === `control:milestone:slab:${slab.key}`);
    if (!cure || !milestone) continue;
    const outgoing = deps.filter((dep) => dep.predecessorKey === slab.key && dep.successorKey !== cure.key);
    for (const dep of outgoing) {
      const index = deps.indexOf(dep);
      if (index >= 0) deps.splice(index, 1);
      seen.delete(`${dep.predecessorKey}>${dep.successorKey}>${dep.type}>${dep.lagDays}`);
      const successor = leaves.find((node) => node.key === dep.successorKey);
      addUniqueDependency(deps, seen, milestone, successor, dep.type, 0);
    }
    addUniqueDependency(deps, seen, slab, cure);
    addUniqueDependency(deps, seen, cure, milestone);
  }
  return deps;
}

function buildFallbackNode(node: PlanningSourceNode, path: string): PlannedNode | null {
  if (node.kind === "nota") return null;
  if (node.kind === "item") {
    if (!measuredLeaf(node)) return null;
    return makeActivity(node, `src:${node.id}`, executionActivityName(node), node.durationDays, 1, null);
  }
  const children = node.children
    .map((child, index) => buildFallbackNode(child, `${path}.${index + 1}`))
    .filter((child): child is PlannedNode => child !== null);
  if (!children.length) return null;
  return makeSummary(`src:${node.id}`, node.name, node, children);
}

function splitLeafByRule(
  source: PlanningSourceNode,
  rule: StandardRule,
  floors: number,
  roofKind: "sheet" | "slab" | "unknown",
  warnings: PlanningWarning[],
  profile: SchedulePlanningProfile,
  physical: SchedulePhysicalContext | null,
): PlannedNode[] {
  type Location = {
    floorIndex: number | null;
    zoneId: string | null;
    zoneLabel: string | null;
    label: string;
    share: number;
    allocationBasis: "boq" | "informado" | "assumido";
  };

  const floorLabels = profile.floorLabels.length === floors
    ? profile.floorLabels
    : defaultFloorLabels(floors);
  const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const floorIndexFor = (label: string | null) => {
    if (!label) return null;
    const normalized = plain(label);
    const exact = floorLabels.findIndex((candidate) => plain(candidate) === normalized);
    if (exact >= 0) return exact;
    if (/cobertura|telhado|roof/.test(normalized)) return Math.max(0, floors - 1);
    return null;
  };
  const floorShareSet = normalizeShares(profile.floorShares, floors);
  const informedZoneShares = profile.zones.length && profile.zones.every((zone) => zone.share !== null)
    ? profile.zones.map((zone) => Number(zone.share))
    : null;
  const zoneShareSet = profile.locationStrategy === "floors_zones" && profile.zones.length
    ? normalizeShares(informedZoneShares, profile.zones.length)
    : { shares: [1], basis: "assumido" as const };

  let locations: Location[] = [{
    floorIndex: null,
    zoneId: null,
    zoneLabel: null,
    label: "",
    share: 1,
    allocationBasis: "boq",
  }];

  const physicalElements = rule.scope === "footing"
    ? physical?.footings ?? []
    : rule.scope === "room_wall"
      ? physical?.rooms ?? []
      : rule.scope === "deck"
        ? physical?.slabs ?? []
        : [];

  if (physicalElements.length && profile.locationStrategy !== "boq") {
    const elementShares = normalizeShares(physicalElements.map((element) => element.weight), physicalElements.length);
    locations = physicalElements.map((element, index) => ({
      floorIndex: floorIndexFor(element.floorLabel) ?? (rule.scope === "deck" ? Math.min(index, Math.max(0, floors - 1)) : null),
      zoneId: `physical:${element.key}`,
      zoneLabel: element.label,
      label: ` — ${element.label}${element.floorLabel ? ` / ${element.floorLabel}` : ""}`,
      share: elementShares.shares[index],
      allocationBasis: physical?.source === "plants" ? "informado" : "assumido",
    }));
  } else if ((rule.scope === "floor" || rule.scope === "room_wall") && profile.locationStrategy !== "boq") {
    locations = [];
    for (let floorIndex = 0; floorIndex < floors; floorIndex++) {
      if (profile.locationStrategy === "floors_zones" && profile.zones.length) {
        profile.zones.forEach((zone, zoneIndex) => {
          locations.push({
            floorIndex,
            zoneId: zone.id,
            zoneLabel: zone.label,
            label: ` — ${floorLabels[floorIndex]} / ${zone.label}`,
            share: floorShareSet.shares[floorIndex] * zoneShareSet.shares[zoneIndex],
            allocationBasis: floorShareSet.basis === "informado" || zoneShareSet.basis === "informado" ? "informado" : "assumido",
          });
        });
      } else {
        locations.push({
          floorIndex,
          zoneId: null,
          zoneLabel: null,
          label: ` — ${floorLabels[floorIndex]}`,
          share: floorShareSet.shares[floorIndex],
          allocationBasis: floorShareSet.basis,
        });
      }
    }
  } else if ((rule.scope === "deck") && profile.locationStrategy !== "boq") {
    const deckCount = Math.max(0, floors - 1 + (roofKind === "slab" ? 1 : 0));
    if (deckCount > 0) {
      const rawDeckShares = floorShareSet.shares.slice(0, deckCount);
      const deckShareSet = normalizeShares(rawDeckShares, deckCount);
      locations = [];
      for (let deckIndex = 0; deckIndex < deckCount; deckIndex++) {
        const roofDeck = roofKind === "slab" && deckIndex === deckCount - 1;
        const floorLabel = roofDeck ? "Cobertura" : floorLabels[deckIndex] ?? `Piso ${deckIndex}`;
        if (profile.locationStrategy === "floors_zones" && profile.zones.length) {
          profile.zones.forEach((zone, zoneIndex) => {
            locations.push({
              floorIndex: deckIndex,
              zoneId: zone.id,
              zoneLabel: zone.label,
              label: ` — ${floorLabel} / ${zone.label}`,
              share: deckShareSet.shares[deckIndex] * zoneShareSet.shares[zoneIndex],
              allocationBasis: deckShareSet.basis === "informado" || zoneShareSet.basis === "informado" ? "informado" : "assumido",
            });
          });
        } else {
          locations.push({
            floorIndex: deckIndex,
            zoneId: null,
            zoneLabel: null,
            label: ` — ${floorLabel}`,
            share: deckShareSet.shares[deckIndex],
            allocationBasis: deckShareSet.basis,
          });
        }
      }
    }
  } else if (rule.scope === "roof") {
    if (profile.locationStrategy === "floors_zones" && profile.zones.length) {
      locations = profile.zones.map((zone, zoneIndex) => ({
        floorIndex: floors - 1,
        zoneId: zone.id,
        zoneLabel: zone.label,
        label: ` — Cobertura / ${zone.label}`,
        share: zoneShareSet.shares[zoneIndex],
        allocationBasis: zoneShareSet.basis,
      }));
    } else {
      locations = [{
        floorIndex: floors - 1,
        zoneId: null,
        zoneLabel: null,
        label: " — Cobertura",
        share: 1,
        allocationBasis: "boq",
      }];
    }
  }

  if (locations.length === 1) {
    const location = locations[0];
    return [makeActivity(
      source,
      `src:${source.id}${location.zoneId ? `:zone:${location.zoneId}` : ""}`,
      `${executionActivityName(source)}${location.label}`,
      source.durationDays,
      1,
      location.floorIndex,
      {
        zoneId: location.zoneId,
        zoneLabel: location.zoneLabel,
        allocationBasis: location.allocationBasis,
        executionStage: rule.stage,
      },
    )];
  }

  const normalizedLocationShares = normalizeShares(locations.map((location) => location.share), locations.length);
  // Uma EAP física deve mostrar cada elemento mesmo quando o cálculo agregado tinha menos dias.
  // Nesses casos cada pacote recebe o mínimo executável de um dia e as frentes controlam o prazo.
  const durations = allocateDurationByShares(source.durationDays, normalizedLocationShares.shares)
    ?? locations.map(() => 1);

  if (source.durationDays < locations.length) {
    warnings.push({
      code: "LOCATION_DURATION_MINIMUM",
      sourceCode: source.code,
      activityName: source.name,
      message: `${source.code ?? "Item"} — ${source.name}: ${locations.length} localização(ões) confirmada(s); aplicado o mínimo de 1 dia útil por localização.`,
    });
  }

  const shares = (() => {
    const units = 10_000;
    const raw = normalizedLocationShares.shares.map((share) => share * units);
    const result = raw.map(Math.floor);
    let remaining = units - result.reduce((sum, value) => sum + value, 0);
    const ranked = raw
      .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < remaining; i++) result[ranked[i % ranked.length].index] += 1;
    return result.map((value) => value / units);
  })();

  if (locations.some((location) => location.allocationBasis === "assumido")) {
    warnings.push({
      code: "UNIFORM_FLOOR_DISTRIBUTION",
      sourceCode: source.code,
      activityName: source.name,
      message: `${source.code ?? "Item"} — ${source.name}: parte da distribuição por piso/zona não foi informada pelo utilizador. O SIGO aplicou fracções assumidas apenas para planeamento; valueShare fecha exactamente em 100%.`,
    });
  }

  return locations.map((location, index) => makeActivity(
    source,
    `src:${source.id}:loc:${location.floorIndex ?? "x"}:${location.zoneId ?? index}`,
    `${executionActivityName(source)}${location.label}`,
    durations[index],
    shares[index],
    location.floorIndex,
    {
      zoneId: location.zoneId,
      zoneLabel: location.zoneLabel,
      allocationBasis: location.allocationBasis,
      executionStage: rule.stage,
    },
  ));
}

function buildStandardChapter(
  root: PlanningSourceNode,
  floors: number,
  roofKind: "sheet" | "slab" | "unknown",
  warnings: PlanningWarning[],
  profile: SchedulePlanningProfile,
  physical: SchedulePhysicalContext | null,
): PlannedNode | null {
  if (!hasMeasuredDescendant(root)) return null;
  // O template SIGO padrão é capítulo → itens. Se houver grupos personalizados, preservamos
  // esses grupos em vez de reinterpretá-los como pisos/zona por inferência textual.
  if (root.children.some((child) => child.kind === "grupo")) return buildFallbackNode(root, root.code ?? "root");

  const directActivities: PlannedNode[] = [];
  const floorBuckets = new Map<number, PlannedNode[]>();
  const roofBucket: PlannedNode[] = [];

  for (const child of root.children) {
    if (!measuredLeaf(child)) continue;
    const rule = child.code ? STANDARD_RULES[child.code] : undefined;
    if (!rule) {
      warnings.push({
        code: "UNMAPPED_STANDARD_ITEM",
        sourceCode: child.code,
        activityName: child.name,
        message: `${child.code ?? "Item"} — ${child.name}: sem regra explícita de execução; mantida a posição do Mapa de Quantidades.`,
      });
      directActivities.push(makeActivity(child, `src:${child.id}`, child.name, child.durationDays, 1, null));
      continue;
    }
    const activities = splitLeafByRule(child, rule, floors, roofKind, warnings, profile, physical);
    for (const activity of activities) {
      if (rule.scope === "roof") {
        roofBucket.push(activity);
      } else if (activity.floorIndex !== null && ["floor", "deck", "room_wall"].includes(rule.scope)) {
        const bucket = floorBuckets.get(activity.floorIndex) ?? [];
        bucket.push(activity);
        floorBuckets.set(activity.floorIndex, bucket);
      } else {
        directActivities.push(activity);
      }
    }
  }

  const children: PlannedNode[] = [];
  children.push(...directActivities);
  const groupLabel = root.code ? FLOOR_GROUP_LABELS[root.code] : undefined;
  const floorLabels = profile.floorLabels.length === floors
    ? profile.floorLabels
    : defaultFloorLabels(floors);

  for (const floorIndex of [...floorBuckets.keys()].sort((a, b) => a - b)) {
    const bucket = floorBuckets.get(floorIndex)!;
    // O grupo mantém a localização física do piso; a própria folha 3.5 pode chamar-se
    // "— Cobertura" quando for a última laje. Não lemos o nome da actividade para decidir semântica.
    const locationLabel = floorLabels[floorIndex] ?? `Piso ${floorIndex}`;
    if (profile.locationStrategy === "floors_zones" && profile.zones.length) {
      const byZone = new Map<string, PlannedNode[]>();
      const noZone: PlannedNode[] = [];
      for (const activity of bucket) {
        if (!activity.zoneId) {
          noZone.push(activity);
          continue;
        }
        const zoneTasks = byZone.get(activity.zoneId) ?? [];
        zoneTasks.push(activity);
        byZone.set(activity.zoneId, zoneTasks);
      }
      const zoneGroups = profile.zones.flatMap((zone) => {
        const zoneTasks = byZone.get(zone.id) ?? [];
        return zoneTasks.length
          ? [makeSummary(`group:${root.id}:floor:${floorIndex}:zone:${zone.id}`, `${zone.label}`, null, zoneTasks)]
          : [];
      });
      const floorChildren = [...noZone, ...zoneGroups];
      children.push(makeSummary(
        `group:${root.id}:floor:${floorIndex}`,
        `${groupLabel ?? root.name} — ${locationLabel}`,
        null,
        floorChildren,
      ));
    } else {
      children.push(makeSummary(
        `group:${root.id}:floor:${floorIndex}`,
        `${groupLabel ?? root.name} — ${locationLabel}`,
        null,
        bucket,
      ));
    }
  }

  if (roofBucket.length) {
    if (profile.locationStrategy === "floors_zones" && profile.zones.length) {
      const roofChildren = profile.zones.flatMap((zone) => {
        const zoneTasks = roofBucket.filter((activity) => activity.zoneId === zone.id);
        return zoneTasks.length
          ? [makeSummary(`group:${root.id}:roof:zone:${zone.id}`, zone.label, null, zoneTasks)]
          : [];
      });
      children.push(makeSummary(`group:${root.id}:roof`, `${groupLabel ?? root.name} — Cobertura`, null, roofChildren.length ? roofChildren : roofBucket));
    } else {
      children.push(makeSummary(`group:${root.id}:roof`, `${groupLabel ?? root.name} — Cobertura`, null, roofBucket));
    }
  }
  if (!children.length) return null;
  return makeSummary(`src:${root.id}`, root.name, root, children);
}

function assignWbsCodes(roots: PlannedNode[]) {
  let sortOrder = 0;
  const used = new Set<string>();
  const reserve = (candidate: string): string => {
    const base = candidate.slice(0, 30);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let serial = 2;
    while (true) {
      const suffix = `.${serial}`;
      const code = `${base.slice(0, Math.max(1, 30 - suffix.length))}${suffix}`;
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
      serial += 1;
    }
  };

  const walk = (node: PlannedNode, parentCode: string | null, index: number) => {
    let candidate: string;
    if (!parentCode) candidate = node.sourceCode ?? String(index + 1);
    else if (node.key.includes(":floor:")) candidate = `${parentCode}.P${node.key.split(":").at(-1)}`;
    else if (node.key.endsWith(":roof")) candidate = `${parentCode}.C`;
    else if (node.kind === "activity" && node.sourceCode && !node.key.includes(":loc:")) candidate = node.sourceCode;
    else if (node.kind === "activity" && node.sourceCode && node.key.includes(":loc:")) {
      const suffix = node.sourceCode.split(".").at(-1) ?? String(index + 1);
      candidate = `${parentCode}.${suffix}`;
    } else candidate = `${parentCode}.${index + 1}`;
    node.wbsCode = reserve(candidate);
    node.sortOrder = sortOrder++;
    node.children.forEach((child, childIndex) => walk(child, node.wbsCode, childIndex));
  };
  roots.forEach((root, index) => walk(root, null, index));
}

function flattenNodes(roots: PlannedNode[]): PlannedNode[] {
  const result: PlannedNode[] = [];
  const walk = (node: PlannedNode) => {
    result.push(node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return result;
}

function activityNodes(roots: PlannedNode[]): PlannedNode[] {
  return flattenNodes(roots).filter((node) => node.kind === "activity");
}

function previousMeasuredActivityInTree(
  root: PlannedNode,
  targetKey: string,
  sameLocationOnly = false,
): PlannedNode | null {
  const activities = flattenNodes([root]).filter((node) => node.kind === "activity");
  const index = activities.findIndex((node) => node.key === targetKey);
  if (index <= 0) return null;
  if (!sameLocationOnly) return activities[index - 1];
  const target = activities[index];
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = activities[cursor];
    if (candidate.floorIndex === target.floorIndex && candidate.zoneId === target.zoneId) return candidate;
  }
  return null;
}

function buildFallbackDependencies(roots: PlannedNode[]): PlannedDependency[] {
  const deps: PlannedDependency[] = [];
  let previousRootLast: PlannedNode | null = null;
  for (const root of roots) {
    const leaves = flattenNodes([root]).filter((node) => node.kind === "activity");
    for (let i = 1; i < leaves.length; i++) deps.push({ predecessorKey: leaves[i - 1].key, successorKey: leaves[i].key, type: "FS", lagDays: 0 });
    if (previousRootLast && leaves[0]) deps.push({ predecessorKey: previousRootLast.key, successorKey: leaves[0].key, type: "FS", lagDays: 0 });
    if (leaves.length) previousRootLast = leaves[leaves.length - 1];
  }
  return deps;
}

function addUniqueDependency(
  deps: PlannedDependency[],
  seen: Set<string>,
  predecessor: PlannedNode | null | undefined,
  successor: PlannedNode | null | undefined,
  type: DependencyType = "FS",
  lagDays = 0,
) {
  if (!predecessor || !successor || predecessor.key === successor.key) return;
  const key = `${predecessor.key}>${successor.key}>${type}>${lagDays}`;
  if (seen.has(key)) return;
  seen.add(key);
  deps.push({ predecessorKey: predecessor.key, successorKey: successor.key, type, lagDays });
}

function buildStandardDependencies(
  roots: PlannedNode[],
  floors: number,
  roofKind: "sheet" | "slab" | "unknown",
  profile: SchedulePlanningProfile,
): PlannedDependency[] {
  const deps: PlannedDependency[] = [];
  const seen = new Set<string>();
  const leaves = activityNodes(roots);
  const byCode = new Map<string, PlannedNode[]>();
  for (const leaf of leaves) {
    if (!leaf.sourceCode) continue;
    const bucket = byCode.get(leaf.sourceCode) ?? [];
    bucket.push(leaf);
    byCode.set(leaf.sourceCode, bucket);
  }

  const all = (code: string) => byCode.get(code) ?? [];
  const one = (code: string) => all(code).find((node) => node.floorIndex === null && node.zoneId === null) ?? all(code)[0] ?? null;
  const zones: Array<string | null> = profile.locationStrategy === "floors_zones" && profile.zones.length
    ? profile.zones.map((zone) => zone.id)
    : [null];
  const at = (code: string, floor: number, zoneId: string | null) => {
    const rows = all(code);
    return rows.find((node) => node.floorIndex === floor && node.zoneId === zoneId)
      ?? rows.find((node) => node.floorIndex === floor && node.zoneId === null)
      ?? (floors === 1 ? rows.find((node) => node.floorIndex === null && node.zoneId === zoneId) : null)
      ?? (floors === 1 ? rows.find((node) => node.floorIndex === null && node.zoneId === null) : null)
      ?? null;
  };
  const atMany = (code: string, floor: number, zoneId: string | null) => {
    const rows = all(code).filter((node) => node.floorIndex === floor);
    if (zoneId !== null) {
      const exact = rows.filter((node) => node.zoneId === zoneId);
      if (exact.length) return exact;
    }
    return rows.length ? rows : (floors === 1 ? all(code).filter((node) => node.floorIndex === null) : []);
  };
  const roofAt = (code: string, zoneId: string | null) => {
    const rows = all(code);
    return rows.find((node) => node.zoneId === zoneId)
      ?? rows.find((node) => node.zoneId === null)
      ?? rows[0]
      ?? null;
  };
  const preferredExisting = (...nodes: Array<PlannedNode | null | undefined>) => nodes.find(Boolean) as PlannedNode | undefined;

  const foundationLag = profile.cureLags.foundations ?? DEFAULT_FOUNDATION_CURE_LAG_DAYS;
  const columnLag = profile.cureLags.columns ?? DEFAULT_COLUMN_CURE_LAG_DAYS;
  const slabLag = profile.cureLags.slabs ?? DEFAULT_SLAB_CURE_LAG_DAYS;

  // Preliminares e fundações mantêm a sequência contratual exacta do template.
  addUniqueDependency(deps, seen, one("1.1"), one("1.2"));
  addUniqueDependency(deps, seen, preferredExisting(one("1.2"), one("1.1")), one("1.3"));
  const prelimEnd = preferredExisting(one("1.3"), one("1.2"), one("1.1"));
  const footingExcavations = all("2.1");
  const footingBlinding = all("3.1");
  const footingConcrete = all("3.2");
  const samePhysicalElement = (rows: PlannedNode[], task: PlannedNode) => rows.find((row) => row.zoneId && row.zoneId === task.zoneId) ?? rows[0];
  for (const excavation of footingExcavations) addUniqueDependency(deps, seen, prelimEnd, excavation);
  for (const blinding of footingBlinding) addUniqueDependency(deps, seen, samePhysicalElement(footingExcavations, blinding) ?? prelimEnd, blinding);
  for (const concrete of footingConcrete) addUniqueDependency(deps, seen, samePhysicalElement(footingBlinding, concrete) ?? samePhysicalElement(footingExcavations, concrete) ?? prelimEnd, concrete);

  const foundationMilestone = leaves.find((node) => node.key === "control:milestone:foundations");
  const foundationEnd = preferredExisting(foundationMilestone, footingConcrete.at(-1), footingBlinding.at(-1), footingExcavations.at(-1), prelimEnd);
  const deckCount = Math.max(0, floors - 1 + (roofKind === "slab" ? 1 : 0));
  const finalStructuralByZone = new Map<string | null, PlannedNode>();
  const masonryStarts: PlannedNode[] = [];

  for (let floor = 0; floor < floors; floor++) {
    for (const zoneId of zones) {
      const columns = at("3.3", floor, zoneId);
      const beams = at("3.4", floor, zoneId);
      const slabs = floor < deckCount ? atMany("3.5", floor, zoneId) : [];
      const slab = slabs.at(-1) ?? null;
      const reinforcement = at("3.6", floor, zoneId);
      const formwork = at("3.8", floor, zoneId);
      const structuralSupports = floor === 0
        ? [foundationEnd].filter(Boolean) as PlannedNode[]
        : (atMany("3.5", floor - 1, zoneId).length ? atMany("3.5", floor - 1, zoneId) : [at("3.4", floor - 1, zoneId)].filter(Boolean) as PlannedNode[]);
      const structuralSupport = structuralSupports.at(-1) ?? null;
      const supportLag = floor === 0
        ? (one("3.2") ? foundationLag : 0)
        : (structuralSupport?.sourceCode === "3.5" ? slabLag : 0);
      for (const support of structuralSupports) {
        addUniqueDependency(deps, seen, support, reinforcement, "FS", supportLag);
        addUniqueDependency(deps, seen, support, formwork, "FS", supportLag);
      }
      if (reinforcement || formwork) {
        addUniqueDependency(deps, seen, reinforcement, columns);
        addUniqueDependency(deps, seen, formwork, columns);
      } else {
        addUniqueDependency(deps, seen, structuralSupport, columns, "FS", supportLag);
      }
      addUniqueDependency(deps, seen, columns ?? (floor === 0 ? foundationEnd : null), beams, "FS", columns ? columnLag : 0);
      for (const slabTask of slabs) addUniqueDependency(deps, seen, beams ?? columns, slabTask);

      const structureEnd = slab ?? beams ?? columns ?? (floor === 0 ? foundationEnd : null);
      if (structureEnd) finalStructuralByZone.set(zoneId, structureEnd);

      const masonryFirst = atMany("4.1", floor, zoneId);
      const masonrySecond = atMany("4.2", floor, zoneId);
      for (const masonry of masonryFirst) {
        addUniqueDependency(deps, seen, structureEnd, masonry);
        masonryStarts.push(masonry);
      }
      for (const masonry of masonrySecond) {
        addUniqueDependency(deps, seen, samePhysicalElement(masonryFirst, masonry) ?? structureEnd, masonry);
      }
      const masonryEnds = masonrySecond.length ? masonrySecond : masonryFirst;
      const masonryEnd = masonryEnds.at(-1) ?? structureEnd;

      const mepRough = ["8.1", "8.2", "11.6", "13.2", "13.3"]
        .map((code) => at(code, floor, zoneId))
        .filter(Boolean) as PlannedNode[];
      for (const task of mepRough) {
        if (masonryEnds.length) for (const predecessor of masonryEnds) addUniqueDependency(deps, seen, predecessor, task);
        else addUniqueDependency(deps, seen, masonryEnd, task);
      }

      const lintels = at("15.4", floor, zoneId);
      addUniqueDependency(deps, seen, masonryEnd, lintels);

      const roughEnds = [...mepRough, lintels].filter(Boolean) as PlannedNode[];
      const plasterInterior = at("5.2", floor, zoneId);
      const plasterExterior = at("5.3", floor, zoneId);
      const screed = at("5.1", floor, zoneId);
      if (roughEnds.length) {
        for (const predecessor of roughEnds) {
          addUniqueDependency(deps, seen, predecessor, plasterInterior);
          addUniqueDependency(deps, seen, predecessor, plasterExterior);
        }
      } else {
        addUniqueDependency(deps, seen, masonryEnd, plasterInterior);
        addUniqueDependency(deps, seen, masonryEnd, plasterExterior);
      }
      addUniqueDependency(deps, seen, preferredExisting(...mepRough, masonryEnd), screed);

      const floorTile = at("6.1", floor, zoneId);
      const wallTile = at("6.2", floor, zoneId);
      addUniqueDependency(deps, seen, screed ?? masonryEnd, floorTile);
      addUniqueDependency(deps, seen, plasterInterior ?? masonryEnd, wallTile);

      const windows = at("15.3", floor, zoneId);
      const doorsInterior = at("15.1", floor, zoneId);
      const doorsExterior = at("15.2", floor, zoneId);
      addUniqueDependency(deps, seen, preferredExisting(plasterExterior, plasterInterior, masonryEnd), windows);
      addUniqueDependency(deps, seen, preferredExisting(plasterInterior, masonryEnd), doorsInterior);
      addUniqueDependency(deps, seen, preferredExisting(plasterExterior, plasterInterior, masonryEnd), doorsExterior);

      const paintExterior = at("7.1", floor, zoneId);
      const paintInterior = at("7.2", floor, zoneId);
      const paintCeiling = at("7.3", floor, zoneId);
      addUniqueDependency(deps, seen, preferredExisting(windows, plasterExterior, masonryEnd), paintExterior);
      for (const predecessor of [plasterInterior, wallTile, doorsInterior].filter(Boolean) as PlannedNode[]) {
        addUniqueDependency(deps, seen, predecessor, paintInterior);
      }
      addUniqueDependency(deps, seen, plasterInterior ?? masonryEnd, paintCeiling);

      const fixtureGate = preferredExisting(paintInterior, wallTile, floorTile, plasterInterior, masonryEnd);
      for (const code of ["11.1", "11.2", "11.3", "11.4", "11.5"]) addUniqueDependency(deps, seen, fixtureGate, at(code, floor, zoneId));
    }
  }

  // Cobertura plana: malhasol explicitamente medido antes da laje de cobertura, zona a zona.
  if (roofKind === "slab") {
    for (const zoneId of zones) {
      const roofMesh = roofAt("3.7", zoneId);
      const roofSlabs = atMany("3.5", Math.max(0, deckCount - 1), zoneId);
      const roofSlab = roofSlabs.at(-1) ?? null;
      const roofBeams = at("3.4", floors - 1, zoneId);
      addUniqueDependency(deps, seen, roofBeams ?? at("3.3", floors - 1, zoneId), roofMesh);
      for (const slabTask of roofSlabs) addUniqueDependency(deps, seen, roofMesh, slabTask);
      if (roofSlab) finalStructuralByZone.set(zoneId, roofSlab);
    }
  }

  // Se o cliente exigir concluir toda a estrutura antes das alvenarias, esta restrição adicional
  // prevalece sobre a ligação piso-a-piso já existente.
  if (profile.sequencePolicy === "structure_complete_first") {
    for (const finalStructural of finalStructuralByZone.values()) {
      for (const masonryStart of masonryStarts) addUniqueDependency(deps, seen, finalStructural, masonryStart);
    }
  }

  // Cobertura: apenas linhas realmente medidas; a cadeia é por zona quando o cliente a definiu.
  const roofEnds: PlannedNode[] = [];
  for (const zoneId of zones) {
    const topStructure = roofKind === "slab"
      ? atMany("3.5", Math.max(0, deckCount - 1), zoneId).at(-1) ?? null
      : preferredExisting(
          at("4.2", floors - 1, zoneId),
          at("4.1", floors - 1, zoneId),
          at("3.4", floors - 1, zoneId),
          at("3.3", floors - 1, zoneId),
          foundationEnd,
        );
    const roof10_1 = roofAt("10.1", zoneId);
    const roof10_2 = roofAt("10.2", zoneId);
    const roof10_3 = roofAt("10.3", zoneId);
    const firstRoof = preferredExisting(roof10_1, roof10_2, roof10_3);
    addUniqueDependency(
      deps,
      seen,
      topStructure,
      firstRoof,
      "FS",
      roofKind === "slab" && topStructure?.sourceCode === "3.5" ? slabLag : 0,
    );
    addUniqueDependency(deps, seen, roof10_1, roof10_2);
    addUniqueDependency(deps, seen, roof10_2 ?? roof10_1, roof10_3);
    const roofEnd = preferredExisting(roof10_3, roof10_2, roof10_1, topStructure);
    if (roofEnd) roofEnds.push(roofEnd);

    if (floors === 1 && firstRoof) {
      for (const code of ["8.1", "8.2", "11.6", "13.2", "13.3"]) {
        addUniqueDependency(deps, seen, roofEnd, at(code, 0, zoneId));
      }
    }
  }
  for (const roofEnd of roofEnds) {
    addUniqueDependency(deps, seen, roofEnd, one("9.1"));
    addUniqueDependency(deps, seen, roofEnd, one("11.7"));
  }

  // Frentes externas sem obrigar a parar a superestrutura.
  addUniqueDependency(deps, seen, one("2.1") ?? prelimEnd, one("12.1"));
  addUniqueDependency(deps, seen, one("12.1"), one("12.2"));
  addUniqueDependency(deps, seen, foundationEnd, one("13.4"));
  addUniqueDependency(deps, seen, preferredExisting(one("8.2"), one("8.1"), foundationEnd), one("8.3"));

  // Quadro final depois da distribuição eléctrica e acabamento interior existente.
  for (const predecessor of [...all("13.2"), ...all("13.3"), ...all("7.2")]) {
    addUniqueDependency(deps, seen, predecessor, one("13.1"));
  }

  // Itens sem regra explícita mantêm a ordem do capítulo, mas uma repartição por piso/zona
  // NÃO pode ser serializada aqui. A concorrência entre localizações é controlada exclusivamente
  // pelo número de frentes da especialidade (applyFrontCapacityDependencies). Caso contrário,
  // informar 2 ou 3 frentes não teria qualquer efeito porque o fallback já teria criado FS entre
  // todos os pisos.
  const targeted = new Set(deps.map((dep) => dep.successorKey));
  let previousRootLast: PlannedNode | null = null;
  for (const root of roots) {
    const rootActivities = flattenNodes([root]).filter((node) => node.kind === "activity");
    for (const activity of rootActivities) {
      if (!activity.sourceLineItemId) continue;
      if (targeted.has(activity.key)) continue;
      const localized = activity.floorIndex !== null || activity.zoneId !== null;
      const previousInChapter = previousMeasuredActivityInTree(root, activity.key, localized);
      if (previousInChapter) addUniqueDependency(deps, seen, previousInChapter, activity);
      else if (!localized && previousRootLast) addUniqueDependency(deps, seen, previousRootLast, activity);
    }
    if (rootActivities.length) previousRootLast = rootActivities.at(-1)!;
  }

  return deps;
}

function tradeForActivity(activity: PlannedNode): PlanningTrade {
  const explicit = planningTradeForCode(activity.sourceCode);
  if (explicit) return explicit;
  return activity.executionStage === "external" ? "external" : "finishes";
}

function applyFrontCapacityDependencies(
  roots: PlannedNode[],
  dependencies: PlannedDependency[],
  profile: SchedulePlanningProfile,
  warnings: PlanningWarning[],
): PlannedDependency[] {
  if (profile.locationStrategy === "boq") return dependencies;
  const deps = [...dependencies];
  const seen = new Set(deps.map((dep) => `${dep.predecessorKey}>${dep.successorKey}>${dep.type}>${dep.lagDays}`));
  const activities = activityNodes(roots).filter((activity) => activity.floorIndex !== null || activity.zoneId !== null);
  let constraintsAdded = 0;

  for (const trade of Object.keys(profile.tradeFronts) as PlanningTrade[]) {
    const capacity = Math.max(1, Math.round(profile.tradeFronts[trade] ?? DEFAULT_ASSUMED_FRONT_COUNT));
    const tradeActivities = activities.filter((activity) => tradeForActivity(activity) === trade);
    const byLocation = new Map<string, PlannedNode[]>();
    for (const activity of tradeActivities) {
      const location = `${activity.floorIndex ?? "x"}:${activity.zoneId ?? "all"}`;
      const bucket = byLocation.get(location) ?? [];
      bucket.push(activity);
      byLocation.set(location, bucket);
    }
    const locationGroups = [...byLocation.entries()]
      .map(([key, rows]) => ({
        key,
        rows: rows.sort((a, b) => a.sortOrder - b.sortOrder),
        order: Math.min(...rows.map((row) => row.sortOrder)),
      }))
      .sort((a, b) => a.order - b.order);
    for (let index = capacity; index < locationGroups.length; index++) {
      const previous = locationGroups[index - capacity].rows.at(-1);
      const current = locationGroups[index].rows[0];
      const before = deps.length;
      addUniqueDependency(deps, seen, previous, current, "FS", 0);
      if (deps.length > before) constraintsAdded += 1;
    }
  }

  if (constraintsAdded > 0) {
    warnings.push({
      code: "FRONT_CAPACITY_APPLIED",
      message: `Foram aplicadas ${constraintsAdded} restrição(ões) de capacidade para respeitar o número de frentes informado por especialidade.`,
    });
  }
  return deps;
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function topologicalActivities(activities: PlannedNode[], dependencies: PlannedDependency[]): PlannedNode[] {
  const byKey = new Map(activities.map((node) => [node.key, node]));
  const indegree = new Map(activities.map((node) => [node.key, 0]));
  const outgoing = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!byKey.has(dep.predecessorKey) || !byKey.has(dep.successorKey)) continue;
    indegree.set(dep.successorKey, (indegree.get(dep.successorKey) ?? 0) + 1);
    const list = outgoing.get(dep.predecessorKey) ?? [];
    list.push(dep.successorKey);
    outgoing.set(dep.predecessorKey, list);
  }
  const queue = activities.filter((node) => (indegree.get(node.key) ?? 0) === 0).sort((a, b) => a.sortOrder - b.sortOrder);
  const ordered: PlannedNode[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    ordered.push(node);
    for (const successorKey of outgoing.get(node.key) ?? []) {
      const next = (indegree.get(successorKey) ?? 0) - 1;
      indegree.set(successorKey, next);
      if (next === 0) {
        queue.push(byKey.get(successorKey)!);
        queue.sort((a, b) => a.sortOrder - b.sortOrder);
      }
    }
  }
  if (ordered.length !== activities.length) throw new Error("O grafo de precedências da WBS contém um ciclo");
  return ordered;
}

function scheduleDates(roots: PlannedNode[], dependencies: PlannedDependency[], startDate: string) {
  const activities = activityNodes(roots);
  const byKey = new Map(activities.map((node) => [node.key, node]));
  const incoming = new Map<string, PlannedDependency[]>();
  for (const dep of dependencies) {
    const list = incoming.get(dep.successorKey) ?? [];
    list.push(dep);
    incoming.set(dep.successorKey, list);
  }
  for (const activity of topologicalActivities(activities, dependencies)) {
    let activityStart = startDate;
    for (const dep of incoming.get(activity.key) ?? []) {
      const predecessor = byKey.get(dep.predecessorKey);
      if (!predecessor?.startDate || !predecessor.endDate) continue;
      const candidate = computeSuccessorDates(predecessor, dep.type, dep.lagDays, activity.durationDays);
      activityStart = maxDate(activityStart, candidate.startDate);
    }
    activity.startDate = activityStart;
    activity.endDate = addWorkingDays(activityStart, activity.durationDays - 1);
  }

  const rollup = (node: PlannedNode) => {
    if (node.kind === "activity") return;
    node.children.forEach(rollup);
    const dated = node.children.filter((child) => child.startDate && child.endDate);
    if (!dated.length) {
      node.startDate = startDate;
      node.endDate = startDate;
      node.durationDays = 1;
      return;
    }
    node.startDate = dated.reduce((min, child) => child.startDate < min ? child.startDate : min, dated[0].startDate);
    node.endDate = dated.reduce((max, child) => child.endDate > max ? child.endDate : max, dated[0].endDate);
    node.durationDays = workingDaysInclusive(node.startDate, node.endDate);
  };
  roots.forEach(rollup);
}

function clonePlanNodes(nodes: PlannedNode[]): PlannedNode[] {
  return nodes.map((node) => ({ ...node, children: clonePlanNodes(node.children) }));
}

function projectSpan(roots: PlannedNode[]): { startDate: string; endDate: string; durationDays: number } {
  const leaves = activityNodes(roots);
  if (!leaves.length) throw new Error("A WBS não contém actividades executáveis");
  const startDate = leaves.reduce((min, leaf) => leaf.startDate < min ? leaf.startDate : min, leaves[0].startDate);
  const endDate = leaves.reduce((max, leaf) => leaf.endDate > max ? leaf.endDate : max, leaves[0].endDate);
  return { startDate, endDate, durationDays: workingDaysInclusive(startDate, endDate) };
}

function applyDurationFactor(roots: PlannedNode[], factor: number) {
  for (const node of flattenNodes(roots)) {
    // Cura e marcos são tempos técnicos fixos; comprimir o prazo contratual não os encurta.
    if (node.kind === "activity" && node.sourceLineItemId) node.durationDays = Math.max(1, Math.round(node.durationDays * factor));
  }
}

function fitTargetDuration(
  roots: PlannedNode[],
  dependencies: PlannedDependency[],
  startDate: string,
  targetDays: number,
): { roots: PlannedNode[]; achievedDays: number } {
  const target = Math.max(1, Math.round(targetDays));
  let low = 0.02;
  let high = 20;
  let bestRoots = clonePlanNodes(roots);
  scheduleDates(bestRoots, dependencies, startDate);
  let bestDistance = Math.abs(projectSpan(bestRoots).durationDays - target);
  let bestDays = projectSpan(bestRoots).durationDays;

  for (let iteration = 0; iteration < 40; iteration++) {
    const factor = (low + high) / 2;
    const candidate = clonePlanNodes(roots);
    applyDurationFactor(candidate, factor);
    scheduleDates(candidate, dependencies, startDate);
    const days = projectSpan(candidate).durationDays;
    const distance = Math.abs(days - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRoots = candidate;
      bestDays = days;
    }
    if (days < target) low = factor;
    else if (days > target) high = factor;
    else return { roots: candidate, achievedDays: days };
  }
  return { roots: bestRoots, achievedDays: bestDays };
}

function addValidationWarnings(roots: PlannedNode[], warnings: PlanningWarning[]) {
  for (const activity of activityNodes(roots)) {
    if (activity.durationDays > 20) {
      warnings.push({
        code: "LONG_ACTIVITY",
        sourceCode: activity.sourceCode,
        activityName: activity.name,
        message: `${activity.wbsCode} — ${activity.name}: ${activity.durationDays} dias úteis. Sugere-se subdividir por zona/frente/equipa para controlo de produção.`,
      });
    }
  }
}

function addStructuralAuditWarning(sections: PlanningSourceSection[], warnings: PlanningWarning[]) {
  if (!sections.some((section) => isSigoTemplate(section.templateKey))) return;
  const codes = new Set(flattenMeasuredLeaves(sections).map((leaf) => leaf.code));
  if (codes.has("3.6") || codes.has("3.8")) {
    warnings.push({
      code: "GENERIC_STRUCTURAL_RESOURCE",
      message: "Aço/cofragem estão agregados no BOQ. O SIGO reparte-os por piso, conserva 100% do valor e não inventa quantidades por elemento.",
    });
  }
}

export function buildExecutionPlan(args: {
  sections: PlanningSourceSection[];
  floors: number;
  startDate: string;
  totalDurationDays?: number;
  profile: SchedulePlanningProfile;
  physicalContext?: SchedulePhysicalContext | null;
}): ExecutionPlan {
  const floors = Math.max(1, Math.min(20, Math.round(args.floors)));
  const warnings: PlanningWarning[] = [];
  const measuredLeaves = flattenMeasuredLeaves(args.sections);
  if (!measuredLeaves.length) throw new Error("O Mapa de Quantidades ainda não tem itens medidos para gerar a WBS");
  const detectedRoofKind = roofKindFromMeasuredCodes(measuredLeaves);
  const roofKind = detectedRoofKind === "unknown" ? args.profile.roofKindOverride ?? "unknown" : detectedRoofKind;

  const context = buildPlanningContext(args.sections, floors);
  const structuredPlanning = context.supportsFloorPlanning && args.profile.locationStrategy !== "boq";
  if (!context.supportsFloorPlanning && args.profile.locationStrategy !== "boq") {
    warnings.push({
      code: "PROFILE_SCOPE_FALLBACK",
      message: "O perfil pediu repartição por piso/zona, mas o BOQ não tem metadados estruturados seguros. A EAP preservou a hierarquia do mapa sem inventar localizações.",
    });
  }

  const roots: PlannedNode[] = [];
  let allMeasuredSectionsSigo = true;
  let standardGraphSafe = true;
  for (const section of [...args.sections].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const sigo = isSigoTemplate(section.templateKey);
    const sectionHasMeasuredWork = section.roots.some(hasMeasuredDescendant);
    if (sectionHasMeasuredWork && !sigo) {
      allMeasuredSectionsSigo = false;
      if (floors > 1) warnings.push({
        code: "IMPORTED_SCOPE_PRESERVED",
        message: `${section.name}: mapa sem metadados SIGO de localização. A EAP preserva os grupos/ordem do BOQ e não reparte automaticamente por ${floors} pisos.`,
      });
    }
    if (sectionHasMeasuredWork && sigo) {
      const customHierarchy = section.roots.some((root) =>
        hasMeasuredDescendant(root) && (root.kind !== "capitulo" || root.children.some((child) => child.kind === "grupo")),
      );
      if (customHierarchy) {
        standardGraphSafe = false;
        warnings.push({
          code: "CUSTOM_BOQ_HIERARCHY_PRESERVED",
          message: `${section.name}: hierarquia personalizada detectada. O motor preservou a árvore e usa a ordem FS do próprio mapa.`,
        });
      }
    }
    for (const root of [...section.roots].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const planned = structuredPlanning && sigo && root.kind === "capitulo"
        ? buildStandardChapter(root, floors, roofKind, warnings, args.profile, args.physicalContext ?? null)
        : buildFallbackNode(root, root.code ?? "root");
      if (planned) roots.push(planned);
    }
  }
  if (!roots.length) throw new Error("O Mapa de Quantidades ainda não tem capítulos com quantidade para gerar a WBS");

  if (structuredPlanning) {
    addLifecycleControls(roots, args.profile.cureLags.slabs ?? DEFAULT_SLAB_CURE_LAG_DAYS);
    if (args.physicalContext?.source === "plants") {
      warnings.push({ code: "PHYSICAL_SCOPE_FROM_PLANTS", message: "A EAP foi detalhada por sapatas, lajes e compartimentos confirmados nas plantas; cada item mantém 100% do valor do BOQ." });
    } else {
      warnings.push({ code: "PHYSICAL_SCOPE_FALLBACK", message: "Sem elementos suficientes nas plantas, a EAP usa os pisos, medições e capítulos do orçamento como base física." });
    }
  }

  assignWbsCodes(roots);
  let dependencies = allMeasuredSectionsSigo && standardGraphSafe && structuredPlanning
    ? buildStandardDependencies(roots, floors, roofKind, args.profile)
    : buildFallbackDependencies(roots);
  if (structuredPlanning) dependencies = wireLifecycleControls(roots, dependencies);
  if (allMeasuredSectionsSigo && standardGraphSafe && structuredPlanning) {
    dependencies = applyFrontCapacityDependencies(roots, dependencies, args.profile, warnings);
  }
  scheduleDates(roots, dependencies, args.startDate);
  const naturalSpan = projectSpan(roots);

  let effectiveRoots = roots;
  const targetDuration = args.profile.targetDurationDays ?? args.totalDurationDays;
  if (targetDuration) {
    const fitted = fitTargetDuration(roots, dependencies, args.startDate, targetDuration);
    effectiveRoots = fitted.roots;
    if (fitted.achievedDays !== Math.round(targetDuration)) {
      warnings.push({
        code: "TARGET_DURATION_UNREACHABLE",
        message: `Prazo pedido: ${Math.round(targetDuration)} dias úteis; menor diferença possível com actividades inteiras e precedências actuais: ${fitted.achievedDays} dias úteis.`,
      });
    }
  }

  const usedTrades = new Set(measuredLeaves.map((leaf) => planningTradeForCode(leaf.code)).filter((trade): trade is PlanningTrade => Boolean(trade)));
  for (const trade of usedTrades) {
    if (args.profile.crewSizes[trade] === null) {
      warnings.push({
        code: "CREW_SIZE_DEFAULT",
        message: `A equipa de ${PLANNING_TRADE_LABELS[trade]} não foi indicada; a duração usa o fallback de ${DEFAULT_FALLBACK_CREW_SIZE} trabalhadores por frente e fica marcada como hipótese de planeamento.`,
      });
    }
    if (args.profile.tradeFronts[trade] === null) {
      warnings.push({
        code: "FRONT_COUNT_DEFAULT",
        message: `O número de frentes de ${PLANNING_TRADE_LABELS[trade]} não foi indicado; o SIGO assume ${DEFAULT_ASSUMED_FRONT_COUNT} frente simultânea e regista esta decisão como hipótese de planeamento.`,
      });
    }
  }

  addValidationWarnings(effectiveRoots, warnings);
  addStructuralAuditWarning(args.sections, warnings);
  const span = projectSpan(effectiveRoots);
  const foundationLag = args.profile.cureLags.foundations ?? DEFAULT_FOUNDATION_CURE_LAG_DAYS;
  const columnLag = args.profile.cureLags.columns ?? DEFAULT_COLUMN_CURE_LAG_DAYS;
  const slabLag = args.profile.cureLags.slabs ?? DEFAULT_SLAB_CURE_LAG_DAYS;
  const assumptions: string[] = [
    "Calendário de obra: segunda-feira a sábado; domingo não útil.",
    `Tempos tecnológicos usados: fundações ${foundationLag} d.u.; pilares ${columnLag} d.u.; lajes ${slabLag} d.u.`,
  ];
  if (args.physicalContext?.source === "plants") assumptions.push(`EAP física baseada nas plantas: ${args.physicalContext.footings.length} sapata(s), ${args.physicalContext.slabs.length} laje(s) e ${args.physicalContext.rooms.length} compartimento(s) identificados.`);
  else assumptions.push("Sem plantas estruturadas suficientes: a EAP usa medições e orçamento, preservando a hierarquia e as quantidades disponíveis.");
  if (args.profile.floorShares === null && structuredPlanning && floors > 1) assumptions.push("Distribuição por piso não informada: o SIGO usa fracções uniformes e identifica-as como assumidas.");
  if (args.profile.locationStrategy === "floors_zones") assumptions.push(`Planeamento repartido por ${args.profile.zones.length} zona(s) física(s) informada(s) pelo utilizador.`);
  if (args.profile.sequencePolicy === "structure_complete_first") assumptions.push("Sequência escolhida: concluir toda a estrutura antes de libertar as alvenarias.");
  else if (structuredPlanning && floors > 1) assumptions.push("Sequência escolhida: libertação piso a piso conforme suporte estrutural disponível.");

  return {
    roots: effectiveRoots,
    dependencies,
    warnings,
    roofKind,
    assumptions,
    naturalDurationDays: naturalSpan.durationDays,
    targetDurationDays: targetDuration ? Math.round(targetDuration) : null,
    ...span,
  };
}

export function validateValueShares(roots: PlannedNode[]): Array<{ sourceLineItemId: string; totalShare: number }> {
  const totals = new Map<string, number>();
  for (const activity of activityNodes(roots)) {
    if (!activity.sourceLineItemId) continue;
    totals.set(activity.sourceLineItemId, (totals.get(activity.sourceLineItemId) ?? 0) + activity.valueShare);
  }
  return [...totals.entries()].map(([sourceLineItemId, totalShare]) => ({ sourceLineItemId, totalShare: Math.round(totalShare * 10_000) / 10_000 }));
}

/**
 * Auditoria de cobertura do âmbito: cada linha medida do BOQ deve originar pelo menos uma
 * actividade e nenhuma actividade gerada pode apontar para uma linha fora desse BOQ.
 * Uma linha pode aparecer várias vezes quando foi repartida por piso/zona; essa duplicação é
 * controlada separadamente por `validateValueShares`.
 */
export function validatePlanCoverage(sections: PlanningSourceSection[], roots: PlannedNode[]) {
  const measuredIds = new Set(flattenMeasuredLeaves(sections).map((leaf) => leaf.id));
  const plannedIds = new Set(
    activityNodes(roots)
      .map((node) => node.sourceLineItemId)
      .filter((id): id is string => Boolean(id)),
  );
  return {
    measuredSourceLineItemCount: measuredIds.size,
    plannedSourceLineItemCount: plannedIds.size,
    missingSourceLineItemIds: [...measuredIds].filter((id) => !plannedIds.has(id)),
    unexpectedSourceLineItemIds: [...plannedIds].filter((id) => !measuredIds.has(id)),
  };
}
