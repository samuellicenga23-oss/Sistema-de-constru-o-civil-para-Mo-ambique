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
  staircasesCount: z.number().int().nonnegative(),
  slabsCount: z.number().int().nonnegative(),
  slabsAvgThicknessCm: z.number().nonnegative(),
  slabs: z.array(extractedSlabSchema).default([]),
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
