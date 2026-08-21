import { asc, eq, isNull, or } from "drizzle-orm";
import { maputoTodayIso, resolveFiscalRateOnDate, type FiscalRateKind } from "@sigo/shared";
import { db } from "../db/index.js";
import { fiscalRateProfiles } from "../db/schema.js";

export async function resolveCompanyFiscalRate(companyId: string, kind: FiscalRateKind, onDate?: string) {
  const date = onDate ?? maputoTodayIso();
  const rows = await db
    .select()
    .from(fiscalRateProfiles)
    .where(or(isNull(fiscalRateProfiles.companyId), eq(fiscalRateProfiles.companyId, companyId)))
    .orderBy(asc(fiscalRateProfiles.kind), asc(fiscalRateProfiles.effectiveFrom));

  const mapped = rows.map((row) => ({
    kind: row.kind as FiscalRateKind,
    rate: Number(row.rate),
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    source: row.source,
    reference: row.reference,
  }));

  const companyRows = mapped.filter((_, index) => rows[index].companyId === companyId);
  const nationalRows = mapped.filter((_, index) => rows[index].companyId == null);
  return resolveFiscalRateOnDate(companyRows, kind, date) ?? resolveFiscalRateOnDate(nationalRows, kind, date);
}

export async function resolveIvaRateForCompany(companyId: string, onDate?: string) {
  const hit = await resolveCompanyFiscalRate(companyId, "iva", onDate);
  return hit?.rate ?? null;
}
