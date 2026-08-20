import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { companyVendorGovernance, suppliers } from "../db/schema.js";
import type { VendorGovernanceStatus } from "./vendorGovernance.js";

export type EffectiveVendorGovernance = {
  governanceStatus: VendorGovernanceStatus;
  blockedReason: string | null;
  source: "company" | "global";
};

type SupplierGovernanceRow = {
  id: string;
  companyId: string | null;
  governanceStatus: VendorGovernanceStatus | string;
  blockedReason: string | null;
};

/** SIGO Preços (company-owned) usa o campo global; marketplace usa override por empresa se existir. */
export async function resolveEffectiveVendorGovernance(
  companyId: string,
  supplier: SupplierGovernanceRow,
): Promise<EffectiveVendorGovernance> {
  if (supplier.companyId === companyId) {
    return {
      governanceStatus: supplier.governanceStatus as VendorGovernanceStatus,
      blockedReason: supplier.blockedReason,
      source: "global",
    };
  }
  const [override] = await db
    .select()
    .from(companyVendorGovernance)
    .where(and(eq(companyVendorGovernance.companyId, companyId), eq(companyVendorGovernance.supplierId, supplier.id)))
    .limit(1);
  if (override) {
    return {
      governanceStatus: override.governanceStatus,
      blockedReason: override.blockedReason,
      source: "company",
    };
  }
  return {
    governanceStatus: supplier.governanceStatus as VendorGovernanceStatus,
    blockedReason: supplier.blockedReason,
    source: "global",
  };
}

export async function loadCompanyVendorGovernanceMap(companyId: string, supplierIds: string[]) {
  if (!supplierIds.length) return new Map<string, typeof companyVendorGovernance.$inferSelect>();
  const rows = await db
    .select()
    .from(companyVendorGovernance)
    .where(and(eq(companyVendorGovernance.companyId, companyId), inArray(companyVendorGovernance.supplierId, supplierIds)));
  return new Map(rows.map((row) => [row.supplierId, row]));
}

export async function upsertCompanyVendorGovernance(args: {
  companyId: string;
  supplierId: string;
  governanceStatus: VendorGovernanceStatus;
  blockedReason: string | null;
  actorUserId: string;
}) {
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, args.supplierId), isNull(suppliers.companyId)))
    .limit(1);
  if (!supplier) {
    throw Object.assign(new Error("Só fornecedores do marketplace aceitam governação por empresa"), { statusCode: 409 });
  }
  const values = {
    companyId: args.companyId,
    supplierId: args.supplierId,
    governanceStatus: args.governanceStatus,
    blockedReason: args.governanceStatus === "bloqueado" ? args.blockedReason : null,
    blockedAt: args.governanceStatus === "bloqueado" ? new Date() : null,
    blockedByUserId: args.governanceStatus === "bloqueado" ? args.actorUserId : null,
    updatedAt: new Date(),
  };
  const [existing] = await db
    .select()
    .from(companyVendorGovernance)
    .where(and(eq(companyVendorGovernance.companyId, args.companyId), eq(companyVendorGovernance.supplierId, args.supplierId)))
    .limit(1);
  if (existing) {
    const [updated] = await db.update(companyVendorGovernance).set(values).where(eq(companyVendorGovernance.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(companyVendorGovernance).values(values).returning();
  return created;
}
