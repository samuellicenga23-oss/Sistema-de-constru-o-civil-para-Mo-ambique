import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetSections, lineItems } from "../db/schema.js";
import type { BoqEditOperation } from "@sigo/shared";
import { CURRENCIES, UNITS, fixedSigo } from "@sigo/shared";
import { computeBoqEditFingerprint, getBudgetDocumentSummary } from "./boqEngine.js";
import { createLineItemCostSnapshot } from "./costSnapshotService.js";
import { assertCompositionVisible, getZoneIdForSection } from "./accessControl.js";
import { computeCompositionUnitCostV2 } from "./costEngineV2.js";
import { recordAuditEvent } from "./auditTrail.js";

const SPEC_MARKER = "\n\n— Especificação técnica —\n";

function mergeDescriptionWithSpec(baseDescription: string, spec: string | null | undefined): string {
  const base = baseDescription.split(SPEC_MARKER)[0].trim();
  if (spec === undefined) return baseDescription;
  if (!spec?.trim()) return base;
  return `${base}${SPEC_MARKER}${spec.trim()}`;
}

export class BoqEditConflictError extends Error {
  constructor() {
    super("Documento alterado. Recarregar");
    this.name = "BoqEditConflictError";
  }
}

export class BoqEditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoqEditValidationError";
  }
}

function asUnit(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if ((UNITS as readonly string[]).includes(value)) return value as (typeof UNITS)[number];
  throw new BoqEditValidationError("Unidade inválida");
}

function asCurrency(value: string): (typeof CURRENCIES)[number] {
  if ((CURRENCIES as readonly string[]).includes(value)) return value as (typeof CURRENCIES)[number];
  throw new BoqEditValidationError("Moeda inválida");
}

async function documentItemIds(documentId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(eq(budgetSections.documentId, documentId));
  return new Set(rows.map((row) => row.id));
}

async function documentSectionIds(documentId: string): Promise<Set<string>> {
  const rows = await db.select({ id: budgetSections.id }).from(budgetSections).where(eq(budgetSections.documentId, documentId));
  return new Set(rows.map((row) => row.id));
}

