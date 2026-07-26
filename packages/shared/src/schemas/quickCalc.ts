import { z } from "zod";

// Resultado de um Cálculo Rápido (módulo de calculadoras avulsas para a obra, sem ligação a
// nenhum projecto/documento) — genérico o suficiente para qualquer tipo de calculadora (laje,
// betão simples, etc.) gerar o mesmo formato, exportável directamente para PDF.
export const quickCalcLineSchema = z.object({
  name: z.string().min(1),
  quantity: z.number(),
  unit: z.string().min(1),
});

export const quickCalcResultSchema = z.object({
  title: z.string().min(1),
  // Linha livre e opcional (ex: obra, cliente, responsável) — o utilizador escreve o que quiser
  // no ecrã antes de exportar, aparece por baixo do título no PDF.
  reference: z.string().optional(),
  inputsSummary: z.array(z.string()),
  lines: z.array(quickCalcLineSchema),
  notes: z.array(z.string()).optional(),
});

export type QuickCalcLine = z.infer<typeof quickCalcLineSchema>;
export type QuickCalcResult = z.infer<typeof quickCalcResultSchema>;
