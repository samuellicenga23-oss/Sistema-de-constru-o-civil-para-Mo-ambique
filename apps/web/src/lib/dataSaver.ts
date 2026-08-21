/** Preferência local «modo económico de dados» — reduz polling, prefetch e tamanho de imagens. */
export const DATA_SAVER_STORAGE_KEY = "sigo-data-saver";
export const DATA_SAVER_CHANGE_EVENT = "sigo-data-saver-change";

/** Multiplicador aplicado a intervalos de polling quando o modo está activo. */
export const DATA_SAVER_POLL_MULTIPLIER = 3;

export function isDataSaverEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DATA_SAVER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDataSaverEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DATA_SAVER_STORAGE_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new CustomEvent(DATA_SAVER_CHANGE_EVENT, { detail: enabled }));
  } catch {
    /* quota / modo privado */
  }
}

/** Intervalo efectivo para polling (ex.: 12_000 → 36_000 ms com modo activo). */
export function getPollingInterval(baseMs: number): number {
  return isDataSaverEnabled() ? baseMs * DATA_SAVER_POLL_MULTIPLIER : baseMs;
}

/** PDFs, exportações pesadas e pré-carregamento de históricos. */
export function shouldSkipHeavyPrefetch(): boolean {
  return isDataSaverEnabled();
}

/** Atributos recomendados para <img> quando se pretende poupar dados. */
export function getImageLoadingProps(): { loading: "lazy" | "eager"; decoding: "async" | "sync" } {
  return isDataSaverEnabled()
    ? { loading: "lazy", decoding: "async" }
    : { loading: "lazy", decoding: "async" };
}

/** Classes Tailwind para miniaturas — menores com modo económico activo. */
export function getThumbnailSizeClass(): string {
  return isDataSaverEnabled() ? "h-16 w-16" : "h-24 w-24";
}

/** Query opcional para pedir versão mais pequena quando o backend suportar (?w=). */
export function optimizeImageUrl(url: string): string {
  if (!isDataSaverEnabled() || !url) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith("/uploads/") && !parsed.searchParams.has("w")) {
      parsed.searchParams.set("w", "320");
      return parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    /* URL relativa inválida — devolver original */
  }
  return url;
}
