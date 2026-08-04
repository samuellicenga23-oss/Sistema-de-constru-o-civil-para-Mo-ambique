import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetDocuments,
  practiceAddenda,
  practiceClients,
  practiceClientRevisions,
  practiceDeliverables,
  practiceDocumentSeries,
  practiceEngagements,
  practiceExpenses,
  practiceInvoices,
  practiceInvoiceLines,
  practiceMilestones,
  practiceQuotes,
  practiceQuoteLines,
  practiceReceipts,
  practiceReceiptDestinations,
  practiceSchedulePhases,
  practiceTeamMembers,
  projects,
} from "../db/schema.js";
import { requirePermission } from "../auth/middleware.js";
import { CURRENCIES } from "@sigo/shared";
import { recordAuditEvent } from "../services/auditTrail.js";
import { assertDocumentOwned } from "../services/accessControl.js";
import { getBudgetDocumentSummary, type LineItemNode } from "../services/boqEngine.js";
import { loadCompanyBrand } from "../services/companyBrand.js";
import { syncPracticeInvoiceReceivable } from "../services/practiceLedger.js";
import { buildPracticeDocumentPdf } from "../services/practiceDocumentPdf.js";

const canView = requirePermission("escritorio.ver");
const canManage = requirePermission("escritorio.gerir");

const DEFAULT_PHASES = [
  { title: "Adjudicação", percent: 10 },
  { title: "Estudo prévio", percent: 20 },
  { title: "Licenciamento", percent: 30 },
  { title: "Execução", percent: 30 },
  { title: "Assistência", percent: 10 },
] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().min(1).default("un"),
  unitPrice: z.number().nonnegative(),
  phase: z.string().max(120).optional(),
  specialty: z.string().max(120).optional().nullable(),
  included: z.boolean().optional().default(true),
  optional: z.boolean().optional().default(false),
  durationDays: z.number().int().positive().optional().nullable(),
});

const conditionsSchema = z
  .object({
    intro: z.string().optional(),
    objectText: z.string().optional(),
    paymentTerms: z.string().optional(),
    exclusions: z.string().optional(),
    revisionsIncluded: z.number().int().nonnegative().optional(),
    taxNote: z.string().optional(),
    reimbursablesNote: z.string().optional(),
    validityText: z.string().optional(),
    deadlineText: z.string().optional(),
    additionalNotes: z.string().optional(),
    acceptanceText: z.string().optional(),
  })
  .optional();

const quoteSchema = z.object({
  title: z.string().min(1).max(240),
  clientName: z.string().min(1).max(200),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  sourceBudgetDocumentId: z.string().uuid().nullable().optional(),
  quoteNumber: z.string().max(80).optional(),
  issueDate: z.string().optional(),
  validUntil: z.string().optional(),
  currency: z.enum(CURRENCIES).default("MZN"),
  notes: z.string().optional(),
  serviceCategory: z.enum(["project", "technical", "construction"]).optional().nullable(),
  serviceType: z.string().max(80).optional().nullable(),
  pricingMode: z.string().max(40).optional().nullable(),
  projectDesignation: z.string().max(240).optional().nullable(),
  workType: z.string().max(120).optional().nullable(),
  location: z.string().max(240).optional().nullable(),
  ownerName: z.string().max(200).optional().nullable(),
  estimatedArea: z.string().max(80).optional().nullable(),
  floors: z.string().max(40).optional().nullable(),
  projectDescription: z.string().optional().nullable(),
  observations: z.string().optional().nullable(),
  plannedStartDate: z.string().optional().nullable(),
  clientDeadline: z.string().max(120).optional().nullable(),
  conditions: conditionsSchema,
  lines: z.array(lineSchema).min(1),
  assignNumber: z.boolean().optional().default(true),
});

const quoteStatusSchema = z.object({
  status: z.enum(["rascunho", "enviada", "aprovada", "rejeitada", "cancelada"]),
  createEngagement: z.boolean().optional().default(true),
  /** Valor aceite (com desconto). Se omitido na aprovação, usa o total proposto. */
  acceptedAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  acceptanceNotes: z.string().max(4000).optional(),
});

const invoiceSchema = z.object({
  quoteId: z.string().uuid().nullable().optional(),
  engagementId: z.string().uuid().nullable().optional(),
  clientName: z.string().min(1).max(200),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  invoiceNumber: z.string().max(80).optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().min(1),
  currency: z.enum(CURRENCIES).default("MZN"),
  ivaRate: z.number().min(0).max(1).default(0),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1),
  status: z.enum(["rascunho", "emitida"]).default("emitida"),
});

const destinationSchema = z.object({
  kind: z.enum(["caixa", "terceiro"]),
  amount: z.number().positive(),
  partyName: z.string().max(200).optional(),
  description: z.string().optional(),
});

const receiptSchema = z.object({
  amount: z.number().positive(),
  receivedDate: z.string().min(1),
  reference: z.string().max(150).optional(),
  notes: z.string().optional(),
  destinations: z.array(destinationSchema).min(1),
});

const clientSchema = z.object({
  name: z.string().min(1).max(200),
  contact: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  phone: z.string().max(80).optional().nullable(),
  address: z.string().optional().nullable(),
  nuit: z.string().max(50).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const SERVICE_PROJECT_TYPES = [
  "Arquitectura",
  "Engenharia",
  "Fiscalização",
  "Consultoria",
  "Coordenação",
  "Outro",
] as const;

const engagementUpdateSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  serviceProjectType: z.enum(SERVICE_PROJECT_TYPES).nullable().optional(),
  serviceType: z.string().max(80).nullable().optional(),
  notes: z.string().optional().nullable(),
  status: z.enum(["rascunho", "activo", "concluido", "cancelado"]).optional(),
});

const teamMemberSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().min(1).max(120),
  specialty: z.string().max(120).optional().nullable(),
  contact: z.string().max(200).optional().nullable(),
  isExternal: z.boolean().optional().default(false),
  payMode: z.enum(["fixo", "percentagem", "hora", "dia", "entregavel", "fase"]).default("fixo"),
  agreedAmount: z.number().nonnegative().optional().default(0),
  percent: z.number().min(0).max(100).optional().nullable(),
  hourlyRate: z.number().nonnegative().optional().nullable(),
  hours: z.number().nonnegative().optional().nullable(),
  dailyRate: z.number().nonnegative().optional().nullable(),
  days: z.number().nonnegative().optional().nullable(),
  deliverableLabel: z.string().max(200).optional().nullable(),
  phaseLabel: z.string().max(120).optional().nullable(),
  plannedPayDate: z.string().optional().nullable(),
  paidAmount: z.number().nonnegative().optional(),
  payStatus: z.enum(["pendente", "parcial", "pago"]).optional(),
  notes: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const expenseSchema = z.object({
  kind: z.enum(["interno", "reembolsavel"]).default("interno"),
  category: z.string().min(1).max(80),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
  incurredDate: z.string().optional().nullable(),
  paidAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const PHASE_STATUSES = [
  "nao_iniciado",
  "em_preparacao",
  "em_curso",
  "aguardando_cliente",
  "aguardando_terceiro",
  "em_revisao",
  "concluido",
  "suspenso",
  "atrasado",
] as const;

const DELIVERABLE_STATUSES = ["pendente", "em_curso", "entregue", "em_revisao", "aprovado", "rejeitado"] as const;

const ADDENDUM_KINDS = [
  "trabalho_adicional",
  "alteracao_escopo",
  "nova_especialidade",
  "revisao_extraordinaria",
  "extensao_fiscalizacao",
  "consultoria_adicional",
] as const;

const schedulePhaseSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeName: z.string().max(200).optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  durationDays: z.number().int().nonnegative().optional().nullable(),
  status: z.enum(PHASE_STATUSES).optional(),
  notes: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const deliverableSchema = z.object({
  title: z.string().min(1).max(240),
  phaseId: z.string().uuid().optional().nullable(),
  assigneeName: z.string().max(200).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  status: z.enum(DELIVERABLE_STATUSES).optional(),
  deliveredAt: z.string().optional().nullable(),
  revisionNumber: z.number().int().nonnegative().optional(),
  version: z.string().max(40).optional().nullable(),
  notes: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const clientRevisionSchema = z.object({
  revisionDate: z.string().min(1),
  description: z.string().min(1),
  assigneeName: z.string().max(200).optional().nullable(),
  phaseId: z.string().uuid().optional().nullable(),
  deliverableId: z.string().uuid().optional().nullable(),
  impactDays: z.number().int().optional().default(0),
  impactAmount: z.number().nonnegative().optional().default(0),
  includedInContract: z.boolean().optional().default(true),
  isAdditionalWork: z.boolean().optional().default(false),
  notes: z.string().optional().nullable(),
});

const addendumSchema = z.object({
  kind: z.enum(ADDENDUM_KINDS).default("trabalho_adicional"),
  title: z.string().min(1).max(240),
  description: z.string().optional().nullable(),
  amount: z.number().nonnegative().optional().default(0),
  impactDays: z.number().int().optional().default(0),
  status: z.enum(["rascunho", "enviada", "aprovada", "rejeitada", "cancelada"]).optional(),
  revisionId: z.string().uuid().optional().nullable(),
  assignNumber: z.boolean().optional().default(true),
});

function inferServiceProjectType(serviceType: string | null | undefined): (typeof SERVICE_PROJECT_TYPES)[number] | null {
  if (!serviceType) return null;
  const t = serviceType.toLowerCase();
  if (t.includes("execucao") || t.includes("obra")) return null;
  if (t.includes("fiscal")) return "Fiscalização";
  if (t.includes("coordena") || t.includes("gestao")) return "Coordenação";
  if (
    t.includes("consult") ||
    t.includes("assistencia") ||
    t.includes("levantamento") ||
    t.includes("avaliacao") ||
    t.includes("revisao") ||
    t.includes("preparacao")
  ) {
    return "Consultoria";
  }
  if (
    t.includes("arquitect") ||
    t.includes("completo") ||
    t.includes("projecto_base") ||
    t.includes("estudo") ||
    t.includes("compatibil")
  ) {
    return "Arquitectura";
  }
  if (
    t.includes("estrutural") ||
    t.includes("hidro") ||
    t.includes("electric") ||
    t.includes("avac") ||
    t.includes("sci") ||
    t.includes("telecom") ||
    t.includes("drenagem") ||
    t.includes("arranjos") ||
    t.includes("especialidade")
  ) {
    return "Engenharia";
  }
  return "Outro";
}

function plannedTeamPay(
  member: {
    payMode: string;
    agreedAmount?: string | number | null;
    percent?: string | number | null;
    hourlyRate?: string | number | null;
    hours?: string | number | null;
    dailyRate?: string | number | null;
    days?: string | number | null;
  },
  contractTotal: number,
) {
  switch (member.payMode) {
    case "percentagem":
      return Number((((Number(member.percent) || 0) / 100) * contractTotal).toFixed(2));
    case "hora":
      return Number(((Number(member.hourlyRate) || 0) * (Number(member.hours) || 0)).toFixed(2));
    case "dia":
      return Number(((Number(member.dailyRate) || 0) * (Number(member.days) || 0)).toFixed(2));
    case "entregavel":
    case "fase":
    case "fixo":
    default:
      return Number((Number(member.agreedAmount) || 0).toFixed(2));
  }
}

function derivePayStatus(planned: number, paid: number): "pendente" | "parcial" | "pago" {
  if (paid <= 0.009) return "pendente";
  if (paid + 0.009 >= planned) return "pago";
  return "parcial";
}

function resolvePhaseDates(data: {
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
}) {
  let startDate = data.startDate ?? null;
  let endDate = data.endDate ?? null;
  let durationDays = data.durationDays ?? null;
  if (startDate && endDate && (durationDays == null || durationDays === 0)) {
    const ms = new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime();
    durationDays = Math.max(0, Math.round(ms / 86_400_000));
  } else if (startDate && durationDays != null && !endDate) {
    const end = new Date(`${startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + durationDays);
    endDate = end.toISOString().slice(0, 10);
  }
  return { startDate, endDate, durationDays };
}

function effectivePhaseStatus(
  status: (typeof PHASE_STATUSES)[number],
  endDate: string | null,
): (typeof PHASE_STATUSES)[number] {
  if (status === "concluido" || status === "suspenso" || status === "atrasado") return status;
  if (endDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (endDate < today) return "atrasado";
  }
  return status;
}

async function nextAddendumNumber(engagement: typeof practiceEngagements.$inferSelect) {
  let base = `CTR-${engagement.id.slice(0, 8).toUpperCase()}`;
  if (engagement.quoteId) {
    const [quote] = await db.select().from(practiceQuotes).where(eq(practiceQuotes.id, engagement.quoteId)).limit(1);
    if (quote?.quoteNumber) base = quote.quoteNumber;
  }
  const existing = await db
    .select()
    .from(practiceAddenda)
    .where(eq(practiceAddenda.engagementId, engagement.id));
  const seq = existing.length + 1;
  return `${base}-A${String(seq).padStart(2, "0")}`;
}

async function engagementOps(engagementId: string) {
  const [schedule, deliverables, revisions, addenda] = await Promise.all([
    db
      .select()
      .from(practiceSchedulePhases)
      .where(eq(practiceSchedulePhases.engagementId, engagementId))
      .orderBy(practiceSchedulePhases.sortOrder),
    db
      .select()
      .from(practiceDeliverables)
      .where(eq(practiceDeliverables.engagementId, engagementId))
      .orderBy(practiceDeliverables.sortOrder),
    db
      .select()
      .from(practiceClientRevisions)
      .where(eq(practiceClientRevisions.engagementId, engagementId))
      .orderBy(desc(practiceClientRevisions.revisionDate)),
    db
      .select()
      .from(practiceAddenda)
      .where(eq(practiceAddenda.engagementId, engagementId))
      .orderBy(desc(practiceAddenda.createdAt)),
  ]);

  const scheduleRows = schedule.map((phase) => ({
    ...phase,
    effectiveStatus: effectivePhaseStatus(phase.status, phase.endDate),
  }));

  const today = new Date().toISOString().slice(0, 10);
  const completedPhases = scheduleRows.filter((p) => (p.effectiveStatus ?? p.status) === "concluido").length;
  const progressPct = scheduleRows.length
    ? Number(((completedPhases / scheduleRows.length) * 100).toFixed(1))
    : 0;
  const endDates = scheduleRows.map((p) => p.endDate).filter(Boolean).sort() as string[];
  const contractEnd = endDates.slice(-1)[0] ?? null;
  let daysRemaining: number | null = null;
  if (contractEnd) {
    daysRemaining = Math.round(
      (new Date(`${contractEnd}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
    );
  }
  const overduePhases = scheduleRows.filter((p) => (p.effectiveStatus ?? p.status) === "atrasado").length;
  const deliverablesDone = deliverables.filter((d) => d.status === "aprovado" || d.status === "entregue").length;
  const nextActivities = [
    ...scheduleRows
      .filter((p) => !["concluido", "suspenso"].includes(p.effectiveStatus ?? p.status))
      .map((p) => ({
        kind: "fase" as const,
        id: p.id,
        title: p.title,
        date: p.startDate || p.endDate,
        status: p.effectiveStatus ?? p.status,
      })),
    ...deliverables
      .filter((d) => !["aprovado", "entregue"].includes(d.status))
      .map((d) => ({
        kind: "entregavel" as const,
        id: d.id,
        title: d.title,
        date: d.dueDate,
        status: d.status,
      })),
  ]
    .sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")))
    .slice(0, 6);

  return {
    schedule: scheduleRows,
    deliverables,
    revisions,
    addenda,
    opsKpis: {
      progressPct,
      daysRemaining,
      contractEnd,
      overduePhases,
      phasesTotal: scheduleRows.length,
      phasesDone: completedPhases,
      deliverablesTotal: deliverables.length,
      deliverablesDone,
      revisionsOpen: revisions.filter((r) => r.isAdditionalWork && !r.addendumId).length,
      addendaOpen: addenda.filter((a) => ["rascunho", "enviada"].includes(a.status)).length,
      nextActivities,
    },
  };
}

function collectBudgetLeafLines(nodes: LineItemNode[], phase: string): Array<{
  phase: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}> {
  const lines: Array<{ phase: string; description: string; quantity: number; unit: string; unitPrice: number }> = [];
  for (const node of nodes) {
    if (node.kind === "nota") continue;
    if (node.kind === "item") {
      const qty = node.quantity ?? 0;
      if (qty <= 0) continue;
      const unitPrice = node.sellingUnitPrice ?? node.unitPrice ?? 0;
      lines.push({
        phase,
        description: [node.code, node.description].filter(Boolean).join(" — "),
        quantity: qty,
        unit: node.unit || "un",
        unitPrice: Number(unitPrice.toFixed(2)),
      });
      continue;
    }
    const childPhase = node.kind === "capitulo" || node.kind === "grupo" ? node.description : phase;
    lines.push(...collectBudgetLeafLines(node.children, childPhase));
  }
  return lines;
}

function buildQuoteLinesFromBudget(
  summary: NonNullable<Awaited<ReturnType<typeof getBudgetDocumentSummary>>>,
  attachMode: "nada" | "resumo" | "mapa",
) {
  const docLabel = [
    summary.document.documentType === "medicao" ? "Medição" : "Orçamento",
    summary.document.fileNumber || summary.document.title,
    summary.document.revision ? `rev. ${summary.document.revision}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (attachMode === "nada") {
    return [
      {
        description: `Execução de obra conforme ${docLabel}`,
        quantity: 1,
        unit: "vb",
        unitPrice: Number(summary.total.toFixed(2)),
        phase: "Execução",
        specialty: null as string | null,
        included: true,
        optional: false,
      },
    ];
  }

  if (attachMode === "resumo") {
    // sellingTotal já incorpora estaleiro/indirectos/margem via factor; acrescentar só contingências + IVA.
    const chapterLines = summary.sections
      .map((section) => ({
        description: section.name,
        quantity: 1,
        unit: "vb",
        unitPrice: Number((section.sellingTotal || section.total || 0).toFixed(2)),
        phase: section.name,
        specialty: null as string | null,
        included: true,
        optional: false,
      }))
      .filter((line) => line.unitPrice > 0 || summary.sections.length <= 3);

    const extras: typeof chapterLines = [];
    if (summary.contingencias) {
      extras.push({
        description: "Contingências",
        quantity: 1,
        unit: "vb",
        unitPrice: Number(summary.contingencias.toFixed(2)),
        phase: "Encargos",
        specialty: null,
        included: true,
        optional: false,
      });
    }
    if (summary.iva) {
      extras.push({
        description: `IVA (${(Number(summary.document.ivaRate) * 100).toFixed(1)}%)`,
        quantity: 1,
        unit: "vb",
        unitPrice: Number(summary.iva.toFixed(2)),
        phase: "Impostos",
        specialty: null,
        included: true,
        optional: false,
      });
    }

    const lines = [...chapterLines, ...extras];
    if (!lines.length) {
      return [
        {
          description: `Execução de obra conforme ${docLabel}`,
          quantity: 1,
          unit: "vb",
          unitPrice: Number(summary.total.toFixed(2)),
          phase: "Execução",
          specialty: null,
          included: true,
          optional: false,
        },
      ];
    }
    return lines;
  }

  // mapa completo — quantidades e preços do documento, sem recalcular
  const leaf = summary.sections.flatMap((section) => collectBudgetLeafLines(section.items, section.name));
  if (!leaf.length) {
    return [
      {
        description: `Execução de obra conforme ${docLabel}`,
        quantity: 1,
        unit: "vb",
        unitPrice: Number(summary.total.toFixed(2)),
        phase: "Execução",
        specialty: null as string | null,
        included: true,
        optional: false,
      },
    ];
  }
  const mapLines = leaf.map((row) => ({
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    phase: row.phase,
    specialty: null as string | null,
    included: true,
    optional: false,
  }));
  if (summary.contingencias) {
    mapLines.push({
      description: "Contingências",
      quantity: 1,
      unit: "vb",
      unitPrice: Number(summary.contingencias.toFixed(2)),
      phase: "Encargos",
      specialty: null,
      included: true,
      optional: false,
    });
  }
  if (summary.iva) {
    mapLines.push({
      description: `IVA (${(Number(summary.document.ivaRate) * 100).toFixed(1)}%)`,
      quantity: 1,
      unit: "vb",
      unitPrice: Number(summary.iva.toFixed(2)),
      phase: "Impostos",
      specialty: null,
      included: true,
      optional: false,
    });
  }
  return mapLines;
}

async function engagementFinance(engagement: typeof practiceEngagements.$inferSelect) {
  const originalAmount = Number(engagement.totalAmount);
  const [milestones, team, expenses, invoices, addenda] = await Promise.all([
    db
      .select()
      .from(practiceMilestones)
      .where(eq(practiceMilestones.engagementId, engagement.id))
      .orderBy(practiceMilestones.sortOrder),
    db
      .select()
      .from(practiceTeamMembers)
      .where(eq(practiceTeamMembers.engagementId, engagement.id))
      .orderBy(practiceTeamMembers.sortOrder),
    db
      .select()
      .from(practiceExpenses)
      .where(eq(practiceExpenses.engagementId, engagement.id))
      .orderBy(desc(practiceExpenses.createdAt)),
    db.select().from(practiceInvoices).where(eq(practiceInvoices.engagementId, engagement.id)),
    db.select().from(practiceAddenda).where(eq(practiceAddenda.engagementId, engagement.id)),
  ]);

  const approvedAddenda = addenda.filter((row) => row.status === "aprovada");
  const approvedVariations = approvedAddenda.reduce((sum, row) => sum + Number(row.amount), 0);
  const contractTotal = Number((originalAmount + approvedVariations).toFixed(2));

  const activeInvoices = invoices.filter((row) => row.status !== "cancelada");
  const invoiceIds = activeInvoices.map((row) => row.id);
  const receipts = invoiceIds.length
    ? await db.select().from(practiceReceipts).where(inArray(practiceReceipts.invoiceId, invoiceIds))
    : [];

  const invoiced = activeInvoices.reduce((sum, row) => sum + Number(row.netAmount), 0);
  const received = receipts.reduce((sum, row) => sum + Number(row.amount), 0);
  const receivable = Number(Math.max(0, contractTotal - received).toFixed(2));

  const teamRows = team.map((member) => {
    const planned = plannedTeamPay(member, contractTotal);
    const paid = Number(member.paidAmount);
    return {
      ...member,
      plannedAmount: planned,
      pendingAmount: Number(Math.max(0, planned - paid).toFixed(2)),
    };
  });
  const honorariosPrevistos = teamRows.reduce((sum, row) => sum + row.plannedAmount, 0);
  const honorariosPagos = teamRows.reduce((sum, row) => sum + Number(row.paidAmount), 0);
  const honorariosPendentes = Number(Math.max(0, honorariosPrevistos - honorariosPagos).toFixed(2));

  const internal = expenses.filter((row) => row.kind === "interno");
  const reimbursable = expenses.filter((row) => row.kind === "reembolsavel");
  const despesasInternas = internal.reduce((sum, row) => sum + Number(row.amount), 0);
  const despesasReembolsaveis = reimbursable.reduce((sum, row) => sum + Number(row.amount), 0);
  const despesasInternasPagas = internal
    .filter((row) => row.paidAt)
    .reduce((sum, row) => sum + Number(row.amount), 0);

  const custosPrevistos = Number((honorariosPrevistos + despesasInternas).toFixed(2));
  const custosRealizados = Number((honorariosPagos + despesasInternasPagas).toFixed(2));
  const margemPrevista = Number((contractTotal - custosPrevistos).toFixed(2));
  const margemReal = Number((received - custosRealizados).toFixed(2));
  const rentabilidadePrevistaPct =
    contractTotal > 0 ? Number(((margemPrevista / contractTotal) * 100).toFixed(1)) : 0;
  const rentabilidadeRealPct = received > 0 ? Number(((margemReal / received) * 100).toFixed(1)) : 0;

  return {
    milestones,
    team: teamRows,
    expenses,
    finance: {
      originalAmount: Number(originalAmount.toFixed(2)),
      approvedVariations: Number(approvedVariations.toFixed(2)),
      contracted: contractTotal,
      invoiced: Number(invoiced.toFixed(2)),
      received: Number(received.toFixed(2)),
      receivable,
      honorariosPrevistos: Number(honorariosPrevistos.toFixed(2)),
      honorariosPagos: Number(honorariosPagos.toFixed(2)),
      honorariosPendentes,
      despesasInternas: Number(despesasInternas.toFixed(2)),
      despesasReembolsaveis: Number(despesasReembolsaveis.toFixed(2)),
      custosPrevistos,
      custosRealizados,
      margemPrevista,
      margemReal,
      rentabilidadePrevistaPct,
      rentabilidadeRealPct,
    },
  };
}

function lineTotals(lines: Array<z.infer<typeof lineSchema>>) {
  return lines.map((line, index) => {
    const included = line.included !== false;
    const lineTotal = included ? Number((line.quantity * line.unitPrice).toFixed(2)) : 0;
    return {
      description: line.description,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitPrice: line.unitPrice.toString(),
      lineTotal: lineTotal.toString(),
      sortOrder: index,
      phase: line.phase ?? null,
      specialty: line.specialty ?? null,
      included,
      optional: Boolean(line.optional),
      durationDays: line.durationDays ?? null,
      amount: lineTotal,
    };
  });
}

function assertConstructionQuote(data: z.infer<typeof quoteSchema>) {
  if (data.serviceCategory === "construction" || data.serviceType === "execucao_obra") {
    if (!data.sourceBudgetDocumentId) {
      return "Execução de obra exige uma medição/orçamento associado. Não é permitido indicar preço global sem medição.";
    }
  }
  return null;
}

function quoteAdvancedFields(data: z.infer<typeof quoteSchema>) {
  return {
    sourceBudgetDocumentId: data.sourceBudgetDocumentId ?? null,
    serviceCategory: data.serviceCategory ?? null,
    serviceType: data.serviceType ?? null,
    pricingMode: data.pricingMode ?? "por_fase",
    projectDesignation: data.projectDesignation ?? null,
    workType: data.workType ?? null,
    location: data.location ?? null,
    ownerName: data.ownerName ?? null,
    estimatedArea: data.estimatedArea ?? null,
    floors: data.floors ?? null,
    projectDescription: data.projectDescription ?? null,
    observations: data.observations ?? null,
    plannedStartDate: data.plannedStartDate || null,
    clientDeadline: data.clientDeadline ?? null,
    conditions: data.conditions ?? {},
  };
}

function daysBetween(from: string, to: Date) {
  const start = new Date(`${from}T00:00:00Z`);
  return Math.floor((to.getTime() - start.getTime()) / 86_400_000);
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function allocateDocumentNumber(tx: DbTx, companyId: string, kind: "PRO" | "FT" | "RC") {
  const year = new Date().getFullYear();
  await tx.execute(
    drizzleSql`select id from practice_document_series where company_id = ${companyId} and kind = ${kind} and year = ${year} for update`,
  );
  const [existing] = await tx
    .select()
    .from(practiceDocumentSeries)
    .where(
      and(
        eq(practiceDocumentSeries.companyId, companyId),
        eq(practiceDocumentSeries.kind, kind),
        eq(practiceDocumentSeries.year, year),
      ),
    )
    .limit(1);
  let series = existing;
  if (!series) {
    const [created] = await tx
      .insert(practiceDocumentSeries)
      .values({ companyId, kind, year, nextNumber: 1 })
      .returning();
    series = created;
  }
  const n = series.nextNumber;
  await tx
    .update(practiceDocumentSeries)
    .set({ nextNumber: n + 1 })
    .where(eq(practiceDocumentSeries.id, series.id));
  return `${kind}-${year}-${String(n).padStart(4, "0")}`;
}

async function nextDocumentNumber(companyId: string, kind: "PRO" | "FT" | "RC") {
  return db.transaction(async (tx) => allocateDocumentNumber(tx, companyId, kind));
}

async function assertQuoteOwned(id: string, companyId: string) {
  const [row] = await db
    .select()
    .from(practiceQuotes)
    .where(and(eq(practiceQuotes.id, id), eq(practiceQuotes.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function assertInvoiceOwned(id: string, companyId: string) {
  const [row] = await db
    .select()
    .from(practiceInvoices)
    .where(and(eq(practiceInvoices.id, id), eq(practiceInvoices.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function assertClientOwned(id: string, companyId: string) {
  const [row] = await db
    .select()
    .from(practiceClients)
    .where(and(eq(practiceClients.id, id), eq(practiceClients.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function assertEngagementOwned(id: string, companyId: string) {
  const [row] = await db
    .select()
    .from(practiceEngagements)
    .where(and(eq(practiceEngagements.id, id), eq(practiceEngagements.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function refreshInvoiceStatus(invoiceId: string, executor: DbTx | typeof db = db) {
  const [invoice] = await executor.select().from(practiceInvoices).where(eq(practiceInvoices.id, invoiceId)).limit(1);
  if (!invoice || invoice.status === "cancelada" || invoice.status === "rascunho") return invoice;
  const receipts = await executor.select().from(practiceReceipts).where(eq(practiceReceipts.invoiceId, invoiceId));
  const received = receipts.reduce((sum, row) => sum + Number(row.amount), 0);
  const net = Number(invoice.netAmount);
  let status: "emitida" | "parcial" | "paga" = "emitida";
  if (received <= 0) status = "emitida";
  else if (received + 0.009 >= net) status = "paga";
  else status = "parcial";
  if (status !== invoice.status) {
    const [updated] = await executor
      .update(practiceInvoices)
      .set({ status, updatedAt: new Date() })
      .where(eq(practiceInvoices.id, invoiceId))
      .returning();
    if (status === "paga") {
      await executor
        .update(practiceMilestones)
        .set({ status: "pago" })
        .where(and(eq(practiceMilestones.invoiceId, invoiceId), eq(practiceMilestones.status, "facturado")));
    }
    return updated;
  }
  return invoice;
}

async function createEngagementFromQuote(
  quote: typeof practiceQuotes.$inferSelect,
  lines: Array<typeof practiceQuoteLines.$inferSelect>,
  userId: string,
) {
  const existing = await db
    .select()
    .from(practiceEngagements)
    .where(eq(practiceEngagements.quoteId, quote.id))
    .limit(1);
  if (existing[0]) return existing[0];

  const proposed = Number(quote.totalAmount);
  const total = Number(quote.acceptedAmount ?? quote.totalAmount);
  const scale = proposed > 0 ? total / proposed : 1;
  const acceptanceNote = quote.acceptanceNotes?.trim();
  const discountNote =
    quote.discountAmount || quote.discountPercent
      ? `Aceite com desconto${quote.discountPercent ? ` de ${quote.discountPercent}%` : ""}${quote.discountAmount ? ` (${Number(quote.discountAmount).toFixed(2)} ${quote.currency})` : ""}. Proposta ${proposed.toFixed(2)} → aceite ${total.toFixed(2)} ${quote.currency}.`
      : proposed !== total
        ? `Aceite por ${total.toFixed(2)} ${quote.currency} (proposta ${proposed.toFixed(2)}).`
        : null;
  const notes = [quote.notes, discountNote, acceptanceNote].filter(Boolean).join("\n\n") || null;

  const [engagement] = await db
    .insert(practiceEngagements)
    .values({
      companyId: quote.companyId,
      clientId: quote.clientId,
      quoteId: quote.id,
      projectId: quote.projectId,
      title: quote.title,
      clientName: quote.clientName,
      status: "activo",
      currency: quote.currency,
      totalAmount: total.toFixed(2),
      notes,
      serviceType: quote.serviceType ?? null,
      serviceProjectType: inferServiceProjectType(quote.serviceType),
      createdByUserId: userId,
    })
    .returning();

  const phaseMap = new Map<string, number>();
  for (const line of lines) {
    const key = (line.phase || "").trim();
    if (!key) continue;
    phaseMap.set(key, (phaseMap.get(key) ?? 0) + Number(line.lineTotal) * scale);
  }

  let milestones: Array<{ title: string; percent: number | null; amount: number; sortOrder: number }>;
  if (phaseMap.size > 0) {
    milestones = [...phaseMap.entries()].map(([title, amount], index) => ({
      title,
      percent: total > 0 ? Number(((amount / total) * 100).toFixed(2)) : null,
      amount: Number(amount.toFixed(2)),
      sortOrder: index,
    }));
    const allocated = milestones.reduce((sum, row) => sum + row.amount, 0);
    const drift = Number((total - allocated).toFixed(2));
    if (milestones.length && Math.abs(drift) >= 0.01) {
      milestones[milestones.length - 1].amount = Number((milestones[milestones.length - 1].amount + drift).toFixed(2));
    }
  } else {
    milestones = DEFAULT_PHASES.map((phase, index) => ({
      title: phase.title,
      percent: phase.percent,
      amount: Number(((total * phase.percent) / 100).toFixed(2)),
      sortOrder: index,
    }));
    const allocated = milestones.reduce((sum, row) => sum + row.amount, 0);
    const drift = Number((total - allocated).toFixed(2));
    if (milestones.length && Math.abs(drift) >= 0.01) {
      milestones[milestones.length - 1].amount = Number((milestones[milestones.length - 1].amount + drift).toFixed(2));
    }
  }

  if (milestones.length) {
    await db.insert(practiceMilestones).values(
      milestones.map((row) => ({
        engagementId: engagement.id,
        title: row.title,
        percent: row.percent != null ? row.percent.toFixed(2) : null,
        amount: row.amount.toFixed(2),
        status: "pendente" as const,
        sortOrder: row.sortOrder,
      })),
    );
  }

  return engagement;
}

function deriveInvoiceFlags(invoice: typeof practiceInvoices.$inferSelect, outstanding: number, today: Date) {
  const overdue =
    outstanding > 0.009 &&
    !!invoice.dueDate &&
    !["rascunho", "cancelada", "paga"].includes(invoice.status) &&
    daysBetween(invoice.dueDate, today) > 0;
  let agingBucket: "current" | "0-30" | "30-60" | "60+" | null = null;
  if (outstanding > 0.009 && invoice.dueDate && !["rascunho", "cancelada"].includes(invoice.status)) {
    const overdueDays = daysBetween(invoice.dueDate, today);
    if (overdueDays <= 0) agingBucket = "current";
    else if (overdueDays <= 30) agingBucket = "0-30";
    else if (overdueDays <= 60) agingBucket = "30-60";
    else agingBucket = "60+";
  }
  return { overdue, agingBucket, overdueDays: invoice.dueDate ? Math.max(0, daysBetween(invoice.dueDate, today)) : 0 };
}

export async function practiceRoutes(app: FastifyInstance) {
  // ---------- Resumo ----------
  app.get("/api/practice/summary", { preHandler: canView }, async (request) => {
    const companyId = companyIdOf(request);
    const today = new Date();
    const invoices = await db.select().from(practiceInvoices).where(eq(practiceInvoices.companyId, companyId));
    const activeInvoices = invoices.filter((row) => !["rascunho", "cancelada"].includes(row.status));
    const invoiceIds = activeInvoices.map((row) => row.id);
    const receipts = invoiceIds.length
      ? await db.select().from(practiceReceipts).where(inArray(practiceReceipts.invoiceId, invoiceIds))
      : [];
    const receiptIds = receipts.map((row) => row.id);
    const destinations = receiptIds.length
      ? await db.select().from(practiceReceiptDestinations).where(inArray(practiceReceiptDestinations.receiptId, receiptIds))
      : [];

    const receivedByInvoice = new Map<string, number>();
    for (const receipt of receipts) {
      receivedByInvoice.set(receipt.invoiceId, (receivedByInvoice.get(receipt.invoiceId) ?? 0) + Number(receipt.amount));
    }

    let receivables = 0;
    let overdueAmount = 0;
    const aging = { current: 0, "0-30": 0, "30-60": 0, "60+": 0 };
    const overdueInvoices: Array<{
      id: string;
      clientName: string;
      invoiceNumber: string | null;
      dueDate: string | null;
      outstanding: number;
      overdueDays: number;
      currency: string;
    }> = [];

    for (const invoice of activeInvoices) {
      const outstanding = Math.max(0, Number(invoice.netAmount) - (receivedByInvoice.get(invoice.id) ?? 0));
      receivables += outstanding;
      const flags = deriveInvoiceFlags(invoice, outstanding, today);
      if (flags.agingBucket) aging[flags.agingBucket] += outstanding;
      if (flags.overdue) {
        overdueAmount += outstanding;
        overdueInvoices.push({
          id: invoice.id,
          clientName: invoice.clientName,
          invoiceNumber: invoice.invoiceNumber,
          dueDate: invoice.dueDate,
          outstanding: Number(outstanding.toFixed(2)),
          overdueDays: flags.overdueDays,
          currency: invoice.currency,
        });
      }
    }

    let cashOnHand = 0;
    let payablesThirdParty = 0;
    for (const dest of destinations) {
      const amount = Number(dest.amount);
      if (dest.kind === "caixa") cashOnHand += amount;
      else if (dest.kind === "terceiro" && !dest.paidAt) payablesThirdParty += amount;
    }

    const allQuotes = await db
      .select()
      .from(practiceQuotes)
      .where(eq(practiceQuotes.companyId, companyId))
      .orderBy(desc(practiceQuotes.createdAt));
    const openQuotes = allQuotes.filter((q) => q.status === "rascunho" || q.status === "enviada").slice(0, 8);

    const pendingMilestones = await db
      .select({
        milestone: practiceMilestones,
        engagement: practiceEngagements,
      })
      .from(practiceMilestones)
      .innerJoin(practiceEngagements, eq(practiceMilestones.engagementId, practiceEngagements.id))
      .where(
        and(
          eq(practiceEngagements.companyId, companyId),
          eq(practiceMilestones.status, "pendente"),
          inArray(practiceEngagements.status, ["activo", "rascunho"]),
        ),
      )
      .orderBy(practiceMilestones.sortOrder)
      .limit(12);

    const quoteCounts = {
      rascunhos: allQuotes.filter((q) => q.status === "rascunho").length,
      enviadas: allQuotes.filter((q) => q.status === "enviada").length,
      aprovadas: allQuotes.filter((q) => q.status === "aprovada").length,
      rejeitadas: allQuotes.filter((q) => q.status === "rejeitada").length,
      canceladas: allQuotes.filter((q) => q.status === "cancelada").length,
    };
    const aFechar = quoteCounts.rascunhos + quoteCounts.enviadas;
    const valorNegociacao = allQuotes
      .filter((q) => q.status === "rascunho" || q.status === "enviada")
      .reduce((sum, q) => sum + Number(q.totalAmount), 0);
    const valorGanho = allQuotes
      .filter((q) => q.status === "aprovada")
      .reduce((sum, q) => sum + Number(q.acceptedAmount ?? q.totalAmount), 0);
    const closedDecided = quoteCounts.aprovadas + quoteCounts.rejeitadas;
    const conversaoPct = closedDecided > 0 ? Number(((quoteCounts.aprovadas / closedDecided) * 100).toFixed(1)) : 0;

    const engagements = await db
      .select()
      .from(practiceEngagements)
      .where(and(eq(practiceEngagements.companyId, companyId), inArray(practiceEngagements.status, ["activo", "rascunho"])));
    const engagementIds = engagements.map((e) => e.id);
    const [scheduleAll, deliverablesAll, teamAll, addendaAll] = engagementIds.length
      ? await Promise.all([
          db.select().from(practiceSchedulePhases).where(inArray(practiceSchedulePhases.engagementId, engagementIds)),
          db.select().from(practiceDeliverables).where(inArray(practiceDeliverables.engagementId, engagementIds)),
          db.select().from(practiceTeamMembers).where(inArray(practiceTeamMembers.engagementId, engagementIds)),
          db.select().from(practiceAddenda).where(inArray(practiceAddenda.engagementId, engagementIds)),
        ])
      : [[], [], [], []];

    const phasesOverdue = scheduleAll.filter((p) => effectivePhaseStatus(p.status, p.endDate) === "atrasado").length;
    const phasesInProgress = scheduleAll.filter((p) =>
      ["em_curso", "em_preparacao", "em_revisao", "aguardando_cliente", "aguardando_terceiro"].includes(
        effectivePhaseStatus(p.status, p.endDate),
      ),
    ).length;
    const deliverablesPending = deliverablesAll.filter((d) => !["aprovado", "entregue"].includes(d.status)).length;
    const honorariosPendentes = teamAll.reduce((sum, member) => {
      const eng = engagements.find((e) => e.id === member.engagementId);
      const planned = plannedTeamPay(member, Number(eng?.totalAmount ?? 0));
      return sum + Math.max(0, planned - Number(member.paidAmount));
    }, 0);

    const currency = activeInvoices[0]?.currency ?? allQuotes[0]?.currency ?? "MZN";
    const brand = await loadCompanyBrand(companyId);

    return {
      cashOnHand: Number(cashOnHand.toFixed(2)),
      receivables: Number(receivables.toFixed(2)),
      overdueAmount: Number(overdueAmount.toFixed(2)),
      payablesThirdParty: Number(payablesThirdParty.toFixed(2)),
      openQuotes: aFechar,
      activeInvoices: activeInvoices.length,
      currency,
      aging: {
        current: Number(aging.current.toFixed(2)),
        "0-30": Number(aging["0-30"].toFixed(2)),
        "30-60": Number(aging["30-60"].toFixed(2)),
        "60+": Number(aging["60+"].toFixed(2)),
      },
      overdueInvoices: overdueInvoices.sort((a, b) => b.overdueDays - a.overdueDays).slice(0, 10),
      pipelineQuotes: openQuotes.map((q) => ({
        id: q.id,
        title: q.title,
        clientName: q.clientName,
        status: q.status,
        totalAmount: q.totalAmount,
        currency: q.currency,
        quoteNumber: q.quoteNumber,
      })),
      pendingMilestones: pendingMilestones.map((row) => ({
        id: row.milestone.id,
        title: row.milestone.title,
        amount: row.milestone.amount,
        dueDate: row.milestone.dueDate,
        engagementId: row.engagement.id,
        engagementTitle: row.engagement.title,
        clientName: row.engagement.clientName,
        currency: row.engagement.currency,
      })),
      atelier: {
        comercial: {
          ...quoteCounts,
          aFechar,
          valorNegociacao: Number(valorNegociacao.toFixed(2)),
          valorGanho: Number(valorGanho.toFixed(2)),
          conversaoPct,
        },
        financeiro: {
          cashOnHand: Number(cashOnHand.toFixed(2)),
          receivables: Number(receivables.toFixed(2)),
          overdueAmount: Number(overdueAmount.toFixed(2)),
          payablesThirdParty: Number(payablesThirdParty.toFixed(2)),
          activeInvoices: activeInvoices.length,
          invoiced: Number(
            activeInvoices.reduce((sum, row) => sum + Number(row.netAmount), 0).toFixed(2),
          ),
          received: Number(receipts.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)),
        },
        producao: {
          activeContracts: engagements.length,
          phasesTotal: scheduleAll.length,
          phasesInProgress,
          phasesOverdue,
          deliverablesPending,
          deliverablesTotal: deliverablesAll.length,
          addendaOpen: addendaAll.filter((a) => ["rascunho", "enviada"].includes(a.status)).length,
        },
        equipa: {
          membersTotal: teamAll.length,
          membersExternal: teamAll.filter((m) => m.isExternal).length,
          honorariosPendentes: Number(honorariosPendentes.toFixed(2)),
          payStatus: {
            pendente: teamAll.filter((m) => m.payStatus === "pendente").length,
            parcial: teamAll.filter((m) => m.payStatus === "parcial").length,
            pago: teamAll.filter((m) => m.payStatus === "pago").length,
          },
        },
      },
      documentSetup: {
        hasLogo: Boolean(brand.logoUrl),
        hasBankDetails: Boolean(brand.bankDetails?.trim()),
        companyName: brand.brandName || brand.name,
      },
    };
  });

  // ---------- Clientes ----------
  app.get("/api/practice/clients", { preHandler: canView }, async (request) => {
    return db
      .select()
      .from(practiceClients)
      .where(eq(practiceClients.companyId, companyIdOf(request)))
      .orderBy(practiceClients.name);
  });

  app.get("/api/practice/clients/:id", { preHandler: canView }, async (request, reply) => {
    const client = await assertClientOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!client) return reply.code(404).send({ error: "Cliente não encontrado" });
    const companyId = companyIdOf(request);
    const [quotes, invoices, engagements] = await Promise.all([
      db.select().from(practiceQuotes).where(and(eq(practiceQuotes.companyId, companyId), eq(practiceQuotes.clientId, client.id))).orderBy(desc(practiceQuotes.createdAt)),
      db.select().from(practiceInvoices).where(and(eq(practiceInvoices.companyId, companyId), eq(practiceInvoices.clientId, client.id))).orderBy(desc(practiceInvoices.createdAt)),
      db.select().from(practiceEngagements).where(and(eq(practiceEngagements.companyId, companyId), eq(practiceEngagements.clientId, client.id))).orderBy(desc(practiceEngagements.createdAt)),
    ]);
    const receipts = invoices.length
      ? await db.select().from(practiceReceipts).where(inArray(practiceReceipts.invoiceId, invoices.map((i) => i.id)))
      : [];
    return { ...client, quotes, invoices, engagements, receipts };
  });

  app.post("/api/practice/clients", { preHandler: canManage }, async (request, reply) => {
    const parsed = clientSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db
      .insert(practiceClients)
      .values({
        companyId: companyIdOf(request),
        name: parsed.data.name,
        contact: parsed.data.contact ?? null,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        nuit: parsed.data.nuit ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/practice/clients/:id", { preHandler: canManage }, async (request, reply) => {
    const client = await assertClientOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!client) return reply.code(404).send({ error: "Cliente não encontrado" });
    const parsed = clientSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [row] = await db
      .update(practiceClients)
      .set({
        name: parsed.data.name,
        contact: parsed.data.contact ?? null,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        nuit: parsed.data.nuit ?? null,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(practiceClients.id, client.id))
      .returning();
    return row;
  });

  // ---------- Cotações / Propostas ----------
  app.get("/api/practice/quotes", { preHandler: canView }, async (request) => {
    return db
      .select()
      .from(practiceQuotes)
      .where(eq(practiceQuotes.companyId, companyIdOf(request)))
      .orderBy(desc(practiceQuotes.createdAt));
  });

  app.get("/api/practice/quotes/:id", { preHandler: canView }, async (request, reply) => {
    const quote = await assertQuoteOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!quote) return reply.code(404).send({ error: "Proposta não encontrada" });
    const lines = await db
      .select()
      .from(practiceQuoteLines)
      .where(eq(practiceQuoteLines.quoteId, quote.id))
      .orderBy(practiceQuoteLines.sortOrder);
    return { ...quote, lines };
  });

  app.post("/api/practice/quotes", { preHandler: canManage }, async (request, reply) => {
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const constructionError = assertConstructionQuote(parsed.data);
    if (constructionError) return reply.code(409).send({ error: constructionError });
    const companyId = companyIdOf(request);
    const prepared = lineTotals(parsed.data.lines);
    const totalAmount = prepared.reduce((sum, line) => sum + line.amount, 0);
    let quoteNumber = parsed.data.quoteNumber ?? null;
    if (!quoteNumber && parsed.data.assignNumber) {
      quoteNumber = await nextDocumentNumber(companyId, "PRO");
    }
    const [quote] = await db
      .insert(practiceQuotes)
      .values({
        companyId,
        title: parsed.data.title,
        clientName: parsed.data.clientName,
        clientId: parsed.data.clientId ?? null,
        projectId: parsed.data.projectId ?? null,
        quoteNumber,
        issueDate: parsed.data.issueDate ?? new Date().toISOString().slice(0, 10),
        validUntil: parsed.data.validUntil,
        currency: parsed.data.currency,
        notes: parsed.data.notes,
        totalAmount: totalAmount.toFixed(2),
        createdByUserId: request.currentUser!.id,
        ...quoteAdvancedFields(parsed.data),
      })
      .returning();
    await db.insert(practiceQuoteLines).values(
      prepared.map(({ amount: _a, ...line }) => ({ ...line, quoteId: quote.id })),
    );
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "practice_quote",
      entityId: quote.id,
      action: "created",
      after: { title: quote.title, totalAmount: quote.totalAmount, status: quote.status, quoteNumber, serviceType: quote.serviceType },
    });
    return reply.code(201).send(quote);
  });

  app.put("/api/practice/quotes/:id", { preHandler: canManage }, async (request, reply) => {
    const quote = await assertQuoteOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!quote) return reply.code(404).send({ error: "Proposta não encontrada" });
    if (quote.status !== "rascunho") return reply.code(409).send({ error: "Só propostas em rascunho podem ser editadas" });
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const constructionError = assertConstructionQuote(parsed.data);
    if (constructionError) return reply.code(409).send({ error: constructionError });
    const prepared = lineTotals(parsed.data.lines);
    const totalAmount = prepared.reduce((sum, line) => sum + line.amount, 0);
    const [updated] = await db
      .update(practiceQuotes)
      .set({
        title: parsed.data.title,
        clientName: parsed.data.clientName,
        clientId: parsed.data.clientId ?? null,
        projectId: parsed.data.projectId ?? null,
        issueDate: parsed.data.issueDate ?? quote.issueDate,
        validUntil: parsed.data.validUntil,
        currency: parsed.data.currency,
        notes: parsed.data.notes,
        totalAmount: totalAmount.toFixed(2),
        updatedAt: new Date(),
        ...quoteAdvancedFields(parsed.data),
      })
      .where(eq(practiceQuotes.id, quote.id))
      .returning();
    await db.delete(practiceQuoteLines).where(eq(practiceQuoteLines.quoteId, quote.id));
    await db.insert(practiceQuoteLines).values(
      prepared.map(({ amount: _a, ...line }) => ({ ...line, quoteId: quote.id })),
    );
    return updated;
  });

  app.put("/api/practice/quotes/:id/status", { preHandler: canManage }, async (request, reply) => {
    const quote = await assertQuoteOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!quote) return reply.code(404).send({ error: "Proposta não encontrada" });
    const parsed = quoteStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const proposed = Number(quote.totalAmount);
    let acceptedAmount = parsed.data.acceptedAmount;
    let discountAmount = parsed.data.discountAmount;
    let discountPercent = parsed.data.discountPercent;

    if (parsed.data.status === "aprovada") {
      if (acceptedAmount == null && discountPercent != null) {
        acceptedAmount = Number((proposed * (1 - discountPercent / 100)).toFixed(2));
      }
      if (acceptedAmount == null && discountAmount != null) {
        acceptedAmount = Number((proposed - discountAmount).toFixed(2));
      }
      if (acceptedAmount == null) acceptedAmount = proposed;
      if (acceptedAmount > proposed + 0.009) {
        return reply.code(400).send({ error: "O valor aceite não pode ultrapassar o valor da proposta" });
      }
      if (discountAmount == null) discountAmount = Number((proposed - acceptedAmount).toFixed(2));
      if (discountPercent == null && proposed > 0) {
        discountPercent = Number((((proposed - acceptedAmount) / proposed) * 100).toFixed(2));
      }
    }

    const [updated] = await db
      .update(practiceQuotes)
      .set({
        status: parsed.data.status,
        approvedAt: parsed.data.status === "aprovada" ? new Date() : quote.approvedAt,
        sentAt: parsed.data.status === "enviada" ? new Date() : quote.sentAt,
        acceptedAmount: parsed.data.status === "aprovada" ? acceptedAmount!.toFixed(2) : quote.acceptedAmount,
        discountAmount: parsed.data.status === "aprovada" ? (discountAmount ?? 0).toFixed(2) : quote.discountAmount,
        discountPercent: parsed.data.status === "aprovada" ? (discountPercent ?? 0).toFixed(2) : quote.discountPercent,
        acceptanceNotes:
          parsed.data.status === "aprovada"
            ? parsed.data.acceptanceNotes?.trim() || quote.acceptanceNotes
            : quote.acceptanceNotes,
        updatedAt: new Date(),
      })
      .where(eq(practiceQuotes.id, quote.id))
      .returning();

    let engagement = null;
    if (parsed.data.status === "aprovada" && parsed.data.createEngagement) {
      const lines = await db.select().from(practiceQuoteLines).where(eq(practiceQuoteLines.quoteId, quote.id));
      engagement = await createEngagementFromQuote(updated, lines, request.currentUser!.id);
    }
    return { ...updated, engagement };
  });

  app.post("/api/practice/quotes/:id/to-invoice", { preHandler: canManage }, async (request, reply) => {
    const quote = await assertQuoteOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!quote) return reply.code(404).send({ error: "Proposta não encontrada" });
    if (quote.status !== "aprovada") return reply.code(409).send({ error: "Só propostas aprovadas geram factura" });
    const lines = await db.select().from(practiceQuoteLines).where(eq(practiceQuoteLines.quoteId, quote.id));
    if (!lines.length) return reply.code(409).send({ error: "Proposta sem linhas" });
    const body = z
      .object({ dueDate: z.string().min(1).optional(), ivaRate: z.number().min(0).max(1).optional() })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const dueDate =
      body.data.dueDate ??
      new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const gross = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0);
    const ivaRate = body.data.ivaRate ?? 0;
    const net = Number((gross * (1 + ivaRate)).toFixed(2));
    const invoiceNumber = await nextDocumentNumber(companyIdOf(request), "FT");
    const [engagement] = await db
      .select()
      .from(practiceEngagements)
      .where(eq(practiceEngagements.quoteId, quote.id))
      .limit(1);
    const [invoice] = await db
      .insert(practiceInvoices)
      .values({
        companyId: companyIdOf(request),
        quoteId: quote.id,
        engagementId: engagement?.id ?? null,
        clientId: quote.clientId,
        projectId: quote.projectId,
        invoiceNumber,
        clientName: quote.clientName,
        status: "emitida",
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate,
        currency: quote.currency,
        grossAmount: gross.toFixed(2),
        ivaRate: ivaRate.toFixed(4),
        netAmount: net.toFixed(2),
        notes: quote.notes,
        createdByUserId: request.currentUser!.id,
      })
      .returning();
    await db.insert(practiceInvoiceLines).values(
      lines.map((line, index) => ({
        invoiceId: invoice.id,
        description: line.phase ? `${line.phase} — ${line.description}` : line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        sortOrder: index,
      })),
    );
    await syncPracticeInvoiceReceivable(invoice.id);
    return reply.code(201).send(invoice);
  });

  app.get("/api/practice/quotes/:id/export.pdf", { preHandler: canView }, async (request, reply) => {
    const quote = await assertQuoteOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!quote) return reply.code(404).send({ error: "Proposta não encontrada" });
    const lines = await db
      .select()
      .from(practiceQuoteLines)
      .where(eq(practiceQuoteLines.quoteId, quote.id))
      .orderBy(practiceQuoteLines.sortOrder);
    const client = quote.clientId ? await assertClientOwned(quote.clientId, companyIdOf(request)) : null;
    const brand = await loadCompanyBrand(companyIdOf(request));
    const conditions = (quote.conditions ?? {}) as Record<string, unknown>;
    const buffer = await buildPracticeDocumentPdf({
      kind: "proposta",
      number: quote.quoteNumber,
      title: quote.title,
      clientName: quote.clientName,
      clientNuit: client?.nuit,
      clientAddress: client?.address,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      currency: quote.currency,
      grossAmount: Number(quote.totalAmount),
      netAmount: Number(quote.totalAmount),
      ivaRate: 0,
      notes: quote.notes,
      proposal: {
        projectDesignation: quote.projectDesignation,
        location: quote.location,
        workType: quote.workType,
        serviceLabel: quote.serviceType,
        intro: typeof conditions.intro === "string" ? conditions.intro : null,
        exclusions: typeof conditions.exclusions === "string" ? conditions.exclusions : null,
        paymentTerms: typeof conditions.paymentTerms === "string" ? conditions.paymentTerms : null,
        additionalNotes: typeof conditions.additionalNotes === "string" ? conditions.additionalNotes : null,
        acceptanceText: typeof conditions.acceptanceText === "string" ? conditions.acceptanceText : null,
        deadlineText: typeof conditions.deadlineText === "string" ? conditions.deadlineText : null,
        validityText: typeof conditions.validityText === "string" ? conditions.validityText : null,
        acceptedAmount: quote.acceptedAmount != null ? Number(quote.acceptedAmount) : null,
      },
      lines: lines.map((line) => ({
        phase: line.phase,
        specialty: line.specialty,
        included: line.included,
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unitPrice: Number(line.unitPrice),
        lineTotal: Number(line.lineTotal),
      })),
      company: brand,
    });
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="Proposta-${(quote.quoteNumber ?? quote.id).replace(/[^\w-]/g, "")}.pdf"`)
      .send(buffer);
  });

  // ---------- Contratos / parcelas ----------
  app.get("/api/practice/engagements", { preHandler: canView }, async (request) => {
    const companyId = companyIdOf(request);
    const engagements = await db
      .select()
      .from(practiceEngagements)
      .where(eq(practiceEngagements.companyId, companyId))
      .orderBy(desc(practiceEngagements.createdAt));
    const ids = engagements.map((row) => row.id);
    const milestones = ids.length
      ? await db.select().from(practiceMilestones).where(inArray(practiceMilestones.engagementId, ids)).orderBy(practiceMilestones.sortOrder)
      : [];
    return engagements.map((row) => ({
      ...row,
      milestones: milestones.filter((m) => m.engagementId === row.id),
    }));
  });

  app.get("/api/practice/engagements/:id", { preHandler: canView }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const [detail, ops] = await Promise.all([engagementFinance(engagement), engagementOps(engagement.id)]);
    return {
      ...engagement,
      ...detail,
      ...ops,
      opsKpis: { ...ops.opsKpis, teamSize: detail.team.length },
    };
  });

  app.get("/api/practice/budget-sources", { preHandler: canView }, async (request) => {
    const companyId = companyIdOf(request);
    const rows = await db
      .select({
        document: budgetDocuments,
        project: projects,
      })
      .from(budgetDocuments)
      .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
      .where(and(eq(projects.companyId, companyId), eq(budgetDocuments.status, "aprovado")))
      .orderBy(desc(budgetDocuments.createdAt));
    return rows.map(({ document, project }) => ({
      id: document.id,
      title: document.title,
      documentType: document.documentType,
      fileNumber: document.fileNumber,
      revision: document.revision,
      currency: document.currency,
      projectId: project.id,
      projectName: project.name,
      client: project.client,
      location: [project.bairro, project.distrito, project.provincia].filter(Boolean).join(", ") || null,
    }));
  });

  app.post("/api/practice/quotes/from-budget", { preHandler: canManage }, async (request, reply) => {
    const parsed = z
      .object({
        documentId: z.string().uuid(),
        attachMode: z.enum(["nada", "resumo", "mapa"]).default("resumo"),
        assignNumber: z.boolean().optional().default(true),
        clientId: z.string().uuid().optional().nullable(),
        clientName: z.string().min(1).max(200).optional(),
        title: z.string().min(1).max(240).optional(),
        validUntil: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        projectDesignation: z.string().max(240).optional().nullable(),
        workType: z.string().max(120).optional().nullable(),
        location: z.string().max(240).optional().nullable(),
        ownerName: z.string().max(200).optional().nullable(),
        projectDescription: z.string().optional().nullable(),
        observations: z.string().optional().nullable(),
        plannedStartDate: z.string().optional().nullable(),
        clientDeadline: z.string().max(120).optional().nullable(),
        conditions: conditionsSchema.optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = companyIdOf(request);
    const document = await assertDocumentOwned(parsed.data.documentId, companyId);
    if (!document) return reply.code(404).send({ error: "Documento não encontrado" });
    if (document.status !== "aprovado") {
      return reply.code(409).send({ error: "Só documentos aprovados podem gerar proposta comercial." });
    }

    const summary = await getBudgetDocumentSummary(document.id);
    if (!summary) return reply.code(404).send({ error: "Resumo do documento indisponível" });

    const [project] = await db.select().from(projects).where(eq(projects.id, document.projectId)).limit(1);
    if (!project || project.companyId !== companyId) {
      return reply.code(404).send({ error: "Projecto não encontrado" });
    }

    let clientId = parsed.data.clientId ?? null;
    let clientName = parsed.data.clientName?.trim() || project.client?.trim() || project.name;
    if (clientId) {
      const [client] = await db
        .select()
        .from(practiceClients)
        .where(and(eq(practiceClients.id, clientId), eq(practiceClients.companyId, companyId)))
        .limit(1);
      if (client) {
        if (!parsed.data.clientName?.trim()) clientName = client.name;
      } else clientId = null;
    } else if (!parsed.data.clientName?.trim() && project.client?.trim()) {
      const [existingClient] = await db
        .select()
        .from(practiceClients)
        .where(and(eq(practiceClients.companyId, companyId), eq(practiceClients.name, project.client.trim())))
        .limit(1);
      if (existingClient) {
        clientId = existingClient.id;
        clientName = existingClient.name;
      }
    }

    const lineInputs = buildQuoteLinesFromBudget(summary, parsed.data.attachMode);
    const prepared = lineTotals(
      lineInputs.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        phase: line.phase,
        specialty: line.specialty,
        included: line.included,
        optional: line.optional,
      })),
    );
    const totalAmount = prepared.reduce((sum, line) => sum + line.amount, 0);
    if (totalAmount <= 0) {
      return reply
        .code(409)
        .send({ error: "O documento não tem valor comercial. Conclua o orçamento com preços antes de gerar a proposta." });
    }

    const location =
      parsed.data.location?.trim() ||
      [project.bairro, project.talhao, project.distrito, project.provincia].filter(Boolean).join(", ") ||
      null;
    const docRef = [document.fileNumber, document.revision ? `rev. ${document.revision}` : null].filter(Boolean).join(" · ");
    const quoteNumber = parsed.data.assignNumber !== false ? await nextDocumentNumber(companyId, "PRO") : null;
    const ivaPct = (Number(document.ivaRate) * 100).toFixed(1);
    const defaultConditions = {
      intro: `Proposta de execução de obra elaborada a partir do ${document.documentType === "medicao" ? "medição" : "orçamento"} aprovado${docRef ? ` (${docRef})` : ""}.`,
      objectText: `Execução dos trabalhos descritos no documento de origem, sem recalcular quantidades no módulo Comercial.`,
      taxNote: `IVA ${ivaPct}% já reflectido no resumo financeiro do orçamento de origem (modo anexo: ${parsed.data.attachMode}).`,
      additionalNotes: `Documento origem: ${document.title}. Total origem: ${summary.total.toFixed(2)} ${document.currency}.`,
      paymentTerms: "Conforme condições a acordar / plano de autos.",
    };
    const conditions = { ...defaultConditions, ...(parsed.data.conditions ?? {}) };

    const [quote] = await db
      .insert(practiceQuotes)
      .values({
        companyId,
        title: parsed.data.title?.trim() || `Proposta de execução — ${project.name}`,
        clientName,
        clientId,
        projectId: project.id,
        sourceBudgetDocumentId: document.id,
        quoteNumber,
        issueDate: new Date().toISOString().slice(0, 10),
        validUntil:
          parsed.data.validUntil || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        currency: document.currency,
        notes:
          parsed.data.notes?.trim() ||
          `Gerada a partir de ${document.documentType} aprovado. Anexo: ${parsed.data.attachMode}.`,
        totalAmount: totalAmount.toFixed(2),
        serviceCategory: "construction",
        serviceType: "execucao_obra",
        pricingMode: "mapa",
        projectDesignation: parsed.data.projectDesignation?.trim() || project.name,
        workType: parsed.data.workType?.trim() || null,
        location,
        ownerName: parsed.data.ownerName?.trim() || project.client,
        projectDescription:
          parsed.data.projectDescription?.trim() ||
          `Conforme ${document.title}${docRef ? ` (${docRef})` : ""}.`,
        observations:
          parsed.data.observations?.trim() ||
          `Subtotal: ${summary.subtotal1.toFixed(2)} · Contingências: ${summary.contingencias.toFixed(2)} · IVA: ${summary.iva.toFixed(2)} · Total: ${summary.total.toFixed(2)} ${document.currency}.`,
        plannedStartDate: parsed.data.plannedStartDate || null,
        clientDeadline: parsed.data.clientDeadline?.trim() || null,
        conditions,
        createdByUserId: request.currentUser!.id,
      })
      .returning();

    await db.insert(practiceQuoteLines).values(
      prepared.map(({ amount: _a, ...line }) => ({ ...line, quoteId: quote.id })),
    );

    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "practice_quote",
      entityId: quote.id,
      action: "created",
      after: {
        title: quote.title,
        totalAmount: quote.totalAmount,
        sourceBudgetDocumentId: document.id,
        attachMode: parsed.data.attachMode,
      },
    });

    return reply.code(201).send(quote);
  });

  app.put("/api/practice/engagements/:id", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = engagementUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const patch: Partial<typeof practiceEngagements.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.projectId !== undefined) patch.projectId = parsed.data.projectId;
    if (parsed.data.serviceProjectType !== undefined) patch.serviceProjectType = parsed.data.serviceProjectType;
    if (parsed.data.serviceType !== undefined) patch.serviceType = parsed.data.serviceType;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    const [updated] = await db
      .update(practiceEngagements)
      .set(patch)
      .where(eq(practiceEngagements.id, engagement.id))
      .returning();
    return updated;
  });

  app.post("/api/practice/engagements/:id/team", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = teamMemberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;
    const planned = plannedTeamPay(data, Number(engagement.totalAmount));
    const paid = data.paidAmount ?? 0;
    const [row] = await db
      .insert(practiceTeamMembers)
      .values({
        engagementId: engagement.id,
        name: data.name,
        role: data.role,
        specialty: data.specialty ?? null,
        contact: data.contact ?? null,
        isExternal: data.isExternal ?? false,
        payMode: data.payMode,
        agreedAmount: (data.agreedAmount ?? 0).toFixed(2),
        percent: data.percent != null ? data.percent.toFixed(2) : null,
        hourlyRate: data.hourlyRate != null ? data.hourlyRate.toFixed(2) : null,
        hours: data.hours != null ? data.hours.toFixed(2) : null,
        dailyRate: data.dailyRate != null ? data.dailyRate.toFixed(2) : null,
        days: data.days != null ? data.days.toFixed(2) : null,
        deliverableLabel: data.deliverableLabel ?? null,
        phaseLabel: data.phaseLabel ?? null,
        plannedPayDate: data.plannedPayDate ?? null,
        paidAmount: paid.toFixed(2),
        payStatus: data.payStatus ?? derivePayStatus(planned, paid),
        notes: data.notes ?? null,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();
    return reply.code(201).send({ ...row, plannedAmount: planned, pendingAmount: Math.max(0, planned - paid) });
  });

  app.put("/api/practice/team/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [member] = await db.select().from(practiceTeamMembers).where(eq(practiceTeamMembers.id, id)).limit(1);
    if (!member) return reply.code(404).send({ error: "Membro não encontrado" });
    const engagement = await assertEngagementOwned(member.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = teamMemberSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;
    const merged = {
      payMode: data.payMode ?? member.payMode,
      agreedAmount: data.agreedAmount ?? Number(member.agreedAmount),
      percent: data.percent !== undefined ? data.percent : member.percent != null ? Number(member.percent) : null,
      hourlyRate: data.hourlyRate !== undefined ? data.hourlyRate : member.hourlyRate != null ? Number(member.hourlyRate) : null,
      hours: data.hours !== undefined ? data.hours : member.hours != null ? Number(member.hours) : null,
      dailyRate: data.dailyRate !== undefined ? data.dailyRate : member.dailyRate != null ? Number(member.dailyRate) : null,
      days: data.days !== undefined ? data.days : member.days != null ? Number(member.days) : null,
    };
    const planned = plannedTeamPay(merged, Number(engagement.totalAmount));
    const paid = data.paidAmount !== undefined ? data.paidAmount : Number(member.paidAmount);
    const [updated] = await db
      .update(practiceTeamMembers)
      .set({
        name: data.name ?? member.name,
        role: data.role ?? member.role,
        specialty: data.specialty !== undefined ? data.specialty : member.specialty,
        contact: data.contact !== undefined ? data.contact : member.contact,
        isExternal: data.isExternal ?? member.isExternal,
        payMode: merged.payMode,
        agreedAmount: Number(merged.agreedAmount).toFixed(2),
        percent: merged.percent != null ? Number(merged.percent).toFixed(2) : null,
        hourlyRate: merged.hourlyRate != null ? Number(merged.hourlyRate).toFixed(2) : null,
        hours: merged.hours != null ? Number(merged.hours).toFixed(2) : null,
        dailyRate: merged.dailyRate != null ? Number(merged.dailyRate).toFixed(2) : null,
        days: merged.days != null ? Number(merged.days).toFixed(2) : null,
        deliverableLabel: data.deliverableLabel !== undefined ? data.deliverableLabel : member.deliverableLabel,
        phaseLabel: data.phaseLabel !== undefined ? data.phaseLabel : member.phaseLabel,
        plannedPayDate: data.plannedPayDate !== undefined ? data.plannedPayDate : member.plannedPayDate,
        paidAmount: paid.toFixed(2),
        payStatus: data.payStatus ?? derivePayStatus(planned, paid),
        notes: data.notes !== undefined ? data.notes : member.notes,
        sortOrder: data.sortOrder ?? member.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(practiceTeamMembers.id, id))
      .returning();
    return { ...updated, plannedAmount: planned, pendingAmount: Math.max(0, planned - paid) };
  });

  app.delete("/api/practice/team/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [member] = await db.select().from(practiceTeamMembers).where(eq(practiceTeamMembers.id, id)).limit(1);
    if (!member) return reply.code(404).send({ error: "Membro não encontrado" });
    const engagement = await assertEngagementOwned(member.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    await db.delete(practiceTeamMembers).where(eq(practiceTeamMembers.id, id));
    return { ok: true };
  });

  app.post("/api/practice/engagements/:id/expenses", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = expenseSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;
    const [row] = await db
      .insert(practiceExpenses)
      .values({
        engagementId: engagement.id,
        kind: data.kind,
        category: data.category,
        description: data.description,
        amount: data.amount.toFixed(2),
        incurredDate: data.incurredDate ?? null,
        paidAt: data.paidAt ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/practice/expenses/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [expense] = await db.select().from(practiceExpenses).where(eq(practiceExpenses.id, id)).limit(1);
    if (!expense) return reply.code(404).send({ error: "Despesa não encontrada" });
    const engagement = await assertEngagementOwned(expense.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = expenseSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const data = parsed.data;
    const [updated] = await db
      .update(practiceExpenses)
      .set({
        kind: data.kind ?? expense.kind,
        category: data.category ?? expense.category,
        description: data.description ?? expense.description,
        amount: data.amount !== undefined ? data.amount.toFixed(2) : expense.amount,
        incurredDate: data.incurredDate !== undefined ? data.incurredDate : expense.incurredDate,
        paidAt: data.paidAt !== undefined ? data.paidAt : expense.paidAt,
        notes: data.notes !== undefined ? data.notes : expense.notes,
      })
      .where(eq(practiceExpenses.id, id))
      .returning();
    return updated;
  });

  app.delete("/api/practice/expenses/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [expense] = await db.select().from(practiceExpenses).where(eq(practiceExpenses.id, id)).limit(1);
    if (!expense) return reply.code(404).send({ error: "Despesa não encontrada" });
    const engagement = await assertEngagementOwned(expense.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    await db.delete(practiceExpenses).where(eq(practiceExpenses.id, id));
    return { ok: true };
  });

  // ---------- Cronograma / entregáveis / revisões / adendas ----------
  app.post("/api/practice/engagements/:id/schedule", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = schedulePhaseSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const dates = resolvePhaseDates(parsed.data);
    const [row] = await db
      .insert(practiceSchedulePhases)
      .values({
        engagementId: engagement.id,
        title: parsed.data.title,
        assigneeName: parsed.data.assigneeName ?? null,
        startDate: dates.startDate,
        endDate: dates.endDate,
        durationDays: dates.durationDays,
        status: parsed.data.status ?? "nao_iniciado",
        notes: parsed.data.notes ?? null,
        sortOrder: parsed.data.sortOrder ?? 0,
      })
      .returning();
    return reply.code(201).send({ ...row, effectiveStatus: effectivePhaseStatus(row.status, row.endDate) });
  });

  app.post("/api/practice/engagements/:id/schedule/from-milestones", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const existing = await db
      .select()
      .from(practiceSchedulePhases)
      .where(eq(practiceSchedulePhases.engagementId, engagement.id))
      .limit(1);
    if (existing[0]) return reply.code(409).send({ error: "O cronograma já tem fases. Remova-as antes de importar." });
    const milestones = await db
      .select()
      .from(practiceMilestones)
      .where(eq(practiceMilestones.engagementId, engagement.id))
      .orderBy(practiceMilestones.sortOrder);
    if (!milestones.length) return reply.code(400).send({ error: "Sem parcelas para importar" });
    const inserted = await db
      .insert(practiceSchedulePhases)
      .values(
        milestones.map((m, index) => ({
          engagementId: engagement.id,
          title: m.title,
          startDate: null,
          endDate: m.dueDate,
          durationDays: null,
          status: "nao_iniciado" as const,
          sortOrder: index,
        })),
      )
      .returning();
    return reply.code(201).send(inserted.map((row) => ({ ...row, effectiveStatus: effectivePhaseStatus(row.status, row.endDate) })));
  });

  app.put("/api/practice/schedule/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [phase] = await db.select().from(practiceSchedulePhases).where(eq(practiceSchedulePhases.id, id)).limit(1);
    if (!phase) return reply.code(404).send({ error: "Fase não encontrada" });
    const engagement = await assertEngagementOwned(phase.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = schedulePhaseSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const dates = resolvePhaseDates({
      startDate: parsed.data.startDate !== undefined ? parsed.data.startDate : phase.startDate,
      endDate: parsed.data.endDate !== undefined ? parsed.data.endDate : phase.endDate,
      durationDays: parsed.data.durationDays !== undefined ? parsed.data.durationDays : phase.durationDays,
    });
    const [updated] = await db
      .update(practiceSchedulePhases)
      .set({
        title: parsed.data.title ?? phase.title,
        assigneeName: parsed.data.assigneeName !== undefined ? parsed.data.assigneeName : phase.assigneeName,
        startDate: dates.startDate,
        endDate: dates.endDate,
        durationDays: dates.durationDays,
        status: parsed.data.status ?? phase.status,
        notes: parsed.data.notes !== undefined ? parsed.data.notes : phase.notes,
        sortOrder: parsed.data.sortOrder ?? phase.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(practiceSchedulePhases.id, id))
      .returning();
    return { ...updated, effectiveStatus: effectivePhaseStatus(updated.status, updated.endDate) };
  });

  app.delete("/api/practice/schedule/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [phase] = await db.select().from(practiceSchedulePhases).where(eq(practiceSchedulePhases.id, id)).limit(1);
    if (!phase) return reply.code(404).send({ error: "Fase não encontrada" });
    const engagement = await assertEngagementOwned(phase.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    await db.delete(practiceSchedulePhases).where(eq(practiceSchedulePhases.id, id));
    return { ok: true };
  });

  app.post("/api/practice/engagements/:id/deliverables", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = deliverableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.phaseId) {
      const [phase] = await db
        .select()
        .from(practiceSchedulePhases)
        .where(and(eq(practiceSchedulePhases.id, parsed.data.phaseId), eq(practiceSchedulePhases.engagementId, engagement.id)))
        .limit(1);
      if (!phase) return reply.code(400).send({ error: "Fase inválida para este contrato" });
    }
    const [row] = await db
      .insert(practiceDeliverables)
      .values({
        engagementId: engagement.id,
        phaseId: parsed.data.phaseId ?? null,
        title: parsed.data.title,
        assigneeName: parsed.data.assigneeName ?? null,
        dueDate: parsed.data.dueDate ?? null,
        status: parsed.data.status ?? "pendente",
        deliveredAt: parsed.data.deliveredAt ?? null,
        revisionNumber: parsed.data.revisionNumber ?? 0,
        version: parsed.data.version ?? null,
        notes: parsed.data.notes ?? null,
        sortOrder: parsed.data.sortOrder ?? 0,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.put("/api/practice/deliverables/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [item] = await db.select().from(practiceDeliverables).where(eq(practiceDeliverables.id, id)).limit(1);
    if (!item) return reply.code(404).send({ error: "Entregável não encontrado" });
    const engagement = await assertEngagementOwned(item.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = deliverableSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const status = parsed.data.status ?? item.status;
    let deliveredAt = parsed.data.deliveredAt !== undefined ? parsed.data.deliveredAt : item.deliveredAt;
    if ((status === "entregue" || status === "aprovado") && !deliveredAt) {
      deliveredAt = new Date().toISOString().slice(0, 10);
    }
    const [updated] = await db
      .update(practiceDeliverables)
      .set({
        title: parsed.data.title ?? item.title,
        phaseId: parsed.data.phaseId !== undefined ? parsed.data.phaseId : item.phaseId,
        assigneeName: parsed.data.assigneeName !== undefined ? parsed.data.assigneeName : item.assigneeName,
        dueDate: parsed.data.dueDate !== undefined ? parsed.data.dueDate : item.dueDate,
        status,
        deliveredAt,
        revisionNumber: parsed.data.revisionNumber ?? item.revisionNumber,
        version: parsed.data.version !== undefined ? parsed.data.version : item.version,
        notes: parsed.data.notes !== undefined ? parsed.data.notes : item.notes,
        sortOrder: parsed.data.sortOrder ?? item.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(practiceDeliverables.id, id))
      .returning();
    return updated;
  });

  app.delete("/api/practice/deliverables/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [item] = await db.select().from(practiceDeliverables).where(eq(practiceDeliverables.id, id)).limit(1);
    if (!item) return reply.code(404).send({ error: "Entregável não encontrado" });
    const engagement = await assertEngagementOwned(item.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    await db.delete(practiceDeliverables).where(eq(practiceDeliverables.id, id));
    return { ok: true };
  });

  app.post("/api/practice/engagements/:id/revisions", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = clientRevisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const included = parsed.data.includedInContract ?? true;
    const additional = parsed.data.isAdditionalWork ?? !included;
    const [row] = await db
      .insert(practiceClientRevisions)
      .values({
        engagementId: engagement.id,
        phaseId: parsed.data.phaseId ?? null,
        deliverableId: parsed.data.deliverableId ?? null,
        revisionDate: parsed.data.revisionDate,
        description: parsed.data.description,
        assigneeName: parsed.data.assigneeName ?? null,
        impactDays: parsed.data.impactDays ?? 0,
        impactAmount: (parsed.data.impactAmount ?? 0).toFixed(2),
        includedInContract: included,
        isAdditionalWork: additional,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/api/practice/revisions/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(practiceClientRevisions).where(eq(practiceClientRevisions.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: "Revisão não encontrada" });
    const engagement = await assertEngagementOwned(row.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    await db.delete(practiceClientRevisions).where(eq(practiceClientRevisions.id, id));
    return { ok: true };
  });

  app.post("/api/practice/engagements/:id/addenda", { preHandler: canManage }, async (request, reply) => {
    const engagement = await assertEngagementOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = addendumSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.revisionId) {
      const [rev] = await db
        .select()
        .from(practiceClientRevisions)
        .where(and(eq(practiceClientRevisions.id, parsed.data.revisionId), eq(practiceClientRevisions.engagementId, engagement.id)))
        .limit(1);
      if (!rev) return reply.code(400).send({ error: "Revisão inválida para este contrato" });
    }
    const addendumNumber = parsed.data.assignNumber !== false ? await nextAddendumNumber(engagement) : null;
    const [row] = await db
      .insert(practiceAddenda)
      .values({
        engagementId: engagement.id,
        revisionId: parsed.data.revisionId ?? null,
        addendumNumber,
        kind: parsed.data.kind,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        amount: (parsed.data.amount ?? 0).toFixed(2),
        currency: engagement.currency,
        impactDays: parsed.data.impactDays ?? 0,
        status: parsed.data.status ?? "rascunho",
        createdByUserId: request.currentUser!.id,
      })
      .returning();
    if (parsed.data.revisionId) {
      await db
        .update(practiceClientRevisions)
        .set({ addendumId: row.id, isAdditionalWork: true, includedInContract: false })
        .where(eq(practiceClientRevisions.id, parsed.data.revisionId));
    }
    return reply.code(201).send(row);
  });

  app.put("/api/practice/addenda/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [addendum] = await db.select().from(practiceAddenda).where(eq(practiceAddenda.id, id)).limit(1);
    if (!addendum) return reply.code(404).send({ error: "Adenda não encontrada" });
    const engagement = await assertEngagementOwned(addendum.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = addendumSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let addendumNumber = addendum.addendumNumber;
    if (!addendumNumber && parsed.data.assignNumber) {
      addendumNumber = await nextAddendumNumber(engagement);
    }
    const [updated] = await db
      .update(practiceAddenda)
      .set({
        kind: parsed.data.kind ?? addendum.kind,
        title: parsed.data.title ?? addendum.title,
        description: parsed.data.description !== undefined ? parsed.data.description : addendum.description,
        amount: parsed.data.amount !== undefined ? parsed.data.amount.toFixed(2) : addendum.amount,
        impactDays: parsed.data.impactDays ?? addendum.impactDays,
        status: parsed.data.status ?? addendum.status,
        addendumNumber,
        updatedAt: new Date(),
      })
      .where(eq(practiceAddenda.id, id))
      .returning();
    return updated;
  });

  app.delete("/api/practice/addenda/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [addendum] = await db.select().from(practiceAddenda).where(eq(practiceAddenda.id, id)).limit(1);
    if (!addendum) return reply.code(404).send({ error: "Adenda não encontrada" });
    const engagement = await assertEngagementOwned(addendum.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    if (addendum.revisionId) {
      await db
        .update(practiceClientRevisions)
        .set({ addendumId: null })
        .where(eq(practiceClientRevisions.id, addendum.revisionId));
    }
    await db.delete(practiceAddenda).where(eq(practiceAddenda.id, id));
    return { ok: true };
  });

  app.post("/api/practice/milestones/:id/invoice", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [milestone] = await db.select().from(practiceMilestones).where(eq(practiceMilestones.id, id)).limit(1);
    if (!milestone) return reply.code(404).send({ error: "Parcela não encontrada" });
    const engagement = await assertEngagementOwned(milestone.engagementId, companyIdOf(request));
    if (!engagement) return reply.code(404).send({ error: "Contrato não encontrado" });
    if (milestone.status !== "pendente") return reply.code(409).send({ error: "Parcela já facturada ou paga" });

    const body = z
      .object({
        dueDate: z.string().min(1).optional(),
        ivaRate: z.number().min(0).max(1).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const dueDate =
      body.data.dueDate ??
      milestone.dueDate ??
      new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const ivaRate = body.data.ivaRate ?? 0;
    const gross = Number(milestone.amount);
    const net = Number((gross * (1 + ivaRate)).toFixed(2));
    const companyId = companyIdOf(request);
    const actorId = request.currentUser!.id;

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(drizzleSql`select id from practice_milestones where id = ${id} for update`);
        const [locked] = await tx.select().from(practiceMilestones).where(eq(practiceMilestones.id, id)).limit(1);
        if (!locked || locked.status !== "pendente") {
          throw Object.assign(new Error("Parcela já facturada ou paga"), { statusCode: 409 });
        }

        const invoiceNumber = await allocateDocumentNumber(tx, companyId, "FT");
        const [invoice] = await tx
          .insert(practiceInvoices)
          .values({
            companyId,
            quoteId: engagement.quoteId,
            engagementId: engagement.id,
            clientId: engagement.clientId,
            projectId: engagement.projectId,
            invoiceNumber,
            clientName: engagement.clientName,
            status: "emitida",
            issueDate: new Date().toISOString().slice(0, 10),
            dueDate,
            currency: engagement.currency,
            grossAmount: gross.toFixed(2),
            ivaRate: ivaRate.toFixed(4),
            netAmount: net.toFixed(2),
            notes: `Parcela: ${locked.title}`,
            createdByUserId: actorId,
          })
          .returning();

        await tx.insert(practiceInvoiceLines).values({
          invoiceId: invoice.id,
          description: locked.title,
          quantity: "1",
          unit: "un",
          unitPrice: gross.toFixed(2),
          lineTotal: gross.toFixed(2),
          sortOrder: 0,
        });

        const [claimed] = await tx
          .update(practiceMilestones)
          .set({ status: "facturado", invoiceId: invoice.id })
          .where(and(eq(practiceMilestones.id, locked.id), eq(practiceMilestones.status, "pendente")))
          .returning();
        if (!claimed) {
          throw Object.assign(new Error("Parcela já facturada ou paga"), { statusCode: 409 });
        }

        await syncPracticeInvoiceReceivable(invoice.id, tx);
        return { invoice, milestoneId: locked.id };
      });
      return reply.code(201).send(result);
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500;
      if (statusCode === 409) {
        return reply.code(409).send({ error: error instanceof Error ? error.message : "Parcela já facturada ou paga" });
      }
      throw error;
    }
  });

  // ---------- Facturas ----------
  app.get("/api/practice/invoices", { preHandler: canView }, async (request) => {
    const companyId = companyIdOf(request);
    const today = new Date();
    const invoices = await db
      .select()
      .from(practiceInvoices)
      .where(eq(practiceInvoices.companyId, companyId))
      .orderBy(desc(practiceInvoices.createdAt));
    const ids = invoices.map((row) => row.id);
    const receipts = ids.length ? await db.select().from(practiceReceipts).where(inArray(practiceReceipts.invoiceId, ids)) : [];
    const receivedByInvoice = new Map<string, number>();
    for (const receipt of receipts) {
      receivedByInvoice.set(receipt.invoiceId, (receivedByInvoice.get(receipt.invoiceId) ?? 0) + Number(receipt.amount));
    }
    return invoices.map((invoice) => {
      const outstanding = Math.max(0, Number(invoice.netAmount) - (receivedByInvoice.get(invoice.id) ?? 0));
      const flags = deriveInvoiceFlags(invoice, outstanding, today);
      return {
        ...invoice,
        receivedAmount: Number((receivedByInvoice.get(invoice.id) ?? 0).toFixed(2)),
        outstandingAmount: Number(outstanding.toFixed(2)),
        overdue: flags.overdue,
        agingBucket: flags.agingBucket,
        overdueDays: flags.overdueDays,
        displayStatus: flags.overdue ? "vencida" : invoice.status,
      };
    });
  });

  app.get("/api/practice/invoices/:id", { preHandler: canView }, async (request, reply) => {
    const invoice = await assertInvoiceOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    const lines = await db
      .select()
      .from(practiceInvoiceLines)
      .where(eq(practiceInvoiceLines.invoiceId, invoice.id))
      .orderBy(practiceInvoiceLines.sortOrder);
    const receipts = await db
      .select()
      .from(practiceReceipts)
      .where(eq(practiceReceipts.invoiceId, invoice.id))
      .orderBy(desc(practiceReceipts.receivedDate));
    const receiptIds = receipts.map((row) => row.id);
    const destinations = receiptIds.length
      ? await db.select().from(practiceReceiptDestinations).where(inArray(practiceReceiptDestinations.receiptId, receiptIds))
      : [];
    return {
      ...invoice,
      lines,
      receipts: receipts.map((receipt) => ({
        ...receipt,
        destinations: destinations.filter((dest) => dest.receiptId === receipt.id),
      })),
    };
  });

  app.post("/api/practice/invoices", { preHandler: canManage }, async (request, reply) => {
    const parsed = invoiceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const prepared = lineTotals(parsed.data.lines);
    const gross = prepared.reduce((sum, line) => sum + line.amount, 0);
    const net = Number((gross * (1 + parsed.data.ivaRate)).toFixed(2));
    const invoiceNumber =
      parsed.data.invoiceNumber ??
      (parsed.data.status === "emitida" ? await nextDocumentNumber(companyIdOf(request), "FT") : null);
    const [invoice] = await db
      .insert(practiceInvoices)
      .values({
        companyId: companyIdOf(request),
        quoteId: parsed.data.quoteId ?? null,
        engagementId: parsed.data.engagementId ?? null,
        clientId: parsed.data.clientId ?? null,
        projectId: parsed.data.projectId ?? null,
        invoiceNumber,
        clientName: parsed.data.clientName,
        status: parsed.data.status,
        issueDate: parsed.data.issueDate ?? new Date().toISOString().slice(0, 10),
        dueDate: parsed.data.dueDate,
        currency: parsed.data.currency,
        grossAmount: gross.toFixed(2),
        ivaRate: parsed.data.ivaRate.toFixed(4),
        netAmount: net.toFixed(2),
        notes: parsed.data.notes,
        createdByUserId: request.currentUser!.id,
      })
      .returning();
    await db.insert(practiceInvoiceLines).values(
      prepared.map(({ amount: _a, phase: _p, ...line }) => ({ ...line, invoiceId: invoice.id })),
    );
    if (invoice.status !== "rascunho") {
      await syncPracticeInvoiceReceivable(invoice.id);
    }
    return reply.code(201).send(invoice);
  });

  app.put("/api/practice/invoices/:id/cancel", { preHandler: canManage }, async (request, reply) => {
    const invoice = await assertInvoiceOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    if (invoice.status === "cancelada") return reply.code(409).send({ error: "Factura já cancelada" });
    if (invoice.status === "paga") return reply.code(409).send({ error: "Não é possível cancelar uma factura paga" });
    const receipts = await db.select().from(practiceReceipts).where(eq(practiceReceipts.invoiceId, invoice.id)).limit(1);
    if (receipts.length) {
      return reply.code(409).send({ error: "Factura com recibos não pode ser cancelada" });
    }
    const [updated] = await db
      .update(practiceInvoices)
      .set({ status: "cancelada", updatedAt: new Date() })
      .where(eq(practiceInvoices.id, invoice.id))
      .returning();
    await db
      .update(practiceMilestones)
      .set({ status: "pendente", invoiceId: null })
      .where(and(eq(practiceMilestones.invoiceId, invoice.id), eq(practiceMilestones.status, "facturado")));
    await syncPracticeInvoiceReceivable(updated.id);
    return updated;
  });

  app.get("/api/practice/invoices/:id/export.pdf", { preHandler: canView }, async (request, reply) => {
    const invoice = await assertInvoiceOwned((request.params as { id: string }).id, companyIdOf(request));
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    if (invoice.status === "rascunho" || invoice.status === "cancelada") {
      return reply.code(409).send({ error: "Emita a factura antes de exportar" });
    }
    const lines = await db
      .select()
      .from(practiceInvoiceLines)
      .where(eq(practiceInvoiceLines.invoiceId, invoice.id))
      .orderBy(practiceInvoiceLines.sortOrder);
    const client = invoice.clientId ? await assertClientOwned(invoice.clientId, companyIdOf(request)) : null;
    const brand = await loadCompanyBrand(companyIdOf(request));
    const buffer = await buildPracticeDocumentPdf({
      kind: "factura",
      number: invoice.invoiceNumber,
      clientName: invoice.clientName,
      clientNuit: client?.nuit,
      clientAddress: client?.address,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      grossAmount: Number(invoice.grossAmount),
      netAmount: Number(invoice.netAmount),
      ivaRate: Number(invoice.ivaRate),
      notes: invoice.notes,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unit: line.unit,
        unitPrice: Number(line.unitPrice),
        lineTotal: Number(line.lineTotal),
      })),
      company: brand,
    });
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="Factura-${(invoice.invoiceNumber ?? invoice.id).replace(/[^\w-]/g, "")}.pdf"`)
      .send(buffer);
  });

  // ---------- Recibos + destinos ----------
  app.post("/api/practice/invoices/:id/receipts", { preHandler: canManage }, async (request, reply) => {
    const invoiceId = (request.params as { id: string }).id;
    const companyId = companyIdOf(request);
    const invoice = await assertInvoiceOwned(invoiceId, companyId);
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    if (["rascunho", "cancelada"].includes(invoice.status)) {
      return reply.code(409).send({ error: "A factura precisa de estar emitida para receber pagamentos" });
    }
    const parsed = receiptSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const destSum = parsed.data.destinations.reduce((sum, dest) => sum + dest.amount, 0);
    if (Math.abs(destSum - parsed.data.amount) > 0.02) {
      return reply.code(400).send({ error: "A soma dos destinos tem de igualar o valor do recibo" });
    }

    try {
      const receipt = await db.transaction(async (tx) => {
        await tx.execute(drizzleSql`select id from practice_invoices where id = ${invoiceId} for update`);
        const [locked] = await tx.select().from(practiceInvoices).where(eq(practiceInvoices.id, invoiceId)).limit(1);
        if (!locked || ["rascunho", "cancelada"].includes(locked.status)) {
          throw Object.assign(new Error("A factura precisa de estar emitida para receber pagamentos"), { statusCode: 409 });
        }
        const existing = await tx.select().from(practiceReceipts).where(eq(practiceReceipts.invoiceId, locked.id));
        const already = existing.reduce((sum, row) => sum + Number(row.amount), 0);
        if (already + parsed.data.amount - Number(locked.netAmount) > 0.02) {
          throw Object.assign(new Error("O recibo ultrapassa o valor em aberto da factura"), { statusCode: 409 });
        }

        const receiptNumber = await allocateDocumentNumber(tx, companyId, "RC");
        const [created] = await tx
          .insert(practiceReceipts)
          .values({
            invoiceId: locked.id,
            companyId,
            receiptNumber,
            amount: parsed.data.amount.toFixed(2),
            receivedDate: parsed.data.receivedDate,
            reference: parsed.data.reference,
            notes: parsed.data.notes,
            createdByUserId: request.currentUser!.id,
          })
          .returning();
        await tx.insert(practiceReceiptDestinations).values(
          parsed.data.destinations.map((dest) => ({
            receiptId: created.id,
            kind: dest.kind,
            amount: dest.amount.toFixed(2),
            partyName: dest.kind === "terceiro" ? dest.partyName ?? "Terceiro" : null,
            description: dest.description,
          })),
        );
        await refreshInvoiceStatus(locked.id, tx);
        await syncPracticeInvoiceReceivable(locked.id, tx);
        return created;
      });
      return reply.code(201).send(receipt);
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500;
      if (statusCode === 409) {
        return reply.code(409).send({ error: error instanceof Error ? error.message : "Conflito ao registar recibo" });
      }
      throw error;
    }
  });

  app.get("/api/practice/receipts/:id/export.pdf", { preHandler: canView }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [receipt] = await db.select().from(practiceReceipts).where(eq(practiceReceipts.id, id)).limit(1);
    if (!receipt || receipt.companyId !== companyIdOf(request)) {
      return reply.code(404).send({ error: "Recibo não encontrado" });
    }
    const invoice = await assertInvoiceOwned(receipt.invoiceId, companyIdOf(request));
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    const client = invoice.clientId ? await assertClientOwned(invoice.clientId, companyIdOf(request)) : null;
    const brand = await loadCompanyBrand(companyIdOf(request));
    const buffer = await buildPracticeDocumentPdf({
      kind: "recibo",
      number: receipt.receiptNumber,
      clientName: invoice.clientName,
      clientNuit: client?.nuit,
      clientAddress: client?.address,
      issueDate: receipt.receivedDate,
      currency: invoice.currency,
      amount: Number(receipt.amount),
      notes: receipt.notes ?? receipt.reference,
      company: brand,
    });
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="Recibo-${(receipt.receiptNumber ?? receipt.id).replace(/[^\w-]/g, "")}.pdf"`)
      .send(buffer);
  });

  app.put("/api/practice/destinations/:id/pay", { preHandler: canManage }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [destination] = await db.select().from(practiceReceiptDestinations).where(eq(practiceReceiptDestinations.id, id)).limit(1);
    if (!destination) return reply.code(404).send({ error: "Destino não encontrado" });
    if (destination.kind !== "terceiro") return reply.code(409).send({ error: "Só destinos a terceiros são desembolsados" });
    const [receipt] = await db.select().from(practiceReceipts).where(eq(practiceReceipts.id, destination.receiptId)).limit(1);
    if (!receipt || receipt.companyId !== companyIdOf(request)) return reply.code(404).send({ error: "Destino não encontrado" });
    const paidAt = (request.body as { paidAt?: string } | undefined)?.paidAt ?? new Date().toISOString().slice(0, 10);
    const [updated] = await db
      .update(practiceReceiptDestinations)
      .set({ paidAt })
      .where(eq(practiceReceiptDestinations.id, id))
      .returning();
    return updated;
  });

  app.get("/api/practice/payables", { preHandler: canView }, async (request) => {
    const companyId = companyIdOf(request);
    const rows = await db
      .select({
        destination: practiceReceiptDestinations,
        receipt: practiceReceipts,
        invoice: practiceInvoices,
      })
      .from(practiceReceiptDestinations)
      .innerJoin(practiceReceipts, eq(practiceReceiptDestinations.receiptId, practiceReceipts.id))
      .innerJoin(practiceInvoices, eq(practiceReceipts.invoiceId, practiceInvoices.id))
      .where(
        and(
          eq(practiceInvoices.companyId, companyId),
          eq(practiceReceiptDestinations.kind, "terceiro"),
          isNull(practiceReceiptDestinations.paidAt),
        ),
      )
      .orderBy(desc(practiceReceipts.receivedDate));
    return rows.map((row) => ({
      ...row.destination,
      receivedDate: row.receipt.receivedDate,
      invoiceId: row.invoice.id,
      invoiceNumber: row.invoice.invoiceNumber,
      clientName: row.invoice.clientName,
      currency: row.invoice.currency,
    }));
  });
}
