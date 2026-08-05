import { UNITS, type Unit } from "./enums.js";

const UNIT_SET = new Set<string>(UNITS);

/** Aliases frequentes em Excel de obra (PT/BR/EN, maiúsculas, símbolos). */
const UNIT_ALIASES: Record<string, Unit> = {
  m: "m",
  mt: "m",
  metro: "m",
  metros: "m",
  m1: "m",
  "m.l": "ml",
  "m.l.": "ml",
  ml: "ml",
  "m/l": "ml",
  metrolinear: "ml",
  "metro linear": "ml",
  m2: "m2",
  "m²": "m2",
  mq: "m2",
  "m2.": "m2",
  metro2: "m2",
  "metro quadrado": "m2",
  m3: "m3",
  "m³": "m3",
  "m3.": "m3",
  metro3: "m3",
  "metro cubico": "m3",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  quilograma: "kg",
  quilogramas: "kg",
  un: "un",
  um: "un",
  und: "un",
  ud: "un",
  u: "un",
  unidade: "un",
  unidades: "un",
  pc: "un",
  pç: "un",
  peca: "un",
  peça: "un",
  vg: "vg",
  verga: "vg",
  viagem: "vg",
  viagens: "vg",
  h: "h",
  hr: "h",
  hrs: "h",
  hora: "h",
  horas: "h",
  hh: "h",
};

function stripUnitNoise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[()[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "");
}

/** Converte texto livre de Excel numa unidade SIGO; usa fallback se não reconhecer. */
export function normalizeUnit(value: string | null | undefined, fallback: Unit | string = "un"): Unit {
  const fb = UNIT_SET.has(fallback) ? (fallback as Unit) : "un";
  if (value == null || String(value).trim() === "") return fb;
  const cleaned = stripUnitNoise(String(value));
  if (UNIT_SET.has(cleaned)) return cleaned as Unit;
  const compact = cleaned.replace(/\s+/g, "");
  if (UNIT_ALIASES[cleaned]) return UNIT_ALIASES[cleaned];
  if (UNIT_ALIASES[compact]) return UNIT_ALIASES[compact];
  // m2 / m3 com espaços ou símbolos (sem includes amplos que gerem falsos positivos)
  if (/^m\s*[²2]$/.test(cleaned) || /^m2$/.test(compact) || cleaned === "m²") return "m2";
  if (/^m\s*[³3]$/.test(cleaned) || /^m3$/.test(compact) || cleaned === "m³") return "m3";
  return fb;
}

export function isKnownUnit(value: string | null | undefined): boolean {
  if (value == null) return false;
  const cleaned = stripUnitNoise(String(value));
  return UNIT_SET.has(cleaned) || Boolean(UNIT_ALIASES[cleaned] || UNIT_ALIASES[cleaned.replace(/\s+/g, "")]);
}
