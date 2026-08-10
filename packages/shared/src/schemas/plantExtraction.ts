import { z } from "zod";

// Normalized response returned by the plant-service (`POST /parse`).
export const extractedRoomSchema = z.object({
  name: z.string(),
  number: z.string().nullable(),
  areaM2: z.number().positive(),
  page: z.number().int().positive(),
  floor: z.string().nullable(),
  perimeterM: z.number().positive().nullable().default(null),
});
export type ExtractedRoom = z.infer<typeof extractedRoomSchema>;

export const extractedRebarLineSchema = z.object({
  element: z.string(),
  diameterMm: z.number().positive(),
  weightKg: z.number().nonnegative(),
  page: z.number().int().positive(),
});
export type ExtractedRebarLine = z.infer<typeof extractedRebarLineSchema>;

export const extractedOpeningSchema = z.object({
  kind: z.enum(["porta", "janela"]),
  code: z.string().nullable(),
  designation: z.string().nullable().default(null),
  widthM: z.number().positive().nullable(),
  heightM: z.number().positive().nullable(),
  sillHeightM: z.number().nonnegative().nullable().default(null),
  quantity: z.number().int().positive(),
  floor: z.string().nullable(),
  location: z.enum(["interior", "exterior", "desconhecida"]).default("desconhecida"),
  material: z.string().nullable(),
  page: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["quadro", "geometria", "manual", "ia"]),
  needsConfirmation: z.boolean(),
});
export type ExtractedOpening = z.infer<typeof extractedOpeningSchema>;

export const slabRebarLayerSchema = z.object({
  xDiameterMm: z.number().positive().max(50),
  xSpacingCm: z.number().positive().max(100),
  yDiameterMm: z.number().positive().max(50),
  ySpacingCm: z.number().positive().max(100),
});

export const extractedSlabSchema = z.object({
  name: z.string().trim().max(160).optional(),
  floor: z.string().nullable(),
  areaM2: z.number().positive().optional(),
  thicknessCm: z.number().positive(),
  layers: z.array(z.enum(["inferior", "superior", "geral"])).min(1),
  pages: z.array(z.number().int().positive()).min(1),
  concreteClass: z.string().trim().max(80).nullable().optional(),
  steelGrade: z.string().trim().max(80).nullable().optional(),
  coverCm: z.number().nonnegative().max(20).nullable().optional(),
  topRebar: slabRebarLayerSchema.nullable().optional(),
  bottomRebar: slabRebarLayerSchema.nullable().optional(),
  topSteelWeightKg: z.number().nonnegative().optional().default(0),
  bottomSteelWeightKg: z.number().nonnegative().optional().default(0),
  steelByDiameter: z.record(z.string(), z.number().nonnegative()).optional().default({}),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type ExtractedSlab = z.infer<typeof extractedSlabSchema>;

export const plantMetadataSchema = z.object({
  proprietario: z.string().nullable(),
  fase: z.string().nullable(),
  bairro: z.string().nullable(),
  talhao: z.string().nullable(),
  distrito: z.string().nullable(),
  especialidade: z.string().nullable(),
  conteudo: z.string().nullable(),
  numero: z.string().nullable(),
  escala: z.string().nullable(),
});
export type PlantMetadata = z.infer<typeof plantMetadataSchema>;

/** Vigas agrupadas por laje/piso — medições e orçamento ligam vigas ao respectivo nível. */
export const structuralBeamGroupSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  slabIndex: z.number().int().nonnegative().optional(),
  floor: z.string().nullable().optional(),
  beamsCount: z.number().int().nonnegative(),
  totalLengthM: z.number().nonnegative(),
  avgWidthCm: z.number().nonnegative().default(0),
  avgHeightCm: z.number().nonnegative().default(0),
  steelWeightKg: z.number().nonnegative().default(0),
});
export type StructuralBeamGroup = z.infer<typeof structuralBeamGroupSchema>;

