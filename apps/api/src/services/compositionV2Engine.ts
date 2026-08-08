export type DerivedCostBasis = "materials" | "labour" | "equipment" | "subcompositions" | "direct";

export type CompositionCostParts = {
  materials: number;
  labour: number;
  equipment: number;
  subcompositions: number;
};

export type DerivedCostLine = {
  id?: string;
  name: string;
  basis: DerivedCostBasis;
  percentage: number;
};

export type SubcompositionEdge = {
  compositionId: string;
  subcompositionId: string;
  qtyPerUnit: number;
};

export type CompositionProductivityInput = {
  quantity: number;
  outputPerDay?: number | null;
  productiveHoursPerDay?: number | null;
  labourHoursPerUnit?: number | null;
  crewSize?: number | null;
};

export type CompositionProductivityResult = {
  outputPerHour: number | null;
  outputPerDay: number | null;
  durationDays: number | null;
  basis: "explicit_output" | "labour_hours" | "missing";
};

export function roundCost(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function resolveDerivedCostBase(parts: CompositionCostParts, basis: DerivedCostBasis): number {
  switch (basis) {
    case "materials": return parts.materials;
    case "labour": return parts.labour;
    case "equipment": return parts.equipment;
    case "subcompositions": return parts.subcompositions;
    case "direct": return parts.materials + parts.labour + parts.equipment + parts.subcompositions;
  }
}

export function computeDerivedCosts(parts: CompositionCostParts, lines: DerivedCostLine[]) {
  const details = lines.map((line) => {
    if (!Number.isFinite(line.percentage) || line.percentage < 0 || line.percentage > 1000) {
      throw new Error(`Percentagem inválida em ${line.name}`);
    }
    const base = resolveDerivedCostBase(parts, line.basis);
    const amount = base * line.percentage / 100;
    return { ...line, base: roundCost(base), amount: roundCost(amount) };
  });
  return {
    details,
    total: roundCost(details.reduce((sum, row) => sum + row.amount, 0)),
  };
}

export function assertAcyclicCompositionGraph(rootId: string, edges: SubcompositionEdge[]): void {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (!(edge.qtyPerUnit >= 0) || !Number.isFinite(edge.qtyPerUnit)) throw new Error("Quantidade de subcomposição inválida");
    const list = graph.get(edge.compositionId) ?? [];
    list.push(edge.subcompositionId);
    graph.set(edge.compositionId, list);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  function visit(id: string) {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      const cycle = [...path.slice(Math.max(0, start)), id];
      throw new Error(`Ciclo de subcomposições detectado: ${cycle.join(" → ")}`);
    }
    if (visited.has(id)) return;
    visiting.add(id); path.push(id);
    for (const child of graph.get(id) ?? []) visit(child);
    path.pop(); visiting.delete(id); visited.add(id);
  }
  visit(rootId);
}

export function computeSubcompositionCost(
  compositionId: string,
  edges: SubcompositionEdge[],
  unitCostByComposition: Map<string, number>,
): number {
  const relevant = edges.filter((edge) => edge.compositionId === compositionId);
  return roundCost(relevant.reduce((sum, edge) => {
    const cost = unitCostByComposition.get(edge.subcompositionId);
    if (cost == null || !Number.isFinite(cost)) throw new Error(`Custo da subcomposição ${edge.subcompositionId} indisponível`);
    return sum + edge.qtyPerUnit * cost;
  }, 0));
}

export function computeCompositionProductivity(input: CompositionProductivityInput): CompositionProductivityResult {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error("Quantidade inválida para produtividade");
  const hoursPerDay = Number(input.productiveHoursPerDay ?? 8);
  if (!(hoursPerDay > 0)) throw new Error("Horas produtivas por dia devem ser positivas");

  if (Number(input.outputPerDay) > 0) {
    const outputPerDay = Number(input.outputPerDay);
    return {
      outputPerHour: outputPerDay / hoursPerDay,
      outputPerDay,
      durationDays: input.quantity === 0 ? 0 : input.quantity / outputPerDay,
      basis: "explicit_output",
    };
  }

  if (Number(input.labourHoursPerUnit) > 0 && Number(input.crewSize) > 0) {
    const labourHoursPerUnit = Number(input.labourHoursPerUnit);
    const crewSize = Number(input.crewSize);
    const totalCrewHoursPerDay = crewSize * hoursPerDay;
    const outputPerDay = totalCrewHoursPerDay / labourHoursPerUnit;
    return {
      outputPerHour: outputPerDay / hoursPerDay,
      outputPerDay,
      durationDays: input.quantity === 0 ? 0 : input.quantity / outputPerDay,
      basis: "labour_hours",
    };
  }

  return { outputPerHour: null, outputPerDay: null, durationDays: null, basis: "missing" };
}

export type ResourceIdentityRow = {
  id: string;
  familyKey?: string | null;
  name: string;
  companyId: string | null;
};

/**
 * Resolve recursos por familyKey; nome só é fallback para dados anteriores à migração V2.
 * A versão da empresa tem prioridade sobre a linha global da mesma família.
 */
export function resolveResourcesByIdentity<T extends ResourceIdentityRow>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = row.familyKey || `legacy-name:${row.name.trim().toLocaleLowerCase("pt")}`;
    const current = result.get(key);
    if (!current || (current.companyId === null && row.companyId !== null)) result.set(key, row);
  }
  return result;
}

export type CostSnapshotInput = {
  compositionId: string;
  compositionVersion: number;
  currency: string;
  zoneId?: string | null;
  labourCost: number;
  materialCost: number;
  equipmentCost: number;
  subcompositionCost: number;
  derivedCost: number;
  unitCost: number;
  resourceSnapshot: unknown;
};

export function buildCostSnapshot(input: CostSnapshotInput) {
  return {
    compositionId: input.compositionId,
    compositionVersion: input.compositionVersion,
    currency: input.currency,
    zoneId: input.zoneId ?? null,
    labourCost: roundCost(input.labourCost),
    materialCost: roundCost(input.materialCost),
    equipmentCost: roundCost(input.equipmentCost),
    subcompositionCost: roundCost(input.subcompositionCost),
    derivedCost: roundCost(input.derivedCost),
    unitCost: roundCost(input.unitCost),
    resourceSnapshot: input.resourceSnapshot,
  };
}
