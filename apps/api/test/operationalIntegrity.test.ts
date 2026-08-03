import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { budgetDocuments, invoiceCreditNotes, invoiceReceipts, measurementCertificates, projectInvoices, projects } from "../src/db/schema.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";

describe("Integridade operacional financeira", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ logger: false }); });
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await app.close(); });

  async function invoiceContext(netAmount = 1000) {
    const company = await createCompany("Empresa íntegra");
    const preparer = await createUser(company.id, "orcamentista", "preparer@integrity.local");
    const admin = await createUser(company.id, "admin_empresa", "admin@integrity.local");
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Obra segura", currency: "MZN" }).returning();
    const [document] = await db.insert(budgetDocuments).values({ projectId: project.id, title: "Orçamento", currency: "MZN", status: "aprovado" }).returning();
    const [certificate] = await db.insert(measurementCertificates).values({ projectId: project.id, budgetDocumentId: document.id, number: 1, periodDate: "2026-08-03", status: "aprovado" }).returning();
    const [invoice] = await db.insert(projectInvoices).values({ projectId: project.id, measurementCertificateId: certificate.id, invoiceNumber: "FT-001", issueDate: "2026-08-03", status: "emitida", grossAmount: netAmount.toFixed(2), ivaRate: "0.16", netAmount: netAmount.toFixed(2), currency: "MZN", createdByUserId: preparer.id, issuedByUserId: admin.id }).returning();
    return { company, preparer, admin, project, invoice, adminCookie: await loginCookie(app, admin.email) };
  }

  it("não duplica um recebimento quando o mesmo pedido é repetido", async () => {
    const { invoice, adminCookie } = await invoiceContext();
    const request = { method: "POST" as const, url: `/api/invoices/${invoice.id}/receipts`, headers: { cookie: adminCookie, "idempotency-key": "payment-bank-001" }, payload: { amount: 250, receivedDate: "2026-08-03", reference: "TRX-001" } };
    const first = await app.inject(request);
    const repeated = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toMatchObject({ existing: true, paidAmount: 250, outstandingAmount: 750 });
    expect(await db.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, invoice.id))).toHaveLength(1);
  });

  it("serializa notas de crédito concorrentes e impede crédito acima do saldo", async () => {
    const { invoice, preparer, adminCookie } = await invoiceContext();
    const notes = await db.insert(invoiceCreditNotes).values([
      { invoiceId: invoice.id, creditNumber: "NC-001", issueDate: "2026-08-03", amount: "600", reason: "Correcção contratual A", createdByUserId: preparer.id },
      { invoiceId: invoice.id, creditNumber: "NC-002", issueDate: "2026-08-03", amount: "600", reason: "Correcção contratual B", createdByUserId: preparer.id },
    ]).returning();
    const responses = await Promise.all(notes.map((note) => app.inject({ method: "PUT", url: `/api/credit-notes/${note.id}/issue`, headers: { cookie: adminCookie } })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const stored = await db.select().from(invoiceCreditNotes).where(eq(invoiceCreditNotes.invoiceId, invoice.id));
    expect(stored.filter((note) => note.status === "emitida")).toHaveLength(1);
  });
});
