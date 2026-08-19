const ORIGIN_LABELS: Record<string, string> = {
  planta: "Planta",
  plant: "Planta",
  composicao: "Comp.",
  measurement: "Memória",
  import: "Import.",
  bim: "BIM",
  estimate: "Est.",
  estimativa: "Est.",
};

export function boqProvenanceBadge(origin?: string | null, quantitySource?: string | null): { label: string; title: string } | null {
  const source = quantitySource && quantitySource !== "manual" ? quantitySource : origin && origin !== "manual" ? origin : null;
  if (!source) return null;
  return {
    label: ORIGIN_LABELS[source] ?? source,
    title: `Origem ${origin ?? "manual"} · quantidade ${quantitySource ?? "manual"}`,
  };
}
