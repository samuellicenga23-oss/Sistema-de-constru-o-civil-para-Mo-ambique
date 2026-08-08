import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  auditEvents,
  budgetDocuments,
  budgetSections,
  companies,
  compositionEquipmentLines,
  compositionLabourLines,
  compositionMaterialLines,
  contractVariations,
  costCompositions,
  equipment,
  extractedOpenings,
  extractedRebarSchedules,
  extractedRooms,
  financialEntries,
  importCompositionMappings,
  invoiceCreditNotes,
  invoiceReceipts,
  labourCategories,
  lineItems,
  materialZonePrices,
  materials,
  measurementCertificateLines,
  measurementCertificates,
  measurementImportJobsTable,
  measurementLines,
  plants,
  paymentProofs,
  platformPayments,
  practiceAddenda,
  practiceClientRevisions,
  practiceClients,
  practiceDeliverables,
  practiceDocumentSeries,
  practiceEngagements,
  practiceExpenses,
  practiceInvoiceLines,
  practiceInvoices,
  practiceMilestones,
  practiceQuoteLines,
  practiceQuotes,
  practiceReceiptDestinations,
  practiceReceipts,
  practiceSchedulePhases,
  practiceTeamMembers,
  priceZones,
  projectContracts,
  projectInvoices,
  projectMaterialSpecifications,
  projects,
  procurementAwards,
  procurementAwardLines,
  procurementDocumentSequences,
  procurementRfqInvitations,
  procurementRfqLines,
  procurementRfqs,
  procurementSupplierQuoteLines,
  procurementSupplierQuotes,
  purchaseRequisitionLines,
  purchaseRequisitions,
  purchaseOrderLines,
  purchaseOrderShipmentLines,
  purchaseOrderShipments,
  purchaseOrderSupplierEvents,
  purchaseOrders,
  goodsReceiptLines,
  goodsReceipts,
  scheduleDependencies,
  scheduleTasks,
  siteDiaryEntries,
  siteDiaryTaskProgress,
  stockMovements,
  subscriptionCreditBalances,
  subscriptionCreditLedger,
  subscriptions,
  supplierEquipmentPrices,
  supplierLabourPrices,
  supplierMaterialPrices,
  suppliers,
  usageEvents,
  users,
  workItemTemplates,
} from "../db/schema.js";
import { env } from "../env.js";
import { PURGED_FILE_MARKER } from "./projectStorage.js";

export const FULL_BACKUP_FORMAT = "sigo-company-backup-v2";

type BackupFileEntry = {
  absolutePath: string;
  archivePath: string;
  bytes: number;
  kind: string;
  missing?: boolean;
};

async function fileMeta(absolutePath: string | null | undefined): Promise<{ bytes: number; missing: boolean } | null> {
  if (!absolutePath || absolutePath === PURGED_FILE_MARKER) return null;
  try {
    const s = await stat(absolutePath);
    if (!s.isFile()) return { bytes: 0, missing: true };
    return { bytes: s.size, missing: false };
  } catch {
    return { bytes: 0, missing: true };
  }
}

function pushFile(
  files: BackupFileEntry[],
  absolutePath: string,
  archivePath: string,
  kind: string,
  meta: { bytes: number; missing: boolean },
) {
  files.push({
    absolutePath,
    archivePath: archivePath.replace(/\\/g, "/"),
    bytes: meta.bytes,
    kind,
    missing: meta.missing || undefined,
  });
}

