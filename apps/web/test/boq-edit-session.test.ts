import { describe, expect, it } from "vitest";
import { applyBoqEditOperations, createBoqEditHistory, type BoqEditLineItem, type BoqEditSection } from "@sigo/shared";
import { isEditableKeyboardTarget, resolveBoqHistoryShortcut } from "../src/utils/boqEditShortcuts";

const SECTION = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const CREATED = "33333333-3333-4333-8333-333333333333";

function item(partial: Partial<BoqEditLineItem> & Pick<BoqEditLineItem, "id" | "description">): BoqEditLineItem {
  return {
    sectionId: SECTION,
    parentId: null,
    kind: "item",
    code: "01",
    technicalSpecification: null,
    unit: "m2",
    quantity: 10,
    unitPrice: 100,
    sellingUnitPrice: 100,
    compositionId: null,
    origin: "manual",
    sortOrder: 0,
    totalPrice: 1000,
    sellingTotalPrice: 1000,
    children: [],
    ...partial,
  };
}

function base(): BoqEditSection[] {
  return [{
    id: SECTION,
    name: "Alvenaria",
    sortOrder: 0,
    templateKey: null,
    items: [item({ id: ITEM, description: "Parede" })],
    total: 1000,
    sellingTotal: 1000,
  }];
}

describe("sessão de edição BOQ", () => {
  it("desfaz edição de quantidade", () => {
    const history = createBoqEditHistory();
    history.push({ op: "update_item", id: ITEM, fields: { quantity: 4 } });
    const edited = applyBoqEditOperations(base(), history.operations);
    expect(edited[0].items[0].quantity).toBe(4);
    expect(edited[0].items[0].totalPrice).toBe(400);
    const undone = applyBoqEditOperations(base(), history.undo());
    expect(undone[0].items[0].quantity).toBe(10);
    expect(undone[0].items[0].totalPrice).toBe(1000);
  });

  it("desfaz criação", () => {
    const history = createBoqEditHistory();
    history.push({
      op: "add_item",
      id: CREATED,
      sectionId: SECTION,
      parentId: null,
      fields: { kind: "item", description: "Laje", unit: "m2", quantity: 2, unitPrice: 50 },
    });
    expect(applyBoqEditOperations(base(), history.operations)[0].items).toHaveLength(2);
    expect(applyBoqEditOperations(base(), history.undo())[0].items).toHaveLength(1);
  });

  it("desfaz eliminação", () => {
    const history = createBoqEditHistory();
    history.push({ op: "delete_item", id: ITEM });
    expect(applyBoqEditOperations(base(), history.operations)[0].items).toHaveLength(0);
    expect(applyBoqEditOperations(base(), history.undo())[0].items[0].id).toBe(ITEM);
  });

  it("refaz a última operação", () => {
    const history = createBoqEditHistory();
    history.push({ op: "update_item", id: ITEM, fields: { description: "Parede interior" } });
    history.undo();
    const redone = applyBoqEditOperations(base(), history.redo());
    expect(redone[0].items[0].description).toBe("Parede interior");
  });

  it("descarta o histórico", () => {
    const history = createBoqEditHistory();
    history.push({ op: "rename_section", id: SECTION, name: "Estrutura" });
    history.reset();
    expect(history.changeCount).toBe(0);
    expect(applyBoqEditOperations(base(), history.operations)[0].name).toBe("Alvenaria");
  });
});

describe("atalhos undo/redo do BOQ", () => {
  it("usa Ctrl/Cmd+Z e Shift para redo", () => {
    expect(resolveBoqHistoryShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false, target: null }, { canUndo: true, canRedo: false })).toBe("undo");
    expect(resolveBoqHistoryShortcut({ key: "z", ctrlKey: false, metaKey: true, shiftKey: true, target: null }, { canUndo: true, canRedo: true })).toBe("redo");
  });

  it("não intercepta Ctrl+Z quando o histórico está vazio", () => {
    const input = document.createElement("input");
    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(resolveBoqHistoryShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false, target: input }, { canUndo: false, canRedo: false })).toBeNull();
    expect(resolveBoqHistoryShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true, target: input }, { canUndo: true, canRedo: false })).toBeNull();
  });
});
