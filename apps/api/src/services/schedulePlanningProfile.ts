export type RoofKind = "sheet" | "slab" | "unknown";

export type PlanningTrade =
  | "earthworks"
  | "structure"
  | "masonry"
  | "mep"
  | "finishes"
  | "roofing"
  | "external";

export const PLANNING_TRADES: PlanningTrade[] = [
  "earthworks",
  "structure",
  "masonry",
  "mep",
  "finishes",
  "roofing",
  "external",
];

export const DEFAULT_ASSUMED_FRONT_COUNT = 1;
export const DEFAULT_FALLBACK_CREW_SIZE = 12;

export type SchedulePlanningZone = {
  id: string;
  label: string;
  /** null = o SIGO distribui uniformemente e marca como hipótese. */
  share: number | null;
};

/** Hipótese de planeamento (chuva/acessibilidade) — não meteorologia adivinhada. */
export type SchedulePlanningAllowance = {
  kind: "rain" | "cyclone_wind" | "heat" | "accessibility";
  month: number;
  /** Código de província MZ ou null = todas as regiões. */
  regionCode: string | null;
  enabled: boolean;
  note: string | null;
};

export type SchedulePlanningProfile = {
  schemaVersion: 1;
  startDate: string;
  /** boq = não decompor além da hierarquia contratual. */
  locationStrategy: "boq" | "floors" | "floors_zones";
  floorLabels: string[];
  /** null = distribuição uniforme assumida. Valores 0..1 = distribuição informada. */
  floorShares: number[] | null;
  zones: SchedulePlanningZone[];
  sequencePolicy: "floor_by_floor" | "structure_complete_first";
  tradeFronts: Record<PlanningTrade, number | null>;
  /** null = usar fallback técnico e sinalizar no preview. */
  crewSizes: Record<PlanningTrade, number | null>;
  cureLags: {
    foundations: number | null;
    columns: number | null;
    slabs: number | null;
  };
  roofKindOverride: Exclude<RoofKind, "unknown"> | null;
  targetDurationDays: number | null;
  notes: string | null;
  /** Allowances configuráveis por mês/região — hipóteses de risco climático/logístico. */
  planningAllowances: SchedulePlanningAllowance[];
};

export type PlanningContext = {
  floors: number;
  floorLabels: string[];
  configuredFloors?: number;
  floorSource?: "project" | "plant" | "combined";
  measuredItemCount: number;
  classifiedItemCount: number;
  unclassifiedItemCount: number;
  hasSigoTemplate: boolean;
  hasImportedScope: boolean;
  supportsFloorPlanning: boolean;
  detectedRoofKind: RoofKind;
  hasStructure: boolean;
  hasMasonry: boolean;
  hasMep: boolean;
  hasFinishes: boolean;
  hasRoof: boolean;
  hasExternal: boolean;
  activeTrades: PlanningTrade[];
  /** Códigos medidos cujo volume está agregado e pode ser repartido por localização. */
  aggregatedFloorCodes: string[];
  /** Recursos estruturais agregados que não podem ser inventados por elemento. */
  aggregatedStructuralCodes: string[];
};

export type PlanningQuestion = {
  key: string;
  group: "organizacao" | "recursos" | "sequencia" | "prazo";
  label: string;
  help: string;
  required: boolean;
  kind: "choice" | "integer" | "floor_labels" | "shares" | "zones" | "trade_matrix" | "lags" | "notice";
  options?: Array<{ value: string; label: string }>;
};

/**
 * Capacidade recomendada por especialidade. Não multiplica equipas sem necessidade: cria uma
 * linha de balanço em que cada especialidade pode ocupar várias localizações em paralelo quando
 * a dimensão vertical da obra o justifica.
 */
export function recommendedTradeFronts(context: Pick<PlanningContext, "floors">): Record<PlanningTrade, number | null> {
  const floors = Math.max(1, Math.round(context.floors));
  return {
    earthworks: floors >= 8 ? 2 : 1,
    structure: floors >= 7 ? 2 : 1,
    masonry: floors >= 9 ? 3 : floors >= 4 ? 2 : 1,
    mep: floors >= 8 ? 3 : floors >= 3 ? 2 : 1,
    finishes: floors >= 8 ? 3 : floors >= 3 ? 2 : 1,
    roofing: 1,
    external: floors >= 6 ? 2 : 1,
  };
}