export async function applyBoqEditSession(input: {
  documentId: string;
  companyId: string;
  actorUserId: string | null;
  projectId: string;
  currency: string;
  baseFingerprint: string;
  operations: BoqEditOperation[];
}) {
  const current = await getBudgetDocumentSummary(input.documentId);
  if (!current) throw new BoqEditValidationError("Documento não encontrado");
  if (current.editFingerprint !== input.baseFingerprint) throw new BoqEditConflictError();

  await db.transaction(async (tx) => {
    const itemIds = await documentItemIds(input.documentId);
    const sectionIds = await documentSectionIds(input.documentId);

    for (const operation of input.operations) {
      if (operation.op === "update_item") {
        if (!itemIds.has(operation.id)) throw new BoqEditValidationError("Item não encontrado");
        const [existing] = await tx.select().from(lineItems).where(eq(lineItems.id, operation.id)).limit(1);
        if (!existing) throw new BoqEditValidationError("Item não encontrado");
        const fields = operation.fields;
        let description = fields.description ?? existing.description;
        if (fields.technicalSpecification !== undefined) {
          description = mergeDescriptionWithSpec(fields.description ?? existing.description.split(SPEC_MARKER)[0], fields.technicalSpecification);
        }
        let unitPrice = fields.unitPrice;
        let origin: "manual" | "planta" | "composicao" | undefined;
        if (fields.compositionId) {
          const composition = await assertCompositionVisible(fields.compositionId, input.companyId);
          if (!composition) throw new BoqEditValidationError("Composição de custo não encontrada");
          const zoneId = await getZoneIdForSection(existing.sectionId);
          unitPrice = (await computeCompositionUnitCostV2(fields.compositionId, input.companyId, zoneId)).unitCost;
          origin = "composicao";
        } else if (fields.compositionId === null) {
          origin = "manual";
        }
        await tx.update(lineItems).set({
          description,
          code: fields.code === undefined ? undefined : fields.code,
          unit: asUnit(fields.unit),
          quantity: fields.quantity === undefined ? undefined : (fields.quantity === null ? null : fixedSigo(fields.quantity)),
          unitPrice: unitPrice === undefined ? undefined : (unitPrice === null ? null : fixedSigo(unitPrice)),
          compositionId: fields.compositionId === undefined ? undefined : fields.compositionId,
          quantitySource: fields.quantity !== undefined ? "manual" : undefined,
          origin,
        }).where(eq(lineItems.id, operation.id));
        if (fields.compositionId) {
          await createLineItemCostSnapshot({
            lineItemId: operation.id,
            compositionId: fields.compositionId,
            companyId: input.companyId,
            zoneId: await getZoneIdForSection(existing.sectionId),
            currency: asCurrency(input.currency),
            reason: "attached",
          }, tx);
        }
      } else if (operation.op === "delete_item") {
        if (!itemIds.has(operation.id)) throw new BoqEditValidationError("Item não encontrado");
        await tx.delete(lineItems).where(eq(lineItems.id, operation.id));
        itemIds.delete(operation.id);
      } else if (operation.op === "add_item") {
        if (!sectionIds.has(operation.sectionId)) throw new BoqEditValidationError("Secção não encontrada");
        if (operation.parentId && !itemIds.has(operation.parentId)) throw new BoqEditValidationError("Item pai não encontrado");
        let unitPrice = operation.fields.unitPrice ?? null;
        let origin: "manual" | "composicao" = "manual";
        if (operation.fields.compositionId) {
          const composition = await assertCompositionVisible(operation.fields.compositionId, input.companyId);
          if (!composition) throw new BoqEditValidationError("Composição de custo não encontrada");
          const zoneId = await getZoneIdForSection(operation.sectionId);
          unitPrice = (await computeCompositionUnitCostV2(operation.fields.compositionId, input.companyId, zoneId)).unitCost;
          origin = "composicao";
        }
        await tx.insert(lineItems).values({
          id: operation.id,
          sectionId: operation.sectionId,
          parentId: operation.parentId,
          kind: operation.fields.kind,
          code: operation.fields.code ?? null,
          description: operation.fields.technicalSpecification
            ? mergeDescriptionWithSpec(operation.fields.description, operation.fields.technicalSpecification)
            : operation.fields.description,
          unit: asUnit(operation.fields.unit) ?? null,
          quantity: operation.fields.quantity != null ? fixedSigo(operation.fields.quantity) : null,
          unitPrice: unitPrice != null ? fixedSigo(unitPrice) : null,
          compositionId: operation.fields.compositionId ?? null,
          sortOrder: operation.fields.sortOrder ?? 0,
          origin,
        });
        itemIds.add(operation.id);
        if (operation.fields.compositionId) {
          await createLineItemCostSnapshot({
            lineItemId: operation.id,
            compositionId: operation.fields.compositionId,
            companyId: input.companyId,
            zoneId: await getZoneIdForSection(operation.sectionId),
            currency: asCurrency(input.currency),
            reason: "attached",
          }, tx);
        }
      } else if (operation.op === "add_section") {
        await tx.insert(budgetSections).values({
          id: operation.id,
          documentId: input.documentId,
          name: operation.name,
          sortOrder: operation.sortOrder ?? 0,
        });
        sectionIds.add(operation.id);
      } else if (operation.op === "rename_section") {
        if (!sectionIds.has(operation.id)) throw new BoqEditValidationError("Secção não encontrada");
        await tx.update(budgetSections).set({ name: operation.name }).where(eq(budgetSections.id, operation.id));
      } else if (operation.op === "delete_section") {
        if (!sectionIds.has(operation.id)) throw new BoqEditValidationError("Secção não encontrada");
        await tx.delete(budgetSections).where(eq(budgetSections.id, operation.id));
        sectionIds.delete(operation.id);
      }
    }
  });

  await recordAuditEvent({
    companyId: input.companyId,
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    entityType: "budget_document",
    entityId: input.documentId,
    action: "edit_session",
    metadata: { operations: input.operations.length, ops: input.operations.map((operation) => operation.op) },
  });

  const summary = await getBudgetDocumentSummary(input.documentId);
  return { summary, editFingerprint: summary?.editFingerprint ?? computeBoqEditFingerprint([]) };
}
