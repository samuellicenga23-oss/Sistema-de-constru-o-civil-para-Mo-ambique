import puppeteer from "puppeteer";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  quoteRequests,
  quoteRequestLines,
  projects,
  suppliers,
  supplierAccounts,
  supplierMaterialPrices,
  supplierLabourPrices,
  supplierEquipmentPrices,
  priceZones,
} from "../db/schema.js";
import type { CompanyBrand } from "./companyBrand.js";
import { escapeHtml, pdfChromeStyles, pdfFooterHtml, pdfLetterheadHtml } from "./documentChrome.js";
import { assertSupplierMarketplaceAccess } from "./subscriptionEntitlements.js";
import { rankProcurementQuotes } from "./procurementEngine.js";
import { SIGO_PRICES_SUPPLIER_NAME } from "./sigoPrices.js";

export type QuoteComparisonOffer = {
  rank: number;
  supplierId: string;
  supplierName: string;
  isReference: boolean;
  unitCost: number;
  currency: string;
  zoneId: string | null;
  zoneName: string | null;
  inProjectZone: boolean;
  contact: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
};

export type QuoteComparisonItem = {
  kind: "material" | "labour" | "equipment";
  description: string;
  unit: string | null;
  quantity: number | null;
  offers: QuoteComparisonOffer[];
};

export type QuoteComparisonDocument = {
  title: string;
  projectName: string | null;
  zoneName: string | null;
  zoneId: string | null;
  currencyHint: string | null;
  generatedAt: string;
  items: QuoteComparisonItem[];
};

