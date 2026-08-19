import { z } from "zod";

export const boqEditItemFieldsSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(["capitulo", "grupo", "item", "nota"]).optional(),
  code: z.string().max(30).nullable().optional(),
  description: z.string().min(1).optional(),
  technicalSpecification: z.string().nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  compositionId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const boqEditOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("update_item"), id: z.string().uuid(), fields: boqEditItemFieldsSchema }),
  z.object({ op: z.literal("delete_item"), id: z.string().uuid() }),
  z.object({
    op: z.literal("add_item"),
    id: z.string().uuid(),
    sectionId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    fields: boqEditItemFieldsSchema.extend({
      kind: z.enum(["capitulo", "grupo", "item", "nota"]),
      description: z.string().min(1),
    }),
  }),
  z.object({ op: z.literal("add_section"), id: z.string().uuid(), name: z.string().min(1), sortOrder: z.number().int().optional() }),
  z.object({ op: z.literal("rename_section"), id: z.string().uuid(), name: z.string().min(1) }),
  z.object({ op: z.literal("delete_section"), id: z.string().uuid() }),
]);

export const boqEditSessionSchema = z.object({
  baseFingerprint: z.string().min(8).max(128),
  operations: z.array(boqEditOperationSchema).min(1).max(400),
});

export type BoqEditOperation = z.infer<typeof boqEditOperationSchema>;
export type BoqEditItemFields = z.infer<typeof boqEditItemFieldsSchema>;

export type BoqEditLineItem = {
  id: string;
  sectionId: string;
  parentId: string | null;
  kind: "capitulo" | "grupo" | "item" | "nota";
  code: string | null;
  description: string;
  technicalSpecification: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  sellingUnitPrice: number | null;
  compositionId: string | null;
  origin: string;
  sortOrder: number;
  totalPrice: number;
  sellingTotalPrice: number;
  children: BoqEditLineItem[];
};

export type BoqEditSection = {
  id: string;
  name: string;
  sortOrder: number;
  templateKey: string | null;
  items: BoqEditLineItem[];
  total: number;
  sellingTotal: number;
};

function cloneItem(item: BoqEditLineItem): BoqEditLineItem {
  return { ...item, children: item.children.map(cloneItem) };
}

function cloneSections(sections: BoqEditSection[]): BoqEditSection[] {
  return sections.map((section) => ({ ...section, items: section.items.map(cloneItem) }));
}

function walkItems(items: BoqEditLineItem[], visit: (item: BoqEditLineItem, siblings: BoqEditLineItem[]) => boolean): boolean {
  for (const item of items) {
    if (visit(item, items)) return true;
    if (walkItems(item.children, visit)) return true;
  }
  return false;
}

function findItem(sections: BoqEditSection[], id: string): BoqEditLineItem | null {
  let found: BoqEditLineItem | null = null;
  for (const section of sections) {
    walkItems(section.items, (item) => {
      if (item.id === id) {
        found = item;
        return true;
      }
      return false;
    });
    if (found) break;
  }
  return found;
}

function removeItem(sections: BoqEditSection[], id: string): BoqEditSection[] {
  const filterTree = (items: BoqEditLineItem[]): BoqEditLineItem[] =>
    items.filter((item) => item.id !== id).map((item) => ({ ...item, children: filterTree(item.children) }));
  return sections.map((section) => ({ ...section, items: filterTree(section.items) }));
}

function recomputeItem(item: BoqEditLineItem): BoqEditLineItem {
  const children = item.children.map(recomputeItem);
  if (item.kind === "item") {
    const totalPrice = (item.quantity ?? 0) * (item.unitPrice ?? 0);
    return { ...item, children, totalPrice, sellingTotalPrice: (item.quantity ?? 0) * (item.sellingUnitPrice ?? item.unitPrice ?? 0) };
  }
  const totalPrice = children.reduce((sum, child) => sum + child.totalPrice, 0);
  const sellingTotalPrice = children.reduce((sum, child) => sum + child.sellingTotalPrice, 0);
  return { ...item, children, totalPrice, sellingTotalPrice };
}

