const ORIGIN_LABELS: Record<string, string> = {
  planta: "Planta",
  plant: "Planta",
  composicao: "Comp.",
  measurement: "Medido",
  import: "Importado",
  bim: "BIM",
  estimate: "Estimado",
  estimativa: "Estimado",
  manual: "Manual",
};

export function boqProvenanceBadge(origin?: string | null, quantitySource?: string | null): { label: string; title: string } | null {
  const source = quantitySource && quantitySource !== "manual" ? quantitySource : origin && origin !== "manual" ? origin : null;
  if (!source) return null;
  return {
    label: ORIGIN_LABELS[source] ?? source,
    title: `Origem ${origin ?? "manual"} · quantidade ${quantitySource ?? "manual"}`,
  };
}
