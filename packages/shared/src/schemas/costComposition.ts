import { z } from "zod";
import { CURRENCIES, UNITS } from "../enums.js";

export const compositionLineInputSchema = z.object({
  refId: z.string().uuid(),
  qtyPerUnit: z.number().nonnegative(),
});
export type CompositionLineInput = z.infer<typeof compositionLineInputSchema>;

export const costCompositionInputSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1).default("Outros"),
  outputUnit: z.enum(UNITS),
  currency: z.enum(CURRENCIES),
  labourLines: z.array(compositionLineInputSchema).default([]),
  materialLines: z.array(compositionLineInputSchema).default([]),
  equipmentLines: z.array(compositionLineInputSchema).default([]),
});
export type CostCompositionInput = z.infer<typeof costCompositionInputSchema>;
