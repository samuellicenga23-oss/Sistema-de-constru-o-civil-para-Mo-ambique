/**
 * Perfil-país SIGO — Moçambique como contexto primário.
 * Taxas legais são referências configuráveis (effective-dated na BD), não constantes eternas.
 */

export const MZ_COUNTRY_CODE = "MZ" as const;
export const MZ_LOCALE = "pt-MZ" as const;
export const MZ_TIMEZONE = "Africa/Maputo" as const;
export const MZ_CURRENCY = "MZN" as const;
export const MZ_CURRENCY_SYMBOL = "MT" as const;
export const MZ_PHONE_COUNTRY_CODE = "+258" as const;

/** Referência seed (não verdade eterna) — IVA padrão MZ. */
export const MZ_IVA_RATE_REFERENCE = 0.16;
/** Referência seed INSS TCO: empregadora + trabalhador. */
export const MZ_INSS_EMPLOYER_RATE_REFERENCE = 0.04;
export const MZ_INSS_WORKER_RATE_REFERENCE = 0.03;

export type CountryProfile = {
  countryCode: typeof MZ_COUNTRY_CODE;
  locale: typeof MZ_LOCALE;
  timezone: typeof MZ_TIMEZONE;
  currency: typeof MZ_CURRENCY;
  currencySymbol: typeof MZ_CURRENCY_SYMBOL;
  phoneCountryCode: typeof MZ_PHONE_COUNTRY_CODE;
  nuitDigits: 9;
  references: {
    ivaRate: number;
    inssEmployerRate: number;
    inssWorkerRate: number;
    source: string;
  };
};

export const MZ_COUNTRY_PROFILE: CountryProfile = {
  countryCode: MZ_COUNTRY_CODE,
  locale: MZ_LOCALE,
  timezone: MZ_TIMEZONE,
  currency: MZ_CURRENCY,
  currencySymbol: MZ_CURRENCY_SYMBOL,
  phoneCountryCode: MZ_PHONE_COUNTRY_CODE,
  nuitDigits: 9,
  references: {
    ivaRate: MZ_IVA_RATE_REFERENCE,
    inssEmployerRate: MZ_INSS_EMPLOYER_RATE_REFERENCE,
    inssWorkerRate: MZ_INSS_WORKER_RATE_REFERENCE,
    source: "Referência configurável SIGO — actualizar via fiscal_rate_profiles",
  },
};

export function getDefaultCountryProfile(): CountryProfile {
  return MZ_COUNTRY_PROFILE;
}

/** AAAA-MM-DD no fuso Africa/Maputo (evita recuo UTC+2). */
export function maputoTodayIso(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MZ_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  return `${y}-${m}-${d}`;
}

export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

export function formatMoneyMz(
  value: number,
  options?: { symbol?: "MT" | "MZN" | "code"; locale?: string },
): string {
  const locale = options?.locale ?? MZ_LOCALE;
  const amount = Number(value);
  const formatted = (Number.isFinite(amount) ? amount : 0).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = options?.symbol ?? "MT";
  if (symbol === "code") return `${formatted} ${MZ_CURRENCY}`;
  if (symbol === "MZN") return `${formatted} MZN`;
  return `${formatted} ${MZ_CURRENCY_SYMBOL}`;
}

export function normalizeNuit(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export type NuitValidation =
  | { ok: true; nuit: string | null; foreign: boolean }
  | { ok: false; error: string };

/**
 * Entidade MZ: exactamente 9 dígitos.
 * Estrangeiro: sem NUIT MZ (null/vazio) ou com identificação livre não validada como NUIT.
 * Não simula validação junto da Autoridade Tributária.
 */
export function validateNuitMz(
  value: string | null | undefined,
  opts?: { foreign?: boolean; required?: boolean },
): NuitValidation {
  const foreign = Boolean(opts?.foreign);
  const digits = normalizeNuit(value);
  if (!digits) {
    if (opts?.required && !foreign) return { ok: false, error: "NUIT é obrigatório (9 dígitos)." };
    return { ok: true, nuit: null, foreign };
  }
  if (foreign) {
    return { ok: true, nuit: digits, foreign: true };
  }
  if (digits.length !== 9) {
    return { ok: false, error: "NUIT moçambicano deve ter exactamente 9 dígitos." };
  }
  return { ok: true, nuit: digits, foreign: false };
}

export function normalizePhoneMz(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("258") && digits.length >= 11) return `+${digits}`;
  if (/^8\d{8}$/.test(digits)) return `${MZ_PHONE_COUNTRY_CODE}${digits}`;
  return raw.startsWith("+") ? raw : digits;
}

export function formatPhoneDisplayMz(value: string | null | undefined): string {
  const normalized = normalizePhoneMz(value);
  if (!normalized) return "";
  return normalized;
}

/** Províncias de Moçambique (código estável + nome). */
export const MZ_PROVINCES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "CD", name: "Cabo Delgado" },
  { code: "GZ", name: "Gaza" },
  { code: "IN", name: "Inhambane" },
  { code: "MN", name: "Manica" },
  { code: "MP", name: "Maputo" },
  { code: "MC", name: "Maputo Cidade" },
  { code: "NM", name: "Nampula" },
  { code: "NS", name: "Niassa" },
  { code: "SF", name: "Sofala" },
  { code: "TT", name: "Tete" },
  { code: "ZB", name: "Zambézia" },
] as const;

export type FiscalRateKind = "iva" | "inss_employer" | "inss_worker" | "other";

export type FiscalRateProfileRow = {
  kind: FiscalRateKind;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
  reference: string | null;
};

/** Resolve a taxa vigente numa data de calendário (AAAA-MM-DD). */
export function resolveFiscalRateOnDate(
  rows: FiscalRateProfileRow[],
  kind: FiscalRateKind,
  onDate: string,
): FiscalRateProfileRow | null {
  const candidates = rows
    .filter((row) => row.kind === kind)
    .filter((row) => row.effectiveFrom <= onDate && (row.effectiveTo == null || row.effectiveTo >= onDate))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates[0] ?? null;
}

export const MZ_PAYMENT_METHODS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "transferencia", label: "Transferência bancária" },
  { code: "mpesa", label: "M-Pesa" },
  { code: "emola", label: "e-Mola" },
  { code: "numerario", label: "Numerário" },
  { code: "cheque", label: "Cheque" },
  { code: "cartao", label: "Cartão" },
  { code: "outro", label: "Outro" },
] as const;
