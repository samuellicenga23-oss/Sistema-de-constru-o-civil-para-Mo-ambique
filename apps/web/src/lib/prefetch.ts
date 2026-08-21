import { shouldSkipHeavyPrefetch } from "./dataSaver";

/** Pré-carrega PDF/exportação pesada só quando o modo económico está desligado. */
export function prefetchHeavyDocument(url: string): void {
  if (shouldSkipHeavyPrefetch() || !url) return;
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = url;
  link.as = "document";
  document.head.appendChild(link);
}