// Resumo estrutural agregado (sapatas/pilares/vigas) extraído de um projecto estrutural
// (CYPE CAD) — usado para pré-preencher o Assistente de Medições sem repetir perguntas.
export const structuralSummarySchema = z.object({
  footingsCount: z.number().int().nonnegative(),
  footingsAvgWidthCm: z.number().nonnegative(),
  footingsAvgLengthCm: z.number().nonnegative(),
  footingsAvgDepthCm: z.number().nonnegative(),
  columnsCount: z.number().int().nonnegative(),
  beamsCount: z.number().int().nonnegative(),
  beamsTotalLengthM: z.number().nonnegative(),
  beamsAvgWidthCm: z.number().nonnegative(),
  beamsAvgHeightCm: z.number().nonnegative(),
  beamsConcreteVolumeM3: z.number().nonnegative(),
  beamGroups: z.array(structuralBeamGroupSchema).default([]),
  staircasesCount: z.number().int().nonnegative(),
  slabsCount: z.number().int().nonnegative(),
  slabsAvgThicknessCm: z.number().nonnegative(),
  slabs: z.array(extractedSlabSchema).default([]),
  // Aço estrutural por família (mapa de aço) — editável no formulário de dados em falta.
  footingsSteelWeightKg: z.number().nonnegative().default(0),
  columnsSteelWeightKg: z.number().nonnegative().default(0),
  beamsSteelWeightKg: z.number().nonnegative().default(0),
  slabsSteelWeightKg: z.number().nonnegative().default(0),
  stairsSteelWeightKg: z.number().nonnegative().default(0),
  totalSteelWeightKg: z.number().nonnegative(),
});

export const extractedStaircaseSchema = z.object({
  element: z.string(),
  widthM: z.number().positive(),
  thicknessM: z.number().positive(),
  stepsCount: z.number().int().positive(),
  riseM: z.number().positive(),
  page: z.number().int().positive(),
});
export type ExtractedStaircase = z.infer<typeof extractedStaircaseSchema>;
export type StructuralSummary = z.infer<typeof structuralSummarySchema>;