function recomputeSections(sections: BoqEditSection[]): BoqEditSection[] {
  return sections.map((section) => {
    const items = section.items.map(recomputeItem);
    return {
      ...section,
      items,
      total: items.reduce((sum, item) => sum + item.totalPrice, 0),
      sellingTotal: items.reduce((sum, item) => sum + item.sellingTotalPrice, 0),
    };
  });
}

export function applyBoqEditOperations(sections: BoqEditSection[], operations: BoqEditOperation[]): BoqEditSection[] {
  let next = cloneSections(sections);
  for (const operation of operations) {
    if (operation.op === "update_item") {
      const item = findItem(next, operation.id);
      if (!item) throw new Error(`Item ${operation.id} não encontrado`);
      Object.assign(item, operation.fields);
      if (operation.fields.quantity !== undefined || operation.fields.unitPrice !== undefined) {
        item.totalPrice = (item.quantity ?? 0) * (item.unitPrice ?? 0);
      }
    } else if (operation.op === "delete_item") {
      if (!findItem(next, operation.id)) throw new Error(`Item ${operation.id} não encontrado`);
      next = removeItem(next, operation.id);
    } else if (operation.op === "add_item") {
      const section = next.find((row) => row.id === operation.sectionId);
      if (!section) throw new Error(`Secção ${operation.sectionId} não encontrada`);
      const created: BoqEditLineItem = {
        id: operation.id,
        sectionId: operation.sectionId,
        parentId: operation.parentId,
        kind: operation.fields.kind,
        code: operation.fields.code ?? null,
        description: operation.fields.description,
        technicalSpecification: operation.fields.technicalSpecification ?? null,
        unit: operation.fields.unit ?? null,
        quantity: operation.fields.quantity ?? null,
        unitPrice: operation.fields.unitPrice ?? null,
        sellingUnitPrice: operation.fields.unitPrice ?? null,
        compositionId: operation.fields.compositionId ?? null,
        origin: operation.fields.compositionId ? "composicao" : "manual",
        sortOrder: operation.fields.sortOrder ?? 0,
        totalPrice: (operation.fields.quantity ?? 0) * (operation.fields.unitPrice ?? 0),
        sellingTotalPrice: (operation.fields.quantity ?? 0) * (operation.fields.unitPrice ?? 0),
        children: [],
      };
      if (!operation.parentId) {
        section.items.push(created);
      } else {
        const parent = findItem(next, operation.parentId);
        if (!parent) throw new Error(`Item ${operation.parentId} não encontrado`);
        parent.children.push(created);
      }
    } else if (operation.op === "add_section") {
      next.push({
        id: operation.id,
        name: operation.name,
        sortOrder: operation.sortOrder ?? next.length,
        templateKey: null,
        items: [],
        total: 0,
        sellingTotal: 0,
      });
    } else if (operation.op === "rename_section") {
      const section = next.find((row) => row.id === operation.id);
      if (!section) throw new Error(`Secção ${operation.id} não encontrada`);
      section.name = operation.name;
    } else if (operation.op === "delete_section") {
      if (!next.some((row) => row.id === operation.id)) throw new Error(`Secção ${operation.id} não encontrada`);
      next = next.filter((row) => row.id !== operation.id);
    }
  }
  return recomputeSections(next);
}

export function createBoqEditHistory() {
  let past: BoqEditOperation[][] = [];
  let future: BoqEditOperation[][] = [];

  return {
    get operations() {
      return past.flat();
    },
    get changeCount() {
      return past.length;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    push(operation: BoqEditOperation | BoqEditOperation[]) {
      past = [...past, Array.isArray(operation) ? operation : [operation]];
      future = [];
    },
    undo(): BoqEditOperation[] {
      const last = past[past.length - 1];
      if (!last) return [];
      past = past.slice(0, -1);
      future = [last, ...future];
      return past.flat();
    },
    redo(): BoqEditOperation[] {
      const next = future[0];
      if (!next) return [];
      future = future.slice(1);
      past = [...past, next];
      return past.flat();
    },
    reset() {
      past = [];
      future = [];
    },
  };
}
