import { describe, expect, it } from "vitest";
import {
  consumeAssistantSearchParams,
  countBoqLineItems,
  documentHasBoqContent,
  shouldShowPrimaryMeasurementImport,
} from "../src/utils/measurementWorkspace";
import type { LineItemNode } from "../src/api/boq";

function item(partial: Partial<LineItemNode> & { id: string }): LineItemNode {
  return {
    description: "Item",
    unit: "un",
    quantity: 1,
    unitPrice: 0,
    children: [],
    ...partial,
  } as LineItemNode;
}

describe("measurement workspace", () => {
  it("conta itens aninhados", () => {
    expect(countBoqLineItems([item({ id: "a", children: [item({ id: "b" })] })])).toBe(2);
  });

  it("mostra o importador principal só quando o mapa está vazio", () => {
    expect(shouldShowPrimaryMeasurementImport({ isMeasurementDocument: true, isReadOnly: false, hasContent: false })).toBe(true);
    expect(shouldShowPrimaryMeasurementImport({ isMeasurementDocument: true, isReadOnly: false, hasContent: true })).toBe(false);
    expect(shouldShowPrimaryMeasurementImport({ isMeasurementDocument: true, isReadOnly: true, hasContent: false })).toBe(false);
    expect(shouldShowPrimaryMeasurementImport({ isMeasurementDocument: false, isReadOnly: false, hasContent: false })).toBe(false);
  });

  it("detecta conteúdo gerado pelo assistente", () => {
    expect(documentHasBoqContent([{ items: [] }])).toBe(false);
    expect(documentHasBoqContent([{ items: [item({ id: "1" })] }])).toBe(true);
  });

  it("limpa assistente e fromPlant da URL sem redireccionar para a planta", () => {
    const { openWizard, next } = consumeAssistantSearchParams(new URLSearchParams("assistente=1&fromPlant=plant-9&fase=medicao"));
    expect(openWizard).toBe(true);
    expect(next.get("assistente")).toBeNull();
    expect(next.get("fromPlant")).toBeNull();
    expect(next.get("fase")).toBe("medicao");
  });
});
