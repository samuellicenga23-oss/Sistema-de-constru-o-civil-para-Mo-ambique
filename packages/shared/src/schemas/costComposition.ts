import { z } from "zod";
import { CURRENCIES, UNITS } from "../enums.js";

export const compositionLineInputSchema = z.object({
  refId: z.string().uuid(),
  qtyPerUnit: z.number().nonnegative(),
  wastePct: z.number().min(0).max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type CompositionLineInput = z.infer<typeof compositionLineInputSchema>;

export const compositionSubcompositionLineInputSchema = z.object({
  refId: z.string().uuid(),
  qtyPerUnit: z.number().positive(),
  notes: z.string().max(500).nullable().optional(),
});

export const compositionDerivedCostLineInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  basis: z.enum(["materials", "labour", "equipment", "subcompositions", "direct"]),
  percentage: z.number().min(0).max(1000),
  notes: z.string().max(500).nullable().optional(),
});

export const measurementFormulaTypeSchema = z.enum([
  "legacy_product", "direct", "count", "length", "area", "wall_area", "perimeter",
  "volume", "section_length", "weight", "reinforcement", "percentage",
]);

export const costCompositionInputSchema = z.object({
  code: z.string().max(50).nullable().optional(),
  name: z.string().min(1),
  category: z.string().min(1).default("Outros"),
  description: z.string().max(2000).nullable().optional(),
  measurementCriteria: z.string().max(2000).nullable().optional(),
  executionNotes: z.string().max(2000).nullable().optional(),
  outputUnit: z.enum(UNITS),
  currency: z.enum(CURRENCIES),
  auxiliaryCostPct: z.number().min(0).max(100).default(0),
  indirectCostPct: z.number().min(0).max(100).default(0),
  profitMarginPct: z.number().min(0).max(100).default(0),
  sourceName: z.string().max(180).nullable().optional(),
  sourceReference: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),

  // APU 2.0 — produtividade explícita. Se outputPerDay não existir, o cronograma pode continuar
  // a derivar duração a partir das horas de mão-de-obra como actualmente.
  crewSize: z.number().int().positive().nullable().optional(),
  productiveHoursPerDay: z.number().positive().max(24).nullable().optional(),
  outputPerDay: z.number().positive().nullable().optional(),
  productivitySource: z.string().max(180).nullable().optional(),
  productivityNotes: z.string().max(1000).nullable().optional(),
  defaultMeasurementFormula: measurementFormulaTypeSchema.nullable().optional(),

  labourLines: z.array(compositionLineInputSchema).default([]),
  materialLines: z.array(compositionLineInputSchema).default([]),
  equipmentLines: z.array(compositionLineInputSchema).default([]),
  subcompositionLines: z.array(compositionSubcompositionLineInputSchema).default([]),
  derivedCostLines: z.array(compositionDerivedCostLineInputSchema).default([]),
});
export type CostCompositionInput = z.infer<typeof costCompositionInputSchema>;
