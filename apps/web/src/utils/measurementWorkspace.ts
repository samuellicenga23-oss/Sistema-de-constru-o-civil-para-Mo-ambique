import type { LineItemNode } from "../api/boq";

export function countBoqLineItems(items: LineItemNode[]): number {
  return items.reduce((total, item) => total + 1 + countBoqLineItems(item.children ?? []), 0);
}

export function documentHasBoqContent(sections: Array<{ items: LineItemNode[] }>): boolean {
  return sections.some((section) => countBoqLineItems(section.items) > 0);
}

export function shouldShowPrimaryMeasurementImport(input: {
  isMeasurementDocument: boolean;
  isReadOnly: boolean;
  hasContent: boolean;
}): boolean {
  return input.isMeasurementDocument && !input.isReadOnly && !input.hasContent;
}

export function consumeAssistantSearchParams(params: URLSearchParams): {
  openWizard: boolean;
  next: URLSearchParams;
} {
  const openWizard = params.get("assistente") === "1";
  const next = new URLSearchParams(params);
  next.delete("assistente");
  next.delete("fromPlant");
  return { openWizard, next };
}