function money(n: number, currency: string) {
  return `${n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function fmtQty(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

type NormalizedPrice = {
  resourceId: string;
  supplierId: string;
  supplierName: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  unitCost: string;
  currency: string;
  zoneId: string | null;
  isReference: boolean;
};

function pickBestPerSupplier(rows: NormalizedPrice[], projectZoneId: string | null): NormalizedPrice[] {
  const bySupplier = new Map<string, NormalizedPrice>();
  for (const row of rows) {
    const current = bySupplier.get(row.supplierId);
    const rowIsZone = projectZoneId !== null && row.zoneId === projectZoneId;
    const currentIsZone = current != null && projectZoneId !== null && current.zoneId === projectZoneId;
    if (!current || (rowIsZone && !currentIsZone) || (rowIsZone === currentIsZone && Number(row.unitCost) < Number(current.unitCost))) {
      bySupplier.set(row.supplierId, row);
    }
  }
  return Array.from(bySupplier.values());
}

function filterZone(rows: NormalizedPrice[], projectZoneId: string | null): NormalizedPrice[] {
  if (!projectZoneId) return rows.filter((row) => row.zoneId === null);
  return rows.filter((row) => row.zoneId === null || row.zoneId === projectZoneId);
}

/** Monta a comparação de fornecedores para os itens de um pedido (zona → preço). Profissional+. */
export async function buildQuoteComparisonDocument(
  companyId: string,
  quoteRequestId: string,
): Promise<{ blocked: Awaited<ReturnType<typeof assertSupplierMarketplaceAccess>> } | { document: QuoteComparisonDocument }> {
  const blocked = await assertSupplierMarketplaceAccess(companyId);
  if (blocked) return { blocked };

  const [row] = await db
    .select({
      quoteRequest: quoteRequests,
      projectName: projects.name,
      projectZoneId: projects.zoneId,
      projectCurrency: projects.currency,
      zoneName: priceZones.name,
    })
    .from(quoteRequests)
    .leftJoin(projects, eq(quoteRequests.projectId, projects.id))
    .leftJoin(priceZones, eq(projects.zoneId, priceZones.id))
    .where(and(eq(quoteRequests.id, quoteRequestId), eq(quoteRequests.companyId, companyId)))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Pedido não encontrado"), { statusCode: 404 });
  }

  const lines = await db
    .select()
    .from(quoteRequestLines)
    .where(eq(quoteRequestLines.quoteRequestId, quoteRequestId))
    .orderBy(quoteRequestLines.sortOrder);

  const projectZoneId = row.projectZoneId ?? null;
  const materialIds = lines.filter((l) => l.kind === "material" && l.materialId).map((l) => l.materialId!);
  const labourIds = lines.filter((l) => l.kind === "labour" && l.labourCategoryId).map((l) => l.labourCategoryId!);
  const equipmentIds = lines.filter((l) => l.kind === "equipment" && l.equipmentId).map((l) => l.equipmentId!);

  const [materialRows, labourRows, equipmentRows, zoneNameRows] = await Promise.all([
    materialIds.length
      ? db
          .select({
            resourceId: supplierMaterialPrices.materialId,
            supplierId: suppliers.id,
            supplierName: suppliers.name,
            supplierContact: suppliers.contact,
            supplierLocation: suppliers.location,
            unitCost: supplierMaterialPrices.unitCost,
            currency: supplierMaterialPrices.currency,
            zoneId: supplierMaterialPrices.zoneId,
            accountEmail: supplierAccounts.email,
            accountPhone: supplierAccounts.phone,
          })
          .from(supplierMaterialPrices)
          .innerJoin(suppliers, eq(supplierMaterialPrices.supplierId, suppliers.id))
          .leftJoin(supplierAccounts, eq(suppliers.supplierAccountId, supplierAccounts.id))
          .where(and(eq(suppliers.companyId, companyId), inArray(supplierMaterialPrices.materialId, materialIds)))
      : Promise.resolve([]),
    labourIds.length
      ? db
          .select({
            resourceId: supplierLabourPrices.labourCategoryId,
            supplierId: suppliers.id,
            supplierName: suppliers.name,
            supplierContact: suppliers.contact,
            supplierLocation: suppliers.location,
            unitCost: supplierLabourPrices.hourlyCost,
            currency: supplierLabourPrices.currency,
            zoneId: supplierLabourPrices.zoneId,
            accountEmail: supplierAccounts.email,
            accountPhone: supplierAccounts.phone,
          })
          .from(supplierLabourPrices)
          .innerJoin(suppliers, eq(supplierLabourPrices.supplierId, suppliers.id))
          .leftJoin(supplierAccounts, eq(suppliers.supplierAccountId, supplierAccounts.id))
          .where(and(eq(suppliers.companyId, companyId), inArray(supplierLabourPrices.labourCategoryId, labourIds)))
      : Promise.resolve([]),
    equipmentIds.length
      ? db
          .select({
            resourceId: supplierEquipmentPrices.equipmentId,
            supplierId: suppliers.id,
            supplierName: suppliers.name,
            supplierContact: suppliers.contact,
            supplierLocation: suppliers.location,
            unitCost: supplierEquipmentPrices.hourlyCost,
            currency: supplierEquipmentPrices.currency,
            zoneId: supplierEquipmentPrices.zoneId,
            accountEmail: supplierAccounts.email,
            accountPhone: supplierAccounts.phone,
          })
          .from(supplierEquipmentPrices)
          .innerJoin(suppliers, eq(supplierEquipmentPrices.supplierId, suppliers.id))
          .leftJoin(supplierAccounts, eq(suppliers.supplierAccountId, supplierAccounts.id))
          .where(and(eq(suppliers.companyId, companyId), inArray(supplierEquipmentPrices.equipmentId, equipmentIds)))
      : Promise.resolve([]),
    db.select({ id: priceZones.id, name: priceZones.name }).from(priceZones),
  ]);

  const zoneNameById = new Map(zoneNameRows.map((z) => [z.id, z.name]));

  const toNormalized = (rows: typeof materialRows): NormalizedPrice[] =>
    rows.map((r) => ({
      resourceId: r.resourceId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      contact: r.accountPhone || r.supplierContact,
      email: r.accountEmail,
      phone: r.accountPhone || r.supplierContact,
      location: r.supplierLocation,
      unitCost: r.unitCost,
      currency: r.currency,
      zoneId: r.zoneId,
      isReference: r.supplierName === SIGO_PRICES_SUPPLIER_NAME,
    }));

  const groupByResource = (rows: NormalizedPrice[]) => {
    const map = new Map<string, NormalizedPrice[]>();
    for (const price of filterZone(rows, projectZoneId)) {
      const list = map.get(price.resourceId) ?? [];
      list.push(price);
      map.set(price.resourceId, list);
    }
    return map;
  };

  const materialsByResource = groupByResource(toNormalized(materialRows));
  const labourByResource = groupByResource(toNormalized(labourRows));
  const equipmentByResource = groupByResource(toNormalized(equipmentRows));

  const items: QuoteComparisonItem[] = lines.map((line) => {
    const resourceId =
      line.kind === "material" ? line.materialId : line.kind === "labour" ? line.labourCategoryId : line.equipmentId;
    const pool =
      line.kind === "material"
        ? materialsByResource.get(resourceId ?? "") ?? []
        : line.kind === "labour"
          ? labourByResource.get(resourceId ?? "") ?? []
          : equipmentByResource.get(resourceId ?? "") ?? [];

    const ranked = rankProcurementQuotes(pickBestPerSupplier(pool, projectZoneId), projectZoneId);
    const offers: QuoteComparisonOffer[] = ranked.map((offer, index) => ({
      rank: index + 1,
      supplierId: offer.supplierId,
      supplierName: offer.supplierName,
      isReference: offer.isReference,
      unitCost: Number(offer.unitCost),
      currency: offer.currency,
      zoneId: offer.zoneId,
      zoneName: offer.zoneId ? zoneNameById.get(offer.zoneId) ?? null : null,
      inProjectZone: projectZoneId != null && offer.zoneId === projectZoneId,
      contact: offer.contact,
      email: offer.email,
      phone: offer.phone,
      location: offer.location,
    }));

    return {
      kind: line.kind,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity != null ? Number(line.quantity) : null,
      offers,
    };
  });

  return {
    document: {
      title: row.quoteRequest.title,
      projectName: row.projectName,
      zoneName: row.zoneName,
      zoneId: projectZoneId,
      currencyHint: row.projectCurrency ?? null,
      generatedAt: new Date().toLocaleString("pt-MZ"),
      items,
    },
  };
}

function renderOffersTable(item: QuoteComparisonItem): string {
  if (!item.offers.length) {
    return `<p class="empty">Nenhum fornecedor com preço conhecido para este item na zona da obra.</p>`;
  }
  const rows = item.offers
    .map((offer) => {
      const contactBits = [offer.phone, offer.email, offer.location].filter(Boolean).map((v) => escapeHtml(v!));
      const zoneLabel = offer.inProjectZone
        ? escapeHtml(offer.zoneName ?? "Zona da obra")
        : offer.zoneName
          ? escapeHtml(offer.zoneName)
          : "Geral";
      return `<tr class="${offer.rank === 1 ? "best" : ""}">
        <td class="num">${offer.rank}</td>
        <td>${escapeHtml(offer.supplierName)}${offer.isReference ? ` <span class="tag">ref.</span>` : ""}</td>
        <td>${zoneLabel}</td>
        <td class="num">${money(offer.unitCost, offer.currency)}</td>
        <td class="contact">${contactBits.join("<br/>") || "—"}</td>
      </tr>`;
    })
    .join("");

  return `<table>
    <thead>
      <tr>
        <th class="num doc-th">#</th>
        <th class="doc-th">Fornecedor</th>
        <th class="doc-th">Zona / proximidade</th>
        <th class="num doc-th">Preço unit.</th>
        <th class="doc-th">Contactos</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildHtml(doc: QuoteComparisonDocument, brand: CompanyBrand): string {
  const accent = brand.primaryColor || "#ED6C22";
  const subtitleParts = [doc.projectName, doc.zoneName ? `Zona ${doc.zoneName}` : null].filter(Boolean);
  const itemsHtml = doc.items
    .map(
      (item) => `
      <h2 class="doc-section">${escapeHtml(item.description)}
        <span class="qty">${fmtQty(item.quantity)}${item.unit ? ` ${escapeHtml(item.unit)}` : ""}</span>
      </h2>
      ${renderOffersTable(item)}`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #14213d; margin: 22px; }
  .lead { color: #667085; margin: 0 0 14px; line-height: 1.45; font-size: 11px; }
  h2.doc-section { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; page-break-after: avoid; }
  h2 .qty { font-size: 11px; font-weight: 600; color: #667085; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { font-size: 10px; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.contact { font-size: 10px; color: #475467; line-height: 1.4; }
  tr.best td { background: #ecfdf5; font-weight: 600; }
  .tag { display: inline-block; font-size: 9px; font-weight: 700; color: #0f766e; background: #ccfbf1; padding: 1px 5px; border-radius: 4px; }
  .empty { color: #9ca3af; font-style: italic; margin: 4px 0 10px; }
  ${pdfChromeStyles(accent)}
</style>
</head>
<body>
  ${pdfLetterheadHtml(brand, {
    title: "Comparação de fornecedores",
    subtitle: doc.title,
    metaRight: `Gerado em ${doc.generatedAt}`,
  })}
  ${subtitleParts.length ? `<p class="lead">${escapeHtml(subtitleParts.join(" · "))}</p>` : ""}
  <p class="lead">
    Ordenação: primeiro fornecedores da <strong>zona da obra</strong> (proximidade), depois do <strong>melhor preço
    unitário ao mais caro</strong>. Contactos para comunicação directa. Disponível a partir do plano Profissional.
  </p>
  ${itemsHtml || `<p class="empty">Este pedido não tem linhas para comparar.</p>`}
  ${pdfFooterHtml(brand, "Comparação de fornecedores · SIGO Fornecedores")}
</body>
</html>`;
}

export async function buildQuoteComparisonPdf(doc: QuoteComparisonDocument, brand: CompanyBrand): Promise<Buffer> {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(doc, brand), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
