import { z } from "zod";
import { CURRENCIES, UNITS } from "../enums.js";

export const compositionLineInputSchema = z.object({
  refId: z.string().uuid(),
  qtyPerUnit: z.number().nonnegative(),
  wastePct: z.number().min(0).max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type CompositionLineInput = z.infer<typeof compositionLineInputSchema>;

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
  labourLines: z.array(compositionLineInputSchema).default([]),
  materialLines: z.array(compositionLineInputSchema).default([]),
  equipmentLines: z.array(compositionLineInputSchema).default([]),
});
export type CostCompositionInput = z.infer<typeof costCompositionInputSchema>;
