export type ResolvedProjectFloors = {
  floors: number;
  labels: string[];
  configuredFloors: number;
  source: "project" | "plant" | "combined";
};

function plain(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

type FloorDescriptor = { key: string; label: string; order: number; indexedLevel: number | null };

function floorDescriptor(label: string): FloorDescriptor | null {
  const value = plain(label);
  if (!value || /(nao identificado|por confirmar|desconhecid|indefinid)/.test(value)) return null;
  if (/\b(cobertura|telhado|roof|anexo|garagem exterior)\b/.test(value)) return null;
  const basement = value.match(/\b(?:cave|subsolo|piso|nivel|andar)\s*(-\s*\d+)\b/);
  if (basement) {
    const level = Number(basement[1].replace(/\s/g, ""));
    return { key: `nivel:${level}`, label: level === -1 ? "Cave" : `Subsolo ${Math.abs(level)}`, order: level, indexedLevel: null };
  }
  if (/\b(cave|subsolo)\b/.test(value)) return { key: "nivel:-1", label: "Cave", order: -1, indexedLevel: null };
  if (/\b(res[- ]?do[- ]?chao|terreo|piso\s*0|nivel\s*0|ground)\b/.test(value)) {
    return { key: "nivel:0", label: "Piso térreo", order: 0, indexedLevel: 0 };
  }
  if (/\b(mezanino|mezzanine)\b/.test(value)) return { key: "nivel:0.5", label: "Mezanino", order: 0.5, indexedLevel: null };
  const numbered = value.match(/\b(?:piso|nivel|andar)\s*(\d+)\b/);
  if (numbered) {
    const level = Math.max(0, Number(numbered[1]));
    return { key: `nivel:${level}`, label: level === 0 ? "Piso térreo" : `Piso ${level}`, order: level, indexedLevel: level };
  }
  if (/\b(piso|andar)\s+superior\b|^superior$/.test(value)) {
    return { key: "nivel:1", label: "Piso superior", order: 1, indexedLevel: 1 };
  }
  return null;
}

/** Combina o cadastro com pisos confirmados nas plantas; o valor inicial 1 nunca oculta pisos reais. */
export function resolveProjectFloors(configuredInput: number, rawLabels: Array<string | null | undefined>): ResolvedProjectFloors {
  const configuredFloors = Math.max(1, Math.min(20, Math.round(configuredInput || 1)));
  const unique = new Map<string, FloorDescriptor>();
  for (const raw of rawLabels) {
    const label = raw?.trim();
    if (!label) continue;
    const descriptor = floorDescriptor(label);
    if (descriptor && !unique.has(descriptor.key)) unique.set(descriptor.key, descriptor);
  }
  const detected = [...unique.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "pt"));
  const highestIndexedLevel = detected.reduce((max, floor) => Math.max(max, floor.indexedLevel ?? -1), -1);
  const underground = detected.filter((floor) => floor.order < 0);
  const mezzanines = detected.filter((floor) => floor.indexedLevel === null && floor.order >= 0);
  const byIndexedLevel = new Map(detected.filter((floor) => floor.indexedLevel !== null).map((floor) => [floor.indexedLevel!, floor]));
  const inferredLabels = underground.map((floor) => floor.label);
  for (let level = 0; level <= highestIndexedLevel; level++) {
    inferredLabels.push(byIndexedLevel.get(level)?.label ?? (level === 0 ? "Piso térreo" : `Piso ${level}`));
    if (level === 0) inferredLabels.push(...mezzanines.map((floor) => floor.label));
  }
  if (highestIndexedLevel < 0) inferredLabels.push(...mezzanines.map((floor) => floor.label));
  const floors = Math.min(20, Math.max(configuredFloors, inferredLabels.length, 1));
  const labels = inferredLabels.slice(0, floors);
  let nextAboveGround = Math.max(0, highestIndexedLevel + 1);
  while (labels.length < floors) {
    labels.push(nextAboveGround === 0 ? "Piso térreo" : `Piso ${nextAboveGround}`);
    nextAboveGround += 1;
  }
  return {
    floors,
    labels,
    configuredFloors,
    source: detected.length ? (floors > configuredFloors ? "plant" : "combined") : "project",
  };
}