const DEFAULT_CREWS: Record<PlanningTrade, number | null> = {
  earthworks: 6,
  structure: 10,
  masonry: 6,
  mep: 4,
  finishes: 6,
  roofing: 6,
  external: 5,
};

export function defaultSchedulePlanningProfile(context: PlanningContext, startDate: string): SchedulePlanningProfile {
  return {
    schemaVersion: 1,
    startDate,
    locationStrategy: context.supportsFloorPlanning ? "floors" : "boq",
    floorLabels: context.floorLabels,
    // null é deliberado: uniforme é uma hipótese, não uma resposta do cliente.
    floorShares: context.floors === 1 ? [1] : null,
    zones: [],
    sequencePolicy: "floor_by_floor",
    tradeFronts: recommendedTradeFronts(context),
    crewSizes: { ...DEFAULT_CREWS },
    cureLags: { foundations: null, columns: null, slabs: null },
    roofKindOverride: context.detectedRoofKind === "unknown" ? null : context.detectedRoofKind,
    targetDurationDays: null,
    notes: null,
    planningAllowances: [],
  };
}

export function mergeSchedulePlanningProfile(
  context: PlanningContext,
  startDate: string,
  saved: Partial<SchedulePlanningProfile> | null | undefined,
): SchedulePlanningProfile {
  const base = defaultSchedulePlanningProfile(context, startDate);
  if (!saved || saved.schemaVersion !== 1) return base;

  const floorLabels = Array.isArray(saved.floorLabels) && saved.floorLabels.length === context.floors
    ? saved.floorLabels.map((label, index) => String(label || context.floorLabels[index]))
    : base.floorLabels;
  const floorShares = Array.isArray(saved.floorShares) && saved.floorShares.length === context.floors
    ? saved.floorShares.map(Number)
    : saved.floorShares === null
      ? null
      : base.floorShares;

  return {
    ...base,
    ...saved,
    schemaVersion: 1,
    startDate: startDate || saved.startDate || base.startDate,
    // A criação simplificada usa sempre a localização segura detectada no projecto/plantas.
    locationStrategy: base.locationStrategy,
    floorLabels,
    floorShares,
    zones: [],
    // As frentes são recalculadas quando as plantas/medições alteram o número de pisos. Como o
    // assistente simplificado já não pergunta por equipas, não reutilizamos silenciosamente uma
    // capacidade antiga que poderia serializar uma obra entretanto ampliada.
    tradeFronts: base.tradeFronts,
    crewSizes: { ...base.crewSizes, ...(saved.crewSizes ?? {}) },
    cureLags: { ...base.cureLags, ...(saved.cureLags ?? {}) },
    planningAllowances: Array.isArray(saved.planningAllowances)
      ? saved.planningAllowances.map((entry) => ({
          kind: entry.kind ?? "rain",
          month: Number(entry.month),
          regionCode: entry.regionCode ?? null,
          enabled: Boolean(entry.enabled),
          note: entry.note ?? null,
        }))
      : base.planningAllowances,
  };
}

function closeEnoughToOne(values: number[]) {
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 0.0001;
}

