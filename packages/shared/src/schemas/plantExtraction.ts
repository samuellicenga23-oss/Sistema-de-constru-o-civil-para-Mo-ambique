import { z } from "zod";

// Normalized response returned by the plant-service (`POST /parse`).
export const extractedRoomSchema = z.object({
  name: z.string(),
  number: z.string().nullable(),
  areaM2: z.number().positive(),
  page: z.number().int().positive(),
  floor: z.string().nullable(),
});
export type ExtractedRoom = z.infer<typeof extractedRoomSchema>;

export const extractedRebarLineSchema = z.object({
  element: z.string(),
  diameterMm: z.number().positive(),
  weightKg: z.number().nonnegative(),
  page: z.number().int().positive(),
});
export type ExtractedRebarLine = z.infer<typeof extractedRebarLineSchema>;

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

export const plantParseResultSchema = z.object({
  metadata: plantMetadataSchema,
  rooms: z.array(extractedRoomSchema),
  rebarSchedules: z.array(extractedRebarLineSchema),
  staircases: z.array(extractedStaircaseSchema),
  structuralSummary: structuralSummarySchema.nullable(),
});
export type PlantParseResult = z.infer<typeof plantParseResultSchema>;
