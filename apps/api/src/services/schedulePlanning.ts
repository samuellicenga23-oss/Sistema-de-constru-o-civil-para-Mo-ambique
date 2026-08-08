export type DurationBasis = "horas" | "valor" | "minimo";
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
    | "UNMAPPED_STANDARD_ITEM"
    | "GENERIC_STRUCTURAL_RESOURCE"
    | "UNIFORM_FLOOR_DISTRIBUTION"
    | "IMPORTED_SCOPE_PRESERVED"
    | "CUSTOM_BOQ_HIERARCHY_PRESERVED"
    | "TARGET_DURATION_UNREACHABLE";
  message: string;
  sourceCode?: string | null;
  activityName?: string;
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
  durationDays: number;
  assumptions: string[];
};

const DAY_MS = 86_400_000;
// Lags em DIAS ÚTEIS (calendário segunda–sábado). São restrições de cura/ganho inicial de
// resistência, não tarefas fictícias: não têm quantidade nem valor próprio no BOQ.
const FOUNDATION_CURE_LAG_DAYS = 2;
const COLUMN_CURE_LAG_DAYS = 1;
const SLAB_CURE_LAG_DAYS = 6;

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

type FloorScope = "project" | "floor" | "deck" | "roof";

type StandardRule = {
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
const STANDARD_RULES: Record<string, StandardRule> = {
  "1.1": { scope: "project", stage: "prelim" },
  "1.2": { scope: "project", stage: "prelim" },
  "1.3": { scope: "project", stage: "prelim" },
  "2.1": { scope: "project", stage: "earth" },
  "2.2": { scope: "project", stage: "earth" },
  "2.3": { scope: "project", stage: "earth" },
  "2.4": { scope: "project", stage: "earth" },
  "2.5": { scope: "project", stage: "earth" },
  "3.1": { scope: "project", stage: "foundation" },
  "3.2": { scope: "project", stage: "foundation" },
  "3.3": { scope: "floor", stage: "structure" },
  "3.4": { scope: "floor", stage: "structure" },
  "3.5": { scope: "deck", stage: "structure" },
  "3.6": { scope: "project", stage: "structure" },
  "3.7": { scope: "roof", stage: "structure" },
  "3.8": { scope: "project", stage: "structure" },
  "4.1": { scope: "floor", stage: "masonry" },
  "4.2": { scope: "floor", stage: "masonry" },
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
  const total = Math.max(1, Math.round(totalDays));
  if (parts <= 1) return [total];
  if (total < parts) return null;
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

function roofKindFromMeasuredCodes(leaves: PlanningSourceNode[]): "sheet" | "slab" | "unknown" {
  const positiveCodes = new Set(leaves.filter(measuredLeaf).map((leaf) => leaf.code).filter((code): code is string => Boolean(code)));
  if (positiveCodes.has("10.2")) return "sheet";
  // 3.7 é Malhasol de cobertura no template padrão (o Quick Estimate só o mede em cobertura plana).
  if (positiveCodes.has("10.1") || positiveCodes.has("3.7")) return "slab";
  return "unknown";
}

function makeActivity(
  source: PlanningSourceNode,
  key: string,
  name: string,
  durationDays: number,
  valueShare: number,
  floorIndex: number | null,
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
    children,
    startDate: "",
    endDate: "",
    sortOrder: 0,
  };
}

function buildFallbackNode(node: PlanningSourceNode, path: string): PlannedNode | null {
  if (node.kind === "nota") return null;
  if (node.kind === "item") {
    if (!measuredLeaf(node)) return null;
    return makeActivity(node, `src:${node.id}`, node.name, node.durationDays, 1, null);
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
): PlannedNode[] {
  let locations: Array<{ floorIndex: number | null; label: string }> = [{ floorIndex: null, label: "" }];
  if (rule.scope === "floor") {
    locations = Array.from({ length: floors }, (_, floorIndex) => ({ floorIndex, label: ` — Piso ${floorIndex}` }));
  } else if (rule.scope === "deck") {
    const deckCount = Math.max(0, floors - 1 + (roofKind === "slab" ? 1 : 0));
    locations = deckCount > 0
      ? Array.from({ length: deckCount }, (_, floorIndex) => ({
          floorIndex,
          label: roofKind === "slab" && floorIndex === deckCount - 1 ? " — Cobertura" : ` — Piso ${floorIndex}`,
        }))
      : [{ floorIndex: null, label: "" }];
  } else if (rule.scope === "roof") {
    locations = [{ floorIndex: floors - 1, label: " — Cobertura" }];
  }

  if (locations.length === 1) {
    return [makeActivity(source, `src:${source.id}`, `${source.name}${locations[0].label}`, source.durationDays, 1, locations[0].floorIndex)];
  }

  const durations = allocateDuration(source.durationDays, locations.length);
  if (!durations) {
    warnings.push({
      code: "UNSPLIT_FLOOR_ACTIVITY",
      sourceCode: source.code,
      activityName: source.name,
      message: `${source.code ?? "Item"} — ${source.name}: ${source.durationDays} dia(s) não permitem repartir por ${locations.length} frente(s) sem inflacionar a duração; o item foi mantido como pacote único.`,
    });
    return [makeActivity(source, `src:${source.id}`, source.name, source.durationDays, 1, null)];
  }

  const shares = allocateExactShares(locations.length);
  warnings.push({
    code: "UNIFORM_FLOOR_DISTRIBUTION",
    sourceCode: source.code,
    activityName: source.name,
    message: `${source.code ?? "Item"} — ${source.name}: o BOQ agrega ${locations.length} localizações. Sem medição por piso/zona, o SIGO distribuiu quantidade/valor uniformemente apenas para planeamento; as fracções fecham exactamente em 100%.`,
  });
  return locations.map((location, index) => makeActivity(
    source,
    `src:${source.id}:loc:${location.floorIndex ?? index}`,
    `${source.name}${location.label}`,
    durations[index],
    shares[index],
    location.floorIndex,
  ));
}

function buildStandardChapter(
  root: PlanningSourceNode,
  floors: number,
  roofKind: "sheet" | "slab" | "unknown",
  warnings: PlanningWarning[],
): PlannedNode | null {
  if (!hasMeasuredDescendant(root)) return null;
  // O template SIGO padrão é capítulo → itens. Se houver grupos personalizados, preservamos
  // esses grupos em vez de reinterpretá-los como pisos por texto.
  if (root.children.some((child) => child.kind === "grupo")) return buildFallbackNode(root, root.code ?? "root");

  const directActivities: PlannedNode[] = [];
  const floorBuckets = new Map<number, PlannedNode[]>();
  let roofBucket: PlannedNode[] = [];

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
    const activities = splitLeafByRule(child, rule, floors, roofKind, warnings);
    for (const activity of activities) {
      if (rule.scope === "roof") {
        roofBucket.push(activity);
      } else if (activity.floorIndex !== null && (rule.scope === "floor" || rule.scope === "deck")) {
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
  for (const floorIndex of [...floorBuckets.keys()].sort((a, b) => a - b)) {
    const bucket = floorBuckets.get(floorIndex)!;
    children.push(makeSummary(
      `group:${root.id}:floor:${floorIndex}`,
      `${groupLabel ?? root.name} — Piso ${floorIndex}`,
      null,
      bucket,
    ));
  }
  if (roofBucket.length) {
    children.push(makeSummary(`group:${root.id}:roof`, `${groupLabel ?? root.name} — Cobertura`, null, roofBucket));
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

function previousMeasuredActivityInTree(root: PlannedNode, targetKey: string): PlannedNode | null {
  const activities = flattenNodes([root]).filter((node) => node.kind === "activity");
  const index = activities.findIndex((node) => node.key === targetKey);
  return index > 0 ? activities[index - 1] : null;
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

function buildStandardDependencies(roots: PlannedNode[], floors: number, roofKind: "sheet" | "slab" | "unknown"): PlannedDependency[] {
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
  const one = (code: string) => byCode.get(code)?.[0] ?? null;
  const atFloor = (code: string, floor: number) => {
    const exact = byCode.get(code)?.find((node) => node.floorIndex === floor);
    if (exact) return exact;
    if (floors === 1) return byCode.get(code)?.find((node) => node.floorIndex === null) ?? null;
    return null;
  };
  const preferredExisting = (...nodes: Array<PlannedNode | null | undefined>) => nodes.find(Boolean) as PlannedNode | undefined;
  const firstExisting = (...nodes: Array<PlannedNode | null | undefined>) => nodes.find(Boolean) as PlannedNode | undefined;

  // Preliminares e arranque de fundações: sequência contratual exacta do template.
  addUniqueDependency(deps, seen, one("1.1"), one("1.2"));
  addUniqueDependency(deps, seen, preferredExisting(one("1.2"), one("1.1")), one("1.3"));
  const prelimEnd = preferredExisting(one("1.3"), one("1.2"), one("1.1"));
  addUniqueDependency(deps, seen, prelimEnd, one("2.1"));
  addUniqueDependency(deps, seen, preferredExisting(one("2.1"), prelimEnd), one("3.1"));
  addUniqueDependency(deps, seen, preferredExisting(one("3.1"), one("2.1"), prelimEnd), one("3.2"));

  // Reaterros/base do pavimento podem avançar depois das fundações, em paralelo com a superestrutura.
  let earthCursor = preferredExisting(one("3.2"), one("3.1"), one("2.1"));
  for (const code of ["2.2", "2.3", "2.4", "2.5"]) {
    const task = one(code);
    addUniqueDependency(deps, seen, earthCursor, task);
    if (task) earthCursor = task;
  }

  // Aço/malha/cofragem genéricos do template são pacotes transversais: iniciam com a estrutura,
  // mas NÃO são fingidos como aço/cofragem de cada elemento porque o BOQ não fornece essa repartição.
  const structuralStart = preferredExisting(one("3.1"), one("2.1"), prelimEnd);
  for (const code of ["3.6", "3.8"]) addUniqueDependency(deps, seen, structuralStart, one(code), "SS", 0);

  const foundationEnd = preferredExisting(one("3.2"), one("3.1"), one("2.1"), prelimEnd);
  const deckCount = Math.max(0, floors - 1 + (roofKind === "slab" ? 1 : 0));
  for (let floor = 0; floor < floors; floor++) {
    const columns = atFloor("3.3", floor);
    const beams = atFloor("3.4", floor);
    const slab = floor < deckCount ? atFloor("3.5", floor) : null;
    if (floor === 0) addUniqueDependency(deps, seen, foundationEnd, columns, "FS", one("3.2") ? FOUNDATION_CURE_LAG_DAYS : 0);
    else addUniqueDependency(deps, seen, atFloor("3.5", floor - 1) ?? atFloor("3.4", floor - 1), columns, "FS", atFloor("3.5", floor - 1) ? SLAB_CURE_LAG_DAYS : 0);
    addUniqueDependency(deps, seen, columns ?? (floor === 0 ? foundationEnd : null), beams, "FS", columns ? COLUMN_CURE_LAG_DAYS : 0);
    addUniqueDependency(deps, seen, beams ?? columns, slab);

    const structureEnd = slab ?? beams ?? columns ?? (floor === 0 ? foundationEnd : null);
    const masonry = [atFloor("4.1", floor), atFloor("4.2", floor)].filter(Boolean) as PlannedNode[];
    if (masonry[0]) addUniqueDependency(deps, seen, structureEnd, masonry[0]);
    if (masonry[1]) addUniqueDependency(deps, seen, masonry[0] ?? structureEnd, masonry[1]);
    const masonryEnd = masonry.at(-1) ?? structureEnd;

    const mepRough = ["8.1", "8.2", "11.6", "13.2", "13.3"]
      .map((code) => atFloor(code, floor))
      .filter(Boolean) as PlannedNode[];
    for (const task of mepRough) addUniqueDependency(deps, seen, masonryEnd, task);

    const lintels = atFloor("15.4", floor);
    addUniqueDependency(deps, seen, masonryEnd, lintels);

    const roughEnds = [...mepRough, lintels].filter(Boolean);
    const plasterInterior = atFloor("5.2", floor);
    const plasterExterior = atFloor("5.3", floor);
    const screed = atFloor("5.1", floor);
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

    const floorTile = atFloor("6.1", floor);
    const wallTile = atFloor("6.2", floor);
    addUniqueDependency(deps, seen, screed ?? masonryEnd, floorTile);
    addUniqueDependency(deps, seen, plasterInterior ?? masonryEnd, wallTile);

    const windows = atFloor("15.3", floor);
    const doorsInterior = atFloor("15.1", floor);
    const doorsExterior = atFloor("15.2", floor);
    addUniqueDependency(deps, seen, preferredExisting(plasterExterior, plasterInterior, masonryEnd), windows);
    addUniqueDependency(deps, seen, preferredExisting(plasterInterior, masonryEnd), doorsInterior);
    addUniqueDependency(deps, seen, preferredExisting(plasterExterior, plasterInterior, masonryEnd), doorsExterior);

    const paintExterior = atFloor("7.1", floor);
    const paintInterior = atFloor("7.2", floor);
    const paintCeiling = atFloor("7.3", floor);
    addUniqueDependency(deps, seen, preferredExisting(windows, plasterExterior, masonryEnd), paintExterior);
    for (const predecessor of [plasterInterior, wallTile, doorsInterior].filter(Boolean) as PlannedNode[]) addUniqueDependency(deps, seen, predecessor, paintInterior);
    addUniqueDependency(deps, seen, plasterInterior ?? masonryEnd, paintCeiling);

    const fixtureGate = preferredExisting(paintInterior, wallTile, floorTile, plasterInterior, masonryEnd);
    for (const code of ["11.1", "11.2", "11.3", "11.4", "11.5"]) addUniqueDependency(deps, seen, fixtureGate, atFloor(code, floor));
  }

  // Como 3.6/3.8 são linhas agregadas, não fingimos qual parcela pertence a cada elemento.
  // 3.7 é Malhasol de cobertura e tem sequência própria abaixo. O último elemento estrutural não
  // pode terminar antes dos pacotes transversais genéricos.
  const finalStructural = preferredExisting(
    roofKind === "slab" ? atFloor("3.5", Math.max(0, deckCount - 1)) : null,
    atFloor("3.5", Math.max(0, deckCount - 1)),
    atFloor("3.4", floors - 1),
    atFloor("3.3", floors - 1),
    foundationEnd,
  );
  for (const code of ["3.6", "3.8"]) addUniqueDependency(deps, seen, one(code), finalStructural, "FF", 0);
  if (roofKind === "slab") {
    const roofMesh = one("3.7");
    const roofSlab = atFloor("3.5", Math.max(0, deckCount - 1));
    const roofBeams = atFloor("3.4", floors - 1);
    addUniqueDependency(deps, seen, roofBeams ?? atFloor("3.3", floors - 1), roofMesh);
    addUniqueDependency(deps, seen, roofMesh, roofSlab);
  }

  // Cobertura: exactamente os itens medidos. Chapa respeita impermeabilização → chapa → remates.
  const topStructure = roofKind === "slab"
    ? atFloor("3.5", Math.max(0, deckCount - 1))
    : preferredExisting(
        atFloor("4.2", floors - 1),
        atFloor("4.1", floors - 1),
        atFloor("3.4", floors - 1),
        atFloor("3.3", floors - 1),
        foundationEnd,
      );
  const roof10_1 = one("10.1");
  const roof10_2 = one("10.2");
  const roof10_3 = one("10.3");
  const firstRoof = firstExisting(roof10_1, roof10_2, roof10_3);
  addUniqueDependency(
    deps,
    seen,
    topStructure,
    firstRoof,
    "FS",
    roofKind === "slab" && topStructure?.sourceCode === "3.5" ? SLAB_CURE_LAG_DAYS : 0,
  );
  addUniqueDependency(deps, seen, roof10_1, roof10_2);
  addUniqueDependency(deps, seen, roof10_2 ?? roof10_1, roof10_3);
  const roofEnd = preferredExisting(roof10_3, roof10_2, roof10_1, topStructure);
  // Em edifícios de um piso, as instalações embutidas arrancam depois de a envolvente/cobertura
  // estar protegida. Em multi-piso, os pisos inferiores podem avançar enquanto a cobertura fecha.
  if (floors === 1 && (roof10_1 || roof10_2 || roof10_3)) {
    for (const code of ["8.1", "8.2", "11.6", "13.2", "13.3"]) addUniqueDependency(deps, seen, roofEnd, atFloor(code, 0));
  }
  addUniqueDependency(deps, seen, roofEnd, one("9.1"));
  addUniqueDependency(deps, seen, roofEnd, one("11.7"));

  // Saneamento autónomo e rede de terra são frentes externas: depois da escavação/fundações,
  // sem obrigar a parar a superestrutura.
  addUniqueDependency(deps, seen, one("2.1") ?? prelimEnd, one("12.1"));
  addUniqueDependency(deps, seen, one("12.1"), one("12.2"));
  addUniqueDependency(deps, seen, foundationEnd, one("13.4"));
  addUniqueDependency(deps, seen, preferredExisting(one("8.2"), one("8.1"), foundationEnd), one("8.3"));

  // Quadro final depois da distribuição eléctrica e dos acabamentos interiores existentes.
  const electricalRough = [...(byCode.get("13.2") ?? []), ...(byCode.get("13.3") ?? [])];
  const interiorPaint = byCode.get("7.2") ?? [];
  for (const predecessor of [...electricalRough, ...interiorPaint]) addUniqueDependency(deps, seen, predecessor, one("13.1"));

  // Itens do template sem regra de precedência explícita ficam na ordem do próprio capítulo,
  // e capítulos desconhecidos encadeiam pelo mapa. Isto é o fallback auditável, não heurístico.
  const targeted = new Set(deps.map((dep) => dep.successorKey));
  let previousRootLast: PlannedNode | null = null;
  for (const root of roots) {
    const rootActivities = flattenNodes([root]).filter((node) => node.kind === "activity");
    for (const activity of rootActivities) {
      if (targeted.has(activity.key)) continue;
      const previousInChapter = previousMeasuredActivityInTree(root, activity.key);
      if (previousInChapter) addUniqueDependency(deps, seen, previousInChapter, activity);
      else if (previousRootLast) addUniqueDependency(deps, seen, previousRootLast, activity);
    }
    if (rootActivities.length) previousRootLast = rootActivities.at(-1)!;
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
    if (node.kind === "activity") node.durationDays = Math.max(1, Math.round(node.durationDays * factor));
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
      message: "O BOQ contém aço/cofragem genéricos (3.6/3.8), sem quantidade por sapata/pilar/viga/laje. O SIGO mantém esses pacotes transversais e não inventa repartições por elemento. Para lógica estrutural aço → cofragem → betão por elemento, subdivida essas linhas no Mapa de Quantidades.",
    });
  }
}

export function buildExecutionPlan(args: {
  sections: PlanningSourceSection[];
  floors: number;
  startDate: string;
  totalDurationDays?: number;
}): ExecutionPlan {
  const floors = Math.max(1, Math.min(20, Math.round(args.floors)));
  const warnings: PlanningWarning[] = [];
  const measuredLeaves = flattenMeasuredLeaves(args.sections);
  if (!measuredLeaves.length) throw new Error("O Mapa de Quantidades ainda não tem itens medidos para gerar a WBS");
  const roofKind = roofKindFromMeasuredCodes(measuredLeaves);

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
        message: `${section.name}: mapa sem metadados SIGO de localização. A EAP preserva os grupos/ordem do BOQ e não reparte automaticamente por ${floors} pisos. Para repartir, o mapa deve trazer grupos por piso/zona ou metadados de execução explícitos.`,
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
          message: `${section.name}: foi detectada uma hierarquia personalizada dentro do template SIGO. O motor preservou a árvore e usa a ordem FS do próprio mapa em vez de aplicar dependências padrão a uma estrutura que já não é 1:1 com o template.`,
        });
      }
    }
    for (const root of [...section.roots].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const planned = sigo && root.kind === "capitulo"
        ? buildStandardChapter(root, floors, roofKind, warnings)
        : buildFallbackNode(root, root.code ?? "root");
      if (planned) roots.push(planned);
    }
  }
  if (!roots.length) throw new Error("O Mapa de Quantidades ainda não tem capítulos com quantidade para gerar a WBS");

  assignWbsCodes(roots);
  const dependencies = allMeasuredSectionsSigo && standardGraphSafe
    ? buildStandardDependencies(roots, floors, roofKind)
    : buildFallbackDependencies(roots);
  scheduleDates(roots, dependencies, args.startDate);

  let effectiveRoots = roots;
  if (args.totalDurationDays) {
    const fitted = fitTargetDuration(roots, dependencies, args.startDate, args.totalDurationDays);
    effectiveRoots = fitted.roots;
    if (fitted.achievedDays !== Math.round(args.totalDurationDays)) {
      warnings.push({
        code: "TARGET_DURATION_UNREACHABLE",
        message: `Prazo pedido: ${Math.round(args.totalDurationDays)} dias úteis; menor diferença possível com actividades inteiras e as precedências actuais: ${fitted.achievedDays} dias úteis.`,
      });
    }
  }

  // O fitting clona a árvore; os códigos/sortOrder já estão preservados pelo clone.
  addValidationWarnings(effectiveRoots, warnings);
  addStructuralAuditWarning(args.sections, warnings);
  const span = projectSpan(effectiveRoots);
  return {
    roots: effectiveRoots,
    dependencies,
    warnings,
    roofKind,
    assumptions: [
      "Calendário de obra: segunda-feira a sábado; domingo não útil.",
      `Cura implícita (sem criar tarefa): fundações ${FOUNDATION_CURE_LAG_DAYS} d.u.; pilares ${COLUMN_CURE_LAG_DAYS} d.u.; lajes maciças do template 3.5 ${SLAB_CURE_LAG_DAYS} d.u. antes do piso seguinte/impermeabilização.`,
      "Itens agregados por piso sem medição localizada usam valueShare uniforme, sempre com aviso e fecho exacto de 100%.",
    ],
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