function resolveSiteDiaryPhoto(photoUrl: string): string | null {
  const match = photoUrl.match(/\/api\/files\/site-diary\/[^/]+\/([^/?#]+)/);
  if (!match?.[1]) return null;
  return path.join(env.uploadsDir, "site-diary", match[1]);
}

function idsOf<T extends { id: string }>(rows: T[]): string[] {
  return rows.map((r) => r.id);
}

/** Exporta dados + inventário de ficheiros da empresa (sem password hashes / sessões). */
export async function collectCompanyFullBackup(companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return null;

  const [
    subscriptionRows,
    paymentRows,
    paymentProofRows,
    userRows,
    projectRows,
    usageRows,
    creditBalanceRows,
    creditLedgerRows,
    labourRows,
    materialRows,
    zoneRows,
    equipmentRows,
    compositionRows,
    mappingRows,
    workTemplateRows,
    supplierRows,
    practiceClientRows,
    practiceSeriesRows,
    practiceQuoteRows,
    practiceEngagementRows,
    practiceInvoiceRows,
    practiceReceiptRows,
    auditRows,
    importJobRows,
  ] = await Promise.all([
    db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)),
    db.select().from(platformPayments).where(eq(platformPayments.companyId, companyId)),
    db.select().from(paymentProofs).where(eq(paymentProofs.companyId, companyId)),
    db
      .select({
        id: users.id,
        companyId: users.companyId,
        name: users.name,
        email: users.email,
        role: users.role,
        googleId: users.googleId,
        avatarUrl: users.avatarUrl,
        lastLoginAt: users.lastLoginAt,
        isActive: users.isActive,
        preferredLanguage: users.preferredLanguage,
        permissions: users.permissions,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.companyId, companyId)),
    db.select().from(projects).where(eq(projects.companyId, companyId)),
    db.select().from(usageEvents).where(eq(usageEvents.companyId, companyId)),
    db.select().from(subscriptionCreditBalances).where(eq(subscriptionCreditBalances.companyId, companyId)),
    db.select().from(subscriptionCreditLedger).where(eq(subscriptionCreditLedger.companyId, companyId)),
    db.select().from(labourCategories).where(eq(labourCategories.companyId, companyId)),
    db.select().from(materials).where(eq(materials.companyId, companyId)),
    db.select().from(priceZones).where(eq(priceZones.companyId, companyId)),
    db.select().from(equipment).where(eq(equipment.companyId, companyId)),
    db.select().from(costCompositions).where(eq(costCompositions.companyId, companyId)),
    db.select().from(importCompositionMappings).where(eq(importCompositionMappings.companyId, companyId)),
    db.select().from(workItemTemplates).where(eq(workItemTemplates.companyId, companyId)),
    db.select().from(suppliers).where(eq(suppliers.companyId, companyId)),
    db.select().from(practiceClients).where(eq(practiceClients.companyId, companyId)),
    db.select().from(practiceDocumentSeries).where(eq(practiceDocumentSeries.companyId, companyId)),
    db.select().from(practiceQuotes).where(eq(practiceQuotes.companyId, companyId)),
    db.select().from(practiceEngagements).where(eq(practiceEngagements.companyId, companyId)),
    db.select().from(practiceInvoices).where(eq(practiceInvoices.companyId, companyId)),
    db.select().from(practiceReceipts).where(eq(practiceReceipts.companyId, companyId)),
    db.select().from(auditEvents).where(eq(auditEvents.companyId, companyId)),
    db.select().from(measurementImportJobsTable).where(eq(measurementImportJobsTable.companyId, companyId)),
  ]);

  const projectIds = idsOf(projectRows);
  const compositionIds = idsOf(compositionRows);
  const zoneIds = idsOf(zoneRows);
  const supplierIds = idsOf(supplierRows);
  const quoteIds = idsOf(practiceQuoteRows);
  const engagementIds = idsOf(practiceEngagementRows);
  const practiceInvoiceIds = idsOf(practiceInvoiceRows);
  const practiceReceiptIds = idsOf(practiceReceiptRows);

  // Procurement é dado operacional da empresa e precisa viajar no backup completo. A Fase 1
  // criou a cadeia requisição → RFQ → proposta → adjudicação; a Fase 2 acrescenta expedições e
  // recepções. Não exportar estas tabelas deixaria purchase_orders/stock sem a sua origem.
  const [procurementSequenceRows, requisitionRows, procurementRfqRows] = await Promise.all([
    db.select().from(procurementDocumentSequences).where(eq(procurementDocumentSequences.companyId, companyId)),
    db.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.companyId, companyId)),
    db.select().from(procurementRfqs).where(eq(procurementRfqs.companyId, companyId)),
  ]);
  const requisitionIds = idsOf(requisitionRows);
  const procurementRfqIds = idsOf(procurementRfqRows);

  const [requisitionLineRows, procurementRfqLineRows, procurementInvitationRows, supplierQuoteRows, awardRows] = await Promise.all([
    requisitionIds.length
      ? db.select().from(purchaseRequisitionLines).where(inArray(purchaseRequisitionLines.requisitionId, requisitionIds))
      : Promise.resolve([]),
    procurementRfqIds.length
      ? db.select().from(procurementRfqLines).where(inArray(procurementRfqLines.rfqId, procurementRfqIds))
      : Promise.resolve([]),
    procurementRfqIds.length
      ? db.select().from(procurementRfqInvitations).where(inArray(procurementRfqInvitations.rfqId, procurementRfqIds))
      : Promise.resolve([]),
    procurementRfqIds.length
      ? db.select().from(procurementSupplierQuotes).where(inArray(procurementSupplierQuotes.rfqId, procurementRfqIds))
      : Promise.resolve([]),
    procurementRfqIds.length
      ? db.select().from(procurementAwards).where(inArray(procurementAwards.rfqId, procurementRfqIds))
      : Promise.resolve([]),
  ]);
  const supplierQuoteIds = idsOf(supplierQuoteRows);
  const awardIds = idsOf(awardRows);
  const [supplierQuoteLineRows, awardLineRows] = await Promise.all([
    supplierQuoteIds.length
      ? db.select().from(procurementSupplierQuoteLines).where(inArray(procurementSupplierQuoteLines.quoteId, supplierQuoteIds))
      : Promise.resolve([]),
    awardIds.length
      ? db.select().from(procurementAwardLines).where(inArray(procurementAwardLines.awardId, awardIds))
      : Promise.resolve([]),
  ]);

  const [
    zonePriceRows,
    compositionLabour,
    compositionMaterial,
    compositionEquipment,
    plantRows,
    documentRows,
    specRows,
    certificateRows,
    scheduleTaskRows,
    financialRows,
    invoiceRows,
    contractRows,
    diaryRows,
    purchaseOrderRows,
    stockRows,
  ] = await Promise.all([
    zoneIds.length
      ? db.select().from(materialZonePrices).where(inArray(materialZonePrices.zoneId, zoneIds))
      : Promise.resolve([]),
    compositionIds.length
      ? db.select().from(compositionLabourLines).where(inArray(compositionLabourLines.compositionId, compositionIds))
      : Promise.resolve([]),
    compositionIds.length
      ? db.select().from(compositionMaterialLines).where(inArray(compositionMaterialLines.compositionId, compositionIds))
      : Promise.resolve([]),
    compositionIds.length
      ? db.select().from(compositionEquipmentLines).where(inArray(compositionEquipmentLines.compositionId, compositionIds))
      : Promise.resolve([]),
    projectIds.length ? db.select().from(plants).where(inArray(plants.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length ? db.select().from(budgetDocuments).where(inArray(budgetDocuments.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length
      ? db.select().from(projectMaterialSpecifications).where(inArray(projectMaterialSpecifications.projectId, projectIds))
      : Promise.resolve([]),
    projectIds.length
      ? db.select().from(measurementCertificates).where(inArray(measurementCertificates.projectId, projectIds))
      : Promise.resolve([]),
    projectIds.length ? db.select().from(scheduleTasks).where(inArray(scheduleTasks.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length ? db.select().from(financialEntries).where(inArray(financialEntries.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length ? db.select().from(projectInvoices).where(inArray(projectInvoices.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length ? db.select().from(projectContracts).where(inArray(projectContracts.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length ? db.select().from(siteDiaryEntries).where(inArray(siteDiaryEntries.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length ? db.select().from(purchaseOrders).where(inArray(purchaseOrders.projectId, projectIds)) : Promise.resolve([]),
    projectIds.length ? db.select().from(stockMovements).where(inArray(stockMovements.projectId, projectIds)) : Promise.resolve([]),
  ]);

  const plantIds = idsOf(plantRows);
  const documentIds = idsOf(documentRows);
  const certificateIds = idsOf(certificateRows);
  const scheduleTaskIds = idsOf(scheduleTaskRows);
  const invoiceIds = idsOf(invoiceRows);
  const contractIds = idsOf(contractRows);
  const diaryIds = idsOf(diaryRows);
  const purchaseOrderIds = idsOf(purchaseOrderRows);

  const [shipmentRows, goodsReceiptRows, supplierEventRows] = await Promise.all([
    purchaseOrderIds.length
      ? db.select().from(purchaseOrderShipments).where(inArray(purchaseOrderShipments.purchaseOrderId, purchaseOrderIds))
      : Promise.resolve([]),
    purchaseOrderIds.length
      ? db.select().from(goodsReceipts).where(inArray(goodsReceipts.purchaseOrderId, purchaseOrderIds))
      : Promise.resolve([]),
    purchaseOrderIds.length
      ? db.select().from(purchaseOrderSupplierEvents).where(inArray(purchaseOrderSupplierEvents.purchaseOrderId, purchaseOrderIds))
      : Promise.resolve([]),
  ]);
  const shipmentIds = idsOf(shipmentRows);
  const goodsReceiptIds = idsOf(goodsReceiptRows);

  const [shipmentLineRows, goodsReceiptLineRows] = await Promise.all([
    shipmentIds.length
      ? db.select().from(purchaseOrderShipmentLines).where(inArray(purchaseOrderShipmentLines.shipmentId, shipmentIds))
      : Promise.resolve([]),
    goodsReceiptIds.length
      ? db.select().from(goodsReceiptLines).where(inArray(goodsReceiptLines.goodsReceiptId, goodsReceiptIds))
      : Promise.resolve([]),
  ]);

  const [
    sectionRows,
    roomRows,
    openingRows,
    rebarRows,
    certificateLineRows,
    scheduleDepRows,
    receiptRows,
    creditNoteRows,
    variationRows,
    diaryProgressRows,
    purchaseLineRows,
    supplierMaterialPriceRows,
    supplierLabourPriceRows,
    supplierEquipmentPriceRows,
    practiceQuoteLineRows,
    practiceTeamRows,
    practiceExpenseRows,
    practicePhaseRows,
    practiceDeliverableRows,
    practiceRevisionRows,
    practiceAddendaRows,
    practiceMilestoneRows,
    practiceInvoiceLineRows,
    practiceReceiptDestRows,
  ] = await Promise.all([
    documentIds.length ? db.select().from(budgetSections).where(inArray(budgetSections.documentId, documentIds)) : Promise.resolve([]),
    plantIds.length ? db.select().from(extractedRooms).where(inArray(extractedRooms.plantId, plantIds)) : Promise.resolve([]),
    plantIds.length ? db.select().from(extractedOpenings).where(inArray(extractedOpenings.plantId, plantIds)) : Promise.resolve([]),
    plantIds.length
      ? db.select().from(extractedRebarSchedules).where(inArray(extractedRebarSchedules.plantId, plantIds))
      : Promise.resolve([]),
    certificateIds.length
      ? db.select().from(measurementCertificateLines).where(inArray(measurementCertificateLines.certificateId, certificateIds))
      : Promise.resolve([]),
    scheduleTaskIds.length
      ? db
          .select()
          .from(scheduleDependencies)
          .where(
            and(
              inArray(scheduleDependencies.predecessorTaskId, scheduleTaskIds),
              inArray(scheduleDependencies.successorTaskId, scheduleTaskIds),
            ),
          )
      : Promise.resolve([]),
    invoiceIds.length ? db.select().from(invoiceReceipts).where(inArray(invoiceReceipts.invoiceId, invoiceIds)) : Promise.resolve([]),
    invoiceIds.length ? db.select().from(invoiceCreditNotes).where(inArray(invoiceCreditNotes.invoiceId, invoiceIds)) : Promise.resolve([]),
    contractIds.length
      ? db.select().from(contractVariations).where(inArray(contractVariations.contractId, contractIds))
      : Promise.resolve([]),
    diaryIds.length
      ? db.select().from(siteDiaryTaskProgress).where(inArray(siteDiaryTaskProgress.diaryEntryId, diaryIds))
      : Promise.resolve([]),
    purchaseOrderIds.length
      ? db.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, purchaseOrderIds))
      : Promise.resolve([]),
    supplierIds.length
      ? db.select().from(supplierMaterialPrices).where(inArray(supplierMaterialPrices.supplierId, supplierIds))
      : Promise.resolve([]),
    supplierIds.length
      ? db.select().from(supplierLabourPrices).where(inArray(supplierLabourPrices.supplierId, supplierIds))
      : Promise.resolve([]),
    supplierIds.length
      ? db.select().from(supplierEquipmentPrices).where(inArray(supplierEquipmentPrices.supplierId, supplierIds))
      : Promise.resolve([]),
    quoteIds.length ? db.select().from(practiceQuoteLines).where(inArray(practiceQuoteLines.quoteId, quoteIds)) : Promise.resolve([]),
    engagementIds.length
      ? db.select().from(practiceTeamMembers).where(inArray(practiceTeamMembers.engagementId, engagementIds))
      : Promise.resolve([]),
    engagementIds.length
      ? db.select().from(practiceExpenses).where(inArray(practiceExpenses.engagementId, engagementIds))
      : Promise.resolve([]),
    engagementIds.length
      ? db.select().from(practiceSchedulePhases).where(inArray(practiceSchedulePhases.engagementId, engagementIds))
      : Promise.resolve([]),
    engagementIds.length
      ? db.select().from(practiceDeliverables).where(inArray(practiceDeliverables.engagementId, engagementIds))
      : Promise.resolve([]),
    engagementIds.length
      ? db.select().from(practiceClientRevisions).where(inArray(practiceClientRevisions.engagementId, engagementIds))
      : Promise.resolve([]),
    engagementIds.length
      ? db.select().from(practiceAddenda).where(inArray(practiceAddenda.engagementId, engagementIds))
      : Promise.resolve([]),
    engagementIds.length
      ? db.select().from(practiceMilestones).where(inArray(practiceMilestones.engagementId, engagementIds))
      : Promise.resolve([]),
    practiceInvoiceIds.length
      ? db.select().from(practiceInvoiceLines).where(inArray(practiceInvoiceLines.invoiceId, practiceInvoiceIds))
      : Promise.resolve([]),
    practiceReceiptIds.length
      ? db.select().from(practiceReceiptDestinations).where(inArray(practiceReceiptDestinations.receiptId, practiceReceiptIds))
      : Promise.resolve([]),
  ]);

  const sectionIds = idsOf(sectionRows);
  const lineItemRows = sectionIds.length
    ? await db.select().from(lineItems).where(inArray(lineItems.sectionId, sectionIds))
    : [];
  const lineItemIds = idsOf(lineItemRows);
  const measurementLineRows = lineItemIds.length
    ? await db.select().from(measurementLines).where(inArray(measurementLines.lineItemId, lineItemIds))
    : [];

  const files: BackupFileEntry[] = [];

  if (company.logoUrl) {
    const base = path.basename(company.logoUrl);
    const absolutePath = path.join(env.uploadsDir, "logos", base);
    const meta = await fileMeta(absolutePath);
    if (meta) pushFile(files, absolutePath, `files/logos/${base}`, "logo", meta);
  }

  for (const user of userRows) {
    if (!user.avatarUrl) continue;
    const base = path.basename(user.avatarUrl);
    const absolutePath = path.join(env.uploadsDir, "avatars", base);
    const meta = await fileMeta(absolutePath);
    if (meta) pushFile(files, absolutePath, `files/avatars/${base}`, "avatar", meta);
  }

  for (const plant of plantRows) {
    if (!plant.filePath || plant.filePath === PURGED_FILE_MARKER) continue;
    const base = path.basename(plant.filePath);
    const meta = await fileMeta(plant.filePath);
    if (meta) pushFile(files, plant.filePath, `files/plants/${plant.projectId}/${plant.id}_${base}`, "plant", meta);
  }

  for (const entry of diaryRows) {
    for (const url of entry.photoUrls ?? []) {
      const absolutePath = resolveSiteDiaryPhoto(url);
      if (!absolutePath) continue;
      const base = path.basename(absolutePath);
      const meta = await fileMeta(absolutePath);
      if (meta) pushFile(files, absolutePath, `files/site-diary/${entry.projectId}/${entry.id}_${base}`, "site_diary", meta);
    }
  }

  for (const job of importJobRows) {
    if (!job.filePath || job.filePath === PURGED_FILE_MARKER) continue;
    const base = path.basename(job.filePath);
    const meta = await fileMeta(job.filePath);
    if (meta) pushFile(files, job.filePath, `files/import-jobs/${job.id}_${base}`, "import_job", meta);
  }

  for (const receipt of receiptRows) {
    if (!receipt.proofFilePath) continue;
    const base = path.basename(receipt.proofFilePath);
    const meta = await fileMeta(receipt.proofFilePath);
    if (meta) pushFile(files, receipt.proofFilePath, `files/invoice-receipts/${receipt.id}_${base}`, "invoice_proof", meta);
  }

  for (const proof of paymentProofRows) {
    if (!proof.filePath || proof.filePath === PURGED_FILE_MARKER) continue;
    const absolute = path.isAbsolute(proof.filePath)
      ? proof.filePath
      : path.join(env.uploadsDir, proof.filePath);
    const base = path.basename(absolute);
    const meta = await fileMeta(absolute);
    if (meta) pushFile(files, absolute, `files/payment-proofs/${proof.id}_${base}`, "payment_proof", meta);
  }

  const presentFiles = files.filter((f) => !f.missing);
  const missingFiles = files.filter((f) => f.missing);

  const data = {
    exportedAt: new Date().toISOString(),
    format: FULL_BACKUP_FORMAT,
    notes: [
      "Backup completo da empresa: metadados + ficheiros existentes em disco.",
      "Palavras-passe e sessões não são incluídas.",
      "Ficheiros marcados como purged (lixo) não entram no ZIP.",
    ],
    company,
    subscriptions: subscriptionRows,
    payments: paymentRows,
    paymentProofs: paymentProofRows,
    users: userRows,
    usageEvents: usageRows,
    credits: {
      balances: creditBalanceRows,
      ledger: creditLedgerRows,
    },
    catalog: {
      labourCategories: labourRows,
      materials: materialRows,
      priceZones: zoneRows,
      materialZonePrices: zonePriceRows,
      equipment: equipmentRows,
      costCompositions: compositionRows,
      compositionLabourLines: compositionLabour,
      compositionMaterialLines: compositionMaterial,
      compositionEquipmentLines: compositionEquipment,
      workItemTemplates: workTemplateRows,
      importCompositionMappings: mappingRows,
    },
    projects: projectRows,
    projectMaterialSpecifications: specRows,
    plants: plantRows,
    extractedRooms: roomRows,
    extractedOpenings: openingRows,
    extractedRebarSchedules: rebarRows,
    budgetDocuments: documentRows,
    budgetSections: sectionRows,
    lineItems: lineItemRows,
    measurementLines: measurementLineRows,
    measurementImportJobs: importJobRows,
    measurementCertificates: certificateRows,
    measurementCertificateLines: certificateLineRows,
    scheduleTasks: scheduleTaskRows,
    scheduleDependencies: scheduleDepRows,
    financialEntries: financialRows,
    projectInvoices: invoiceRows,
    invoiceReceipts: receiptRows,
    invoiceCreditNotes: creditNoteRows,
    projectContracts: contractRows,
    contractVariations: variationRows,
    siteDiaryEntries: diaryRows,
    siteDiaryTaskProgress: diaryProgressRows,
    suppliers: supplierRows,
    supplierMaterialPrices: supplierMaterialPriceRows,
    supplierLabourPrices: supplierLabourPriceRows,
    supplierEquipmentPrices: supplierEquipmentPriceRows,
    procurement: {
      documentSequences: procurementSequenceRows,
      requisitions: requisitionRows,
      requisitionLines: requisitionLineRows,
      rfqs: procurementRfqRows,
      rfqLines: procurementRfqLineRows,
      invitations: procurementInvitationRows,
      supplierQuotes: supplierQuoteRows,
      supplierQuoteLines: supplierQuoteLineRows,
      awards: awardRows,
      awardLines: awardLineRows,
      shipments: shipmentRows,
      shipmentLines: shipmentLineRows,
      goodsReceipts: goodsReceiptRows,
      goodsReceiptLines: goodsReceiptLineRows,
      supplierEvents: supplierEventRows,
    },
    purchaseOrders: purchaseOrderRows,
    purchaseOrderLines: purchaseLineRows,
    stockMovements: stockRows,
    practice: {
      clients: practiceClientRows,
      documentSeries: practiceSeriesRows,
      quotes: practiceQuoteRows,
      quoteLines: practiceQuoteLineRows,
      engagements: practiceEngagementRows,
      teamMembers: practiceTeamRows,
      expenses: practiceExpenseRows,
      schedulePhases: practicePhaseRows,
      deliverables: practiceDeliverableRows,
      clientRevisions: practiceRevisionRows,
      addenda: practiceAddendaRows,
      invoices: practiceInvoiceRows,
      milestones: practiceMilestoneRows,
      invoiceLines: practiceInvoiceLineRows,
      receipts: practiceReceiptRows,
      receiptDestinations: practiceReceiptDestRows,
    },
    auditEvents: auditRows,
    files: files.map(({ archivePath, bytes, kind, missing }) => ({
      archivePath,
      bytes,
      kind,
      missing: missing ?? false,
    })),
  };

  return {
    company,
    data,
    files: presentFiles,
    missingFiles,
    totals: {
      projects: projectRows.length,
      plants: plantRows.length,
      documents: documentRows.length,
      users: userRows.length,
      filesIncluded: presentFiles.length,
      filesMissing: missingFiles.length,
      bytesIncluded: presentFiles.reduce((sum, f) => sum + f.bytes, 0),
    },
  };
}

/** Cria um stream ZIP com data.json + ficheiros da empresa. */
export async function streamCompanyFullBackupZip(companyId: string): Promise<{
  stream: Readable;
  filename: string;
  totals: NonNullable<Awaited<ReturnType<typeof collectCompanyFullBackup>>>["totals"];
} | null> {
  const collected = await collectCompanyFullBackup(companyId);
  if (!collected) return null;

  const slug = collected.company.name.replace(/[^\w\-]+/g, "_").slice(0, 40) || companyId.slice(0, 8);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `sigo-backup-full-${slug}-${date}.zip`;

  const archive = archiver("zip", { zlib: { level: 6 } });
  const manifest = {
    format: FULL_BACKUP_FORMAT,
    exportedAt: collected.data.exportedAt,
    companyId: collected.company.id,
    companyName: collected.company.name,
    totals: collected.totals,
    missingFiles: collected.missingFiles.map((f) => ({ archivePath: f.archivePath, kind: f.kind })),
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.append(JSON.stringify(collected.data, null, 2), { name: "data.json" });

  for (const file of collected.files) {
    if (!existsSync(file.absolutePath)) continue;
    archive.append(createReadStream(file.absolutePath), { name: file.archivePath });
  }

  void archive.finalize();

  return {
    stream: archive as unknown as Readable,
    filename,
    totals: collected.totals,
  };
}
