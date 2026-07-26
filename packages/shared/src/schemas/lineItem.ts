import { z } from "zod";
import { LINE_ITEM_KINDS, LINE_ITEM_ORIGINS, UNITS } from "../enums.js";

export const lineItemInputSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(LINE_ITEM_KINDS),
  code: z.string().max(30).nullable().optional(),
  description: z.string().min(1),
  unit: z.enum(UNITS).nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  compositionId: z.string().uuid().nullable().optional(),
  origin: z.enum(LINE_ITEM_ORIGINS).default("manual"),
  sortOrder: z.number().int().nonnegative().default(0),
});
export type LineItemInput = z.infer<typeof lineItemInputSchema>;

// Recursive shape returned by the API — a line item with its resolved children.
export type LineItemNode = LineItemInput & {
  id: string;
  sectionId: string;
  totalPrice: number | null;
  children: LineItemNode[];
};