/** Arredonda quantidades estruturais para 2 casas decimais (UI e persistência). */
export function roundStructuralQty(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export type ClassifiedStructuralSteel = {
  footingsSteelWeightKg: number;
  columnsSteelWeightKg: number;
  beamsSteelWeightKg: number;
  slabsSteelWeightKg: number;
  stairsSteelWeightKg: number;
  otherSteelWeightKg: number;
  totalSteelWeightKg: number;
};

/** Classifica o mapa de aço por família estrutural a partir do rótulo do elemento. */
export function classifyStructuralSteelWeights(
  lines: Array<{ element: string; weightKg: number }>,
): ClassifiedStructuralSteel {
  let footings = 0;
  let columns = 0;
  let beams = 0;
  let slabs = 0;
  let stairs = 0;
  let other = 0;
  for (const line of lines) {
    const weight = Number(line.weightKg) || 0;
    if (weight <= 0) continue;
    const element = line.element.toLocaleLowerCase("pt");
    if (/sapata|footing|funda[cç]|maci[cç]o|radier/.test(element)) footings += weight;
    else if (
      /pilar|coluna|column|pilarete/.test(element)
      || /(?:^|[\s,;])p\d+(?:\s*=\s*p\d+)*(?=$|[\s,;/])/.test(element)
    ) columns += weight;
    else if (/escada|staircase|\bstair\b/.test(element)) stairs += weight;
    else if (/viga|p[oó]rtico|beam|lintel/.test(element)) beams += weight;
    else if (/laje|cobertura|armadura longitudinal|slab|malha/.test(element)) slabs += weight;
    else other += weight;
  }
  const total = footings + columns + beams + slabs + stairs + other;
  return {
    footingsSteelWeightKg: roundStructuralQty(footings),
    columnsSteelWeightKg: roundStructuralQty(columns),
    beamsSteelWeightKg: roundStructuralQty(beams),
    slabsSteelWeightKg: roundStructuralQty(slabs),
    stairsSteelWeightKg: roundStructuralQty(stairs),
    otherSteelWeightKg: roundStructuralQty(other),
    totalSteelWeightKg: roundStructuralQty(total),
  };
}

export type StructuralSteelFamilyKey = "footings" | "columns" | "beams" | "slabs" | "stairs" | "other";

/** Classifica um rótulo de mapa de aço na família estrutural correspondente. */
export function structuralSteelFamilyOf(element: string): StructuralSteelFamilyKey {
  const value = element.toLocaleLowerCase("pt");
  if (/sapata|footing|funda[cç]|maci[cç]o|radier/.test(value)) return "footings";
  if (
    /pilar|coluna|column|pilarete/.test(value)
    || /(?:^|[\s,;])p\d+(?:\s*=\s*p\d+)*(?=$|[\s,;/])/.test(value)
  ) return "columns";
  if (/escada|staircase|\bstair\b/.test(value)) return "stairs";
  if (/viga|p[oó]rtico|beam|lintel/.test(value)) return "beams";
  if (/laje|cobertura|armadura longitudinal|slab|malha/.test(value)) return "slabs";
  return "other";
}

/** Aço por família e diâmetro (Ø6/8/10/12/16…) a partir do mapa extraído. */
export function steelWeightsByFamilyAndDiameter(
  lines: Array<{ element: string; diameterMm: number; weightKg: number }>,
): Record<StructuralSteelFamilyKey, Array<{ diameterMm: number; weightKg: number }>> {
  const buckets: Record<StructuralSteelFamilyKey, Map<number, number>> = {
    footings: new Map(),
    columns: new Map(),
    beams: new Map(),
    slabs: new Map(),
    stairs: new Map(),
    other: new Map(),
  };
  for (const line of lines) {
    const weight = Number(line.weightKg) || 0;
    const diameter = Math.round(Number(line.diameterMm) || 0);
    if (weight <= 0 || diameter <= 0) continue;
    const family = structuralSteelFamilyOf(line.element);
    buckets[family].set(diameter, (buckets[family].get(diameter) ?? 0) + weight);
  }
  const toRows = (map: Map<number, number>) =>
    [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([diameterMm, weightKg]) => ({ diameterMm, weightKg: roundStructuralQty(weightKg) }));
  return {
    footings: toRows(buckets.footings),
    columns: toRows(buckets.columns),
    beams: toRows(buckets.beams),
    slabs: toRows(buckets.slabs),
    stairs: toRows(buckets.stairs),
    other: toRows(buckets.other),
  };
}

export function formatSteelDiameterBreakdown(
  rows: Array<{ diameterMm: number; weightKg: number }>,
  emptyLabel = "Sem mapa por diâmetro neste elemento",
): string {
  if (!rows.length) return emptyLabel;
  return rows
    .map((row) => `Ø${row.diameterMm}: ${roundStructuralQty(row.weightKg).toFixed(2)} kg`)
    .join(" · ");
}

/** Cria / sincroniza grupos «Vigas da Laje N» a partir das lajes conhecidas. */
export function ensureBeamGroupsForSlabs(
  summary: {
    beamGroups?: StructuralBeamGroup[] | null;
    beamsCount: number;
    beamsTotalLengthM: number;
    beamsAvgWidthCm: number;
    beamsAvgHeightCm: number;
    beamsSteelWeightKg?: number;
  },
  slabs: Array<{ name?: string | null; floor?: string | null }>,
): StructuralBeamGroup[] {
  const existing = summary.beamGroups ?? [];
  if (existing.length > 0) {
    return existing.map((group, index) => ({
      ...group,
      id: group.id ?? `beam-group-${index}`,
      label: group.label || `Vigas da Laje ${index + 1}`,
      avgWidthCm: roundStructuralQty(group.avgWidthCm ?? summary.beamsAvgWidthCm ?? 0),
      avgHeightCm: roundStructuralQty(group.avgHeightCm ?? summary.beamsAvgHeightCm ?? 0),
      totalLengthM: roundStructuralQty(group.totalLengthM),
      steelWeightKg: roundStructuralQty(group.steelWeightKg ?? 0),
    }));
  }
  if (slabs.length > 0) {
    return slabs.map((slab, index) => {
      const slabLabel = (slab.name || slab.floor || `Laje ${index + 1}`).trim();
      return {
        id: `beam-group-${index}`,
        label: `Vigas da ${slabLabel}`,
        slabIndex: index,
        floor: slab.floor ?? null,
        beamsCount: index === 0 ? summary.beamsCount : 0,
        totalLengthM: index === 0 ? roundStructuralQty(summary.beamsTotalLengthM) : 0,
        avgWidthCm: roundStructuralQty(summary.beamsAvgWidthCm),
        avgHeightCm: roundStructuralQty(summary.beamsAvgHeightCm),
        steelWeightKg: index === 0 ? roundStructuralQty(summary.beamsSteelWeightKg ?? 0) : 0,
      };
    });
  }
  if (summary.beamsCount > 0 || summary.beamsTotalLengthM > 0 || (summary.beamsSteelWeightKg ?? 0) > 0) {
    return [{
      id: "beam-group-0",
      label: "Vigas gerais",
      beamsCount: summary.beamsCount,
      totalLengthM: roundStructuralQty(summary.beamsTotalLengthM),
      avgWidthCm: roundStructuralQty(summary.beamsAvgWidthCm),
      avgHeightCm: roundStructuralQty(summary.beamsAvgHeightCm),
      steelWeightKg: roundStructuralQty(summary.beamsSteelWeightKg ?? 0),
    }];
  }
  return [];
}

export function syncBeamAggregatesFromGroups(groups: StructuralBeamGroup[]): {
  beamsCount: number;
  beamsTotalLengthM: number;
  beamsAvgWidthCm: number;
  beamsAvgHeightCm: number;
  beamsConcreteVolumeM3: number;
  beamsSteelWeightKg: number;
} {
  const beamsCount = groups.reduce((sum, group) => sum + group.beamsCount, 0);
  const beamsTotalLengthM = roundStructuralQty(groups.reduce((sum, group) => sum + group.totalLengthM, 0));
  const beamsSteelWeightKg = roundStructuralQty(groups.reduce((sum, group) => sum + Number(group.steelWeightKg ?? 0), 0));
  const lengthWeightedWidth = groups.reduce((sum, group) => sum + group.totalLengthM * Number(group.avgWidthCm ?? 0), 0);
  const lengthWeightedHeight = groups.reduce((sum, group) => sum + group.totalLengthM * Number(group.avgHeightCm ?? 0), 0);
  const beamsAvgWidthCm = beamsTotalLengthM > 0
    ? roundStructuralQty(lengthWeightedWidth / beamsTotalLengthM)
    : roundStructuralQty(groups[0]?.avgWidthCm ?? 0);
  const beamsAvgHeightCm = beamsTotalLengthM > 0
    ? roundStructuralQty(lengthWeightedHeight / beamsTotalLengthM)
    : roundStructuralQty(groups[0]?.avgHeightCm ?? 0);
  const beamsConcreteVolumeM3 = roundStructuralQty(
    groups.reduce(
      (sum, group) => sum + group.totalLengthM * (Number(group.avgWidthCm ?? 0) / 100) * (Number(group.avgHeightCm ?? 0) / 100),
      0,
    ),
  );
  return {
    beamsCount,
    beamsTotalLengthM,
    beamsAvgWidthCm,
    beamsAvgHeightCm,
    beamsConcreteVolumeM3,
    beamsSteelWeightKg,
  };
}

export const documentDisciplineSchema = z.enum([
  "arquitectura",
  "estrutura",
  "hidrossanitario",
  "electricidade",
  "outro",
]);
export type DocumentDiscipline = z.infer<typeof documentDisciplineSchema>;

export const documentIdentitySchema = z.object({
  owner: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  projectTitle: z.string().nullable().default(null),
  pages: z.array(z.number().int().positive()).default([]),
});

export const documentIdentityConflictSchema = z.object({
  field: z.enum(["owner", "location", "project_title"]),
  severity: z.enum(["warning", "critical"]),
  values: z.array(z.object({
    value: z.string().min(1),
    disciplines: z.array(documentDisciplineSchema),
    pages: z.array(z.number().int().positive()),
  })).min(2),
});

export const documentSectionSchema = z.object({
  discipline: documentDisciplineSchema,
  label: z.string().min(1),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  identity: documentIdentitySchema.nullable().optional().default(null),
});
export type DocumentSection = z.infer<typeof documentSectionSchema>;

export const documentAnalysisSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  isMultiDiscipline: z.boolean(),
  sections: z.array(documentSectionSchema),
  matchedTags: z.array(z.string()).default([]),
  identityConflicts: z.array(documentIdentityConflictSchema).default([]),
  requiresIdentityConfirmation: z.boolean().default(false),
  identityConfirmed: z.boolean().default(false),
});
export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema>;

export const plantParseResultSchema = z.object({
  metadata: plantMetadataSchema,
  rooms: z.array(extractedRoomSchema),
  openings: z.array(extractedOpeningSchema).default([]),
  rebarSchedules: z.array(extractedRebarLineSchema),
  staircases: z.array(extractedStaircaseSchema),
  structuralSummary: structuralSummarySchema.nullable(),
  documentAnalysis: documentAnalysisSchema,
});
export type PlantParseResult = z.infer<typeof plantParseResultSchema>;