export function validateSchedulePlanningProfile(profile: SchedulePlanningProfile, context: PlanningContext): string[] {
  const errors: string[] = [];
  if (profile.schemaVersion !== 1) errors.push("Versão do perfil de planeamento não suportada.");
  if (!profile.startDate) errors.push("Indique a data de início planeada.");
  if (profile.floorLabels.length !== context.floors) errors.push(`O perfil deve conter ${context.floors} piso(s).`);
  if (profile.floorLabels.some((label) => !label.trim())) errors.push("Cada piso/nível deve ter uma designação.");
  if (profile.floorShares) {
    if (profile.floorShares.length !== context.floors) errors.push(`A distribuição deve conter ${context.floors} fracção(ões) de piso.`);
    if (profile.floorShares.some((share) => !Number.isFinite(share) || share < 0)) errors.push("As fracções por piso não podem ser negativas.");
    if (!closeEnoughToOne(profile.floorShares)) errors.push("As fracções por piso devem somar exactamente 100%.");
  }
  if (profile.locationStrategy === "floors_zones") {
    if (!profile.zones.length) errors.push("Adicione pelo menos uma zona/frente física.");
    if (profile.zones.some((zone) => !zone.label.trim())) errors.push("Cada zona deve ter um nome.");
    const zoneShares = profile.zones.map((zone) => zone.share);
    const informed = zoneShares.some((share) => share !== null);
    if (informed) {
      if (zoneShares.some((share) => share === null || !Number.isFinite(share) || (share ?? 0) <= 0)) {
        errors.push("Quando informar percentagens por zona, todas as zonas devem ter uma fracção positiva.");
      } else if (!closeEnoughToOne(zoneShares as number[])) {
        errors.push("As fracções das zonas devem somar exactamente 100%.");
      }
    }
  }
  for (const [trade, fronts] of Object.entries(profile.tradeFronts)) {
    if (fronts !== null && (!Number.isInteger(fronts) || fronts < 1 || fronts > 20)) errors.push(`Número de frentes inválido em ${trade}.`);
  }
  for (const [trade, crew] of Object.entries(profile.crewSizes)) {
    if (crew !== null && (!Number.isInteger(crew) || crew < 1 || crew > 60)) errors.push(`Equipa inválida em ${trade}.`);
  }
  for (const [label, lag] of Object.entries(profile.cureLags)) {
    if (lag !== null && (!Number.isInteger(lag) || lag < 0 || lag > 60)) errors.push(`Tempo tecnológico inválido em ${label}.`);
  }
  if (profile.targetDurationDays !== null && (!Number.isInteger(profile.targetDurationDays) || profile.targetDurationDays < 7 || profile.targetDurationDays > 3650)) {
    errors.push("O prazo contratual deve estar entre 7 e 3650 dias úteis.");
  }
  if (profile.roofKindOverride && context.detectedRoofKind !== "unknown" && profile.roofKindOverride !== context.detectedRoofKind) {
    errors.push("A tipologia de cobertura indicada contradiz os itens medidos do Mapa de Quantidades.");
  }
  if (!context.supportsFloorPlanning && profile.locationStrategy !== "boq") {
    errors.push("Este mapa não tem metadados estruturados suficientes para uma repartição automática por piso/zona; preserve a organização do BOQ.");
  }
  for (const allowance of profile.planningAllowances) {
    if (!Number.isInteger(allowance.month) || allowance.month < 1 || allowance.month > 12) {
      errors.push("Cada allowance de planeamento deve indicar um mês válido (1–12).");
    }
    if (allowance.regionCode && !/^[A-Z]{2}$/.test(allowance.regionCode)) {
      errors.push("Código de região inválido no allowance de planeamento.");
    }
  }
  return errors;
}

export function buildPlanningQuestions(context: PlanningContext): PlanningQuestion[] {
  const questions: PlanningQuestion[] = [];
  if (context.supportsFloorPlanning) {
    questions.push({
      key: "floorLabels",
      group: "organizacao",
      label: context.floors > 1 ? "Confirme os pisos da obra" : "Confirme o nível da obra",
      help: "O SIGO usa estes nomes para separar correctamente estrutura, alvenarias, instalações e acabamentos.",
      required: true,
      kind: "floor_labels",
    });
  }

  if (context.floors > 1 && context.supportsFloorPlanning && (context.hasStructure || context.hasMasonry || context.hasMep || context.hasFinishes)) {
    questions.push({
      key: "sequencePolicy",
      group: "sequencia",
      label: "A obra avança piso a piso ou fecha primeiro a estrutura?",
      help: "Piso a piso permite iniciar alvenarias/instalações inferiores quando o suporte desse piso está disponível.",
      required: true,
      kind: "choice",
      options: [
        { value: "floor_by_floor", label: "Avançar piso a piso" },
        { value: "structure_complete_first", label: "Concluir toda a estrutura primeiro" },
      ],
    });
  }
  // Equipas, frentes, curas e distribuição recebem padrões técnicos auditáveis. Esses detalhes
  // continuam editáveis na grelha, sem transformar a criação do cronograma num questionário.
  return questions.slice(0, 2);
}
