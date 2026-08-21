import { request, ApiError } from "./http";
import { downloadBlob } from "./quickCalc";

export type PracticeAging = {
  current: number;
  "0-30": number;
  "30-60": number;
  "60+": number;
};

export type PracticeAtelierDashboard = {
  comercial: {
    rascunhos: number;
    enviadas: number;
    aprovadas: number;
    rejeitadas: number;
    canceladas: number;
    aFechar: number;
    valorNegociacao: number;
    valorGanho: number;
    conversaoPct: number;
  };
  financeiro: {
    cashOnHand: number;
    receivables: number;
    overdueAmount: number;
    payablesThirdParty: number;
    activeInvoices: number;
    invoiced: number;
    received: number;
  };
  producao: {
    activeContracts: number;
    phasesTotal: number;
    phasesInProgress: number;
    phasesOverdue: number;
    deliverablesPending: number;
    deliverablesTotal: number;
    addendaOpen: number;
  };
  equipa: {
    membersTotal: number;
    membersExternal: number;
    honorariosPendentes: number;
    payStatus: { pendente: number; parcial: number; pago: number };
  };
};

export type PracticeOpsKpis = {
  progressPct: number;
  daysRemaining: number | null;
  contractEnd: string | null;
  overduePhases: number;
  phasesTotal: number;
  phasesDone: number;
  deliverablesTotal: number;
  deliverablesDone: number;
  revisionsOpen: number;
  addendaOpen: number;
  teamSize?: number;
  nextActivities: Array<{
    kind: "fase" | "entregavel";
    id: string;
    title: string;
    date: string | null;
    status: string;
  }>;
};

export type PracticeBudgetSource = {
  id: string;
  title: string;
  documentType: "medicao" | "orcamento";
  fileNumber: string | null;
  revision: string | null;
  currency: string;
  projectId: string;
  projectName: string;
  client: string | null;
  location: string | null;
};

export type PracticeSummary = {
  cashOnHand: number;
  receivables: number;
  overdueAmount: number;
  payablesThirdParty: number;
  openQuotes: number;
  activeInvoices: number;
  currency: string;
  aging: PracticeAging;
  overdueInvoices: Array<{
    id: string;
    clientName: string;
    invoiceNumber: string | null;
    dueDate: string | null;
    outstanding: number;
    overdueDays: number;
    currency: string;
  }>;
  pipelineQuotes: Array<{
    id: string;
    title: string;
    clientName: string;
    status: PracticeQuote["status"];
    totalAmount: string;
    currency: string;
    quoteNumber: string | null;
  }>;
  pendingMilestones: Array<{
    id: string;
    title: string;
    amount: string;
    dueDate: string | null;
    engagementId: string;
    engagementTitle: string;
    clientName: string;
    currency: string;
  }>;
  atelier?: PracticeAtelierDashboard;
  documentSetup?: {
    hasLogo: boolean;
    hasBankDetails: boolean;
    companyName: string;
  };
};

export type PracticeClient = {
  id: string;
  companyId: string;
  name: string;
  legalName?: string | null;
  tradeName?: string | null;
  clientType?: "particular" | "empresa" | "ong" | "publico" | "outro";
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  billingAddress?: string | null;
  province?: string | null;
  district?: string | null;
  nuit: string | null;
  nuitForeign?: boolean;
  paymentTerms?: string | null;
  preferredCurrency?: string;
  notes: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type PracticeQuote = {
  id: string;
  companyId: string;
  clientId: string | null;
  projectId: string | null;
  title: string;
  clientName: string;
  status: "rascunho" | "enviada" | "aprovada" | "rejeitada" | "cancelada";
  quoteNumber: string | null;
  issueDate: string | null;
  validUntil: string | null;
  currency: string;
  fxRate?: string | null;
  paymentMethodCodes?: string[];
  pipelineSource?: string | null;
  probabilityPct?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  tenderReference?: string | null;
  tenderDeadline?: string | null;
  tenderStatus?: "rascunho" | "em_preparacao" | "submetido" | "adjudicado" | "perdido" | "cancelado" | null;
  notes: string | null;
  serviceType?: string | null;
  serviceCategory?: string | null;
  projectDesignation?: string | null;
  location?: string | null;
  totalAmount: string;
  acceptedAmount?: string | null;
  discountAmount?: string | null;
  discountPercent?: string | null;
  acceptanceNotes?: string | null;
  expectedCloseDate?: string | null;
  lossReason?: string | null;
  ownerUserId?: string | null;
  approvedAt: string | null;
  createdAt: string;
};

export type PracticeLine = {
  id?: string;
  phase?: string | null;
  description: string;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
  lineTotal?: string;
  sortOrder?: number;
};

export type PracticeInvoice = {
  id: string;
  companyId: string;
  quoteId: string | null;
  engagementId?: string | null;
  clientId: string | null;
  projectId: string | null;
  invoiceNumber: string | null;
  clientName: string;
  status: "rascunho" | "emitida" | "parcial" | "paga" | "cancelada";
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  grossAmount: string;
  ivaRate: string;
  netAmount: string;
  notes: string | null;
  createdAt: string;
  receivedAmount?: number;
  outstandingAmount?: number;
  overdue?: boolean;
  agingBucket?: "current" | "0-30" | "30-60" | "60+" | null;
  overdueDays?: number;
  displayStatus?: string;
};

export type PracticeMilestone = {
  id: string;
  engagementId: string;
  title: string;
  percent: string | null;
  amount: string;
  dueDate: string | null;
  status: "pendente" | "facturado" | "pago";
  invoiceId: string | null;
  sortOrder: number;
};

export type PracticeTeamPayMode = "fixo" | "percentagem" | "hora" | "dia" | "entregavel" | "fase";
export type PracticeTeamPayStatus = "pendente" | "parcial" | "pago";
export type PracticeExpenseKind = "interno" | "reembolsavel";
export type PracticeServiceProjectType =
  | "Arquitectura"
  | "Engenharia"
  | "Fiscalização"
  | "Consultoria"
  | "Coordenação"
  | "Outro";

export type PracticeTeamMember = {
  id: string;
  engagementId: string;
  name: string;
  role: string;
  specialty: string | null;
  contact: string | null;
  isExternal: boolean;
  payMode: PracticeTeamPayMode;
  agreedAmount: string;
  percent: string | null;
  hourlyRate: string | null;
  hours: string | null;
  dailyRate: string | null;
  days: string | null;
  deliverableLabel: string | null;
  phaseLabel: string | null;
  plannedPayDate: string | null;
  paidAmount: string;
  payStatus: PracticeTeamPayStatus;
  notes: string | null;
  sortOrder: number;
  plannedAmount?: number;
  pendingAmount?: number;
};

export type PracticeExpense = {
  id: string;
  engagementId: string;
  kind: PracticeExpenseKind;
  category: string;
  description: string;
  amount: string;
  incurredDate: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
};

export type PracticeEngagementFinance = {
  originalAmount?: number;
  approvedVariations?: number;
  contracted: number;
  invoiced: number;
  received: number;
  receivable: number;
  honorariosPrevistos: number;
  honorariosPagos: number;
  honorariosPendentes: number;
  despesasInternas: number;
  despesasReembolsaveis: number;
  custosPrevistos: number;
  custosRealizados: number;
  margemPrevista: number;
  margemReal: number;
  rentabilidadePrevistaPct: number;
  rentabilidadeRealPct: number;
};

export type PracticePhaseStatus =
  | "nao_iniciado"
  | "em_preparacao"
  | "em_curso"
  | "aguardando_cliente"
  | "aguardando_terceiro"
  | "em_revisao"
  | "concluido"
  | "suspenso"
  | "atrasado";

export type PracticeDeliverableStatus =
  | "pendente"
  | "em_curso"
  | "entregue"
  | "em_revisao"
  | "aprovado"
  | "rejeitado";

export type PracticeAddendumKind =
  | "trabalho_adicional"
  | "alteracao_escopo"
  | "nova_especialidade"
  | "revisao_extraordinaria"
  | "extensao_fiscalizacao"
  | "consultoria_adicional";

export type PracticeSchedulePhase = {
  id: string;
  engagementId: string;
  title: string;
  assigneeName: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  status: PracticePhaseStatus;
  effectiveStatus?: PracticePhaseStatus;
  notes: string | null;
  sortOrder: number;
};

export type PracticeDeliverable = {
  id: string;
  engagementId: string;
  phaseId: string | null;
  title: string;
  assigneeName: string | null;
  dueDate: string | null;
  status: PracticeDeliverableStatus;
  deliveredAt: string | null;
  revisionNumber: number;
  version: string | null;
  notes: string | null;
  sortOrder: number;
};

export type PracticeClientRevision = {
  id: string;
  engagementId: string;
  phaseId: string | null;
  deliverableId: string | null;
  revisionDate: string;
  description: string;
  assigneeName: string | null;
  impactDays: number;
  impactAmount: string;
  includedInContract: boolean;
  isAdditionalWork: boolean;
  addendumId: string | null;
  notes: string | null;
  createdAt: string;
};

export type PracticeAddendum = {
  id: string;
  engagementId: string;
  revisionId: string | null;
  quoteId: string | null;
  addendumNumber: string | null;
  kind: PracticeAddendumKind;
  title: string;
  description: string | null;
  amount: string;
  currency: string;
  impactDays: number;
  status: "rascunho" | "enviada" | "aprovada" | "rejeitada" | "cancelada";
  createdAt: string;
};

export type PracticeEngagement = {
  id: string;
  companyId: string;
  clientId: string | null;
  quoteId: string | null;
  projectId: string | null;
  title: string;
  clientName: string;
  status: "rascunho" | "activo" | "concluido" | "cancelado";
  currency: string;
  totalAmount: string;
  notes: string | null;
  serviceProjectType?: string | null;
  serviceType?: string | null;
  createdAt: string;
  milestones?: PracticeMilestone[];
  team?: PracticeTeamMember[];
  expenses?: PracticeExpense[];
  finance?: PracticeEngagementFinance;
  schedule?: PracticeSchedulePhase[];
  deliverables?: PracticeDeliverable[];
  revisions?: PracticeClientRevision[];
  addenda?: PracticeAddendum[];
  opsKpis?: PracticeOpsKpis;
};

export type TeamMemberInput = {
  name: string;
  role: string;
  specialty?: string | null;
  contact?: string | null;
  isExternal?: boolean;
  payMode?: PracticeTeamPayMode;
  agreedAmount?: number;
  percent?: number | null;
  hourlyRate?: number | null;
  hours?: number | null;
  dailyRate?: number | null;
  days?: number | null;
  deliverableLabel?: string | null;
  phaseLabel?: string | null;
  plannedPayDate?: string | null;
  paidAmount?: number;
  payStatus?: PracticeTeamPayStatus;
  notes?: string | null;
};

export type ExpenseInput = {
  kind?: PracticeExpenseKind;
  category: string;
  description: string;
  amount: number;
  incurredDate?: string | null;
  paidAt?: string | null;
  notes?: string | null;
};

export type PracticeDestination = {
  id: string;
  receiptId: string;
  kind: "caixa" | "terceiro";
  amount: string;
  partyName: string | null;
  description: string | null;
  paidAt: string | null;
};

export type PracticeReceipt = {
  id: string;
  invoiceId: string;
  receiptNumber?: string | null;
  amount: string;
  receivedDate: string;
  reference: string | null;
  notes: string | null;
  destinations?: PracticeDestination[];
};

export type PracticePayable = PracticeDestination & {
  receivedDate: string;
  invoiceId: string;
  invoiceNumber: string | null;
  clientName: string;
  currency: string;
};

export type QuoteLineInput = {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  phase?: string;
  specialty?: string;
  included?: boolean;
  optional?: boolean;
  durationDays?: number | null;
};

export type PracticeQuoteConditions = {
  intro?: string;
  objectText?: string;
  paymentTerms?: string;
  exclusions?: string;
  revisionsIncluded?: number;
  taxNote?: string;
  reimbursablesNote?: string;
  validityText?: string;
  deadlineText?: string;
  additionalNotes?: string;
  acceptanceText?: string;
};

export type DestinationInput = {
  kind: "caixa" | "terceiro";
  amount: number;
  partyName?: string;
  description?: string;
};

async function fetchPdf(path: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
  }
  return res.blob();
}

export const practiceApi = {
  summary: () => request<PracticeSummary>("/practice/summary"),
  listBudgetSources: () => request<PracticeBudgetSource[]>("/practice/budget-sources"),
  createQuoteFromBudget: (data: {
    documentId: string;
    attachMode?: "nada" | "resumo" | "mapa";
    assignNumber?: boolean;
    clientId?: string | null;
    clientName?: string;
    title?: string;
    validUntil?: string | null;
    notes?: string | null;
    projectDesignation?: string | null;
    workType?: string | null;
    location?: string | null;
    ownerName?: string | null;
    projectDescription?: string | null;
    observations?: string | null;
    plannedStartDate?: string | null;
    clientDeadline?: string | null;
    conditions?: PracticeQuoteConditions;
  }) =>
    request<PracticeQuote>("/practice/quotes/from-budget", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listClients: () => request<PracticeClient[]>("/practice/clients"),
  getClient: (id: string) =>
    request<
      PracticeClient & {
        quotes: PracticeQuote[];
        invoices: PracticeInvoice[];
        engagements: PracticeEngagement[];
        receipts: PracticeReceipt[];
      }
    >(`/practice/clients/${id}`),
  createClient: (data: {
    name: string;
    legalName?: string | null;
    tradeName?: string | null;
    clientType?: PracticeClient["clientType"];
    contact?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    billingAddress?: string | null;
    province?: string | null;
    district?: string | null;
    nuit?: string | null;
    nuitForeign?: boolean;
    paymentTerms?: string | null;
    preferredCurrency?: string;
    notes?: string | null;
  }) => request<PracticeClient>("/practice/clients", { method: "POST", body: JSON.stringify(data) }),
  updateClient: (
    id: string,
    data: {
      name: string;
      legalName?: string | null;
      tradeName?: string | null;
      clientType?: PracticeClient["clientType"];
      contact?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      billingAddress?: string | null;
      province?: string | null;
      district?: string | null;
      nuit?: string | null;
      nuitForeign?: boolean;
      paymentTerms?: string | null;
      preferredCurrency?: string;
      notes?: string | null;
    },
  ) => request<PracticeClient>(`/practice/clients/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  listQuotes: () => request<PracticeQuote[]>("/practice/quotes"),
  getQuote: (id: string) => request<PracticeQuote & { lines: PracticeLine[] }>(`/practice/quotes/${id}`),
  createQuote: (data: {
    title: string;
    clientName: string;
    clientId?: string | null;
    projectId?: string | null;
    sourceBudgetDocumentId?: string | null;
    quoteNumber?: string;
    issueDate?: string;
    validUntil?: string;
    currency?: string;
    fxRate?: number | null;
    paymentMethodCodes?: string[];
    pipelineSource?: string | null;
    probabilityPct?: number | null;
    nextAction?: string | null;
    nextActionDate?: string | null;
    tenderReference?: string | null;
    tenderDeadline?: string | null;
    tenderStatus?: PracticeQuote["tenderStatus"];
    notes?: string;
    serviceCategory?: string | null;
    serviceType?: string | null;
    pricingMode?: string | null;
    projectDesignation?: string | null;
    workType?: string | null;
    location?: string | null;
    ownerName?: string | null;
    estimatedArea?: string | null;
    floors?: string | null;
    projectDescription?: string | null;
    observations?: string | null;
    plannedStartDate?: string | null;
    clientDeadline?: string | null;
    conditions?: PracticeQuoteConditions;
    lines: QuoteLineInput[];
  }) => request<PracticeQuote>("/practice/quotes", { method: "POST", body: JSON.stringify(data) }),
  updateQuote: (
    id: string,
    data: {
      title: string;
      clientName: string;
      clientId?: string | null;
      sourceBudgetDocumentId?: string | null;
      issueDate?: string;
      validUntil?: string;
      currency?: string;
      notes?: string;
      serviceCategory?: string | null;
      serviceType?: string | null;
      pricingMode?: string | null;
      projectDesignation?: string | null;
      workType?: string | null;
      location?: string | null;
      ownerName?: string | null;
      estimatedArea?: string | null;
      floors?: string | null;
      projectDescription?: string | null;
      observations?: string | null;
      plannedStartDate?: string | null;
      clientDeadline?: string | null;
      conditions?: PracticeQuoteConditions;
      lines: QuoteLineInput[];
    },
  ) => request<PracticeQuote>(`/practice/quotes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  setQuoteStatus: (
    id: string,
    status: PracticeQuote["status"],
    options?: {
      createEngagement?: boolean;
      acceptedAmount?: number;
      discountAmount?: number;
      discountPercent?: number;
      acceptanceNotes?: string;
      lossReason?: string;
    },
  ) =>
    request<PracticeQuote & { engagement?: PracticeEngagement | null }>(`/practice/quotes/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, createEngagement: true, ...options }),
    }),
  quoteToInvoice: (id: string, data?: { dueDate?: string; ivaRate?: number }) =>
    request<PracticeInvoice>(`/practice/quotes/${id}/to-invoice`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  downloadQuotePdf: async (id: string, filename: string) => {
    const blob = await fetchPdf(`/practice/quotes/${id}/export.pdf`);
    downloadBlob(blob, filename);
  },
  listEngagements: () => request<PracticeEngagement[]>("/practice/engagements"),
  getEngagement: (id: string) =>
    request<
      PracticeEngagement & {
        milestones: PracticeMilestone[];
        team: PracticeTeamMember[];
        expenses: PracticeExpense[];
        finance: PracticeEngagementFinance;
        schedule: PracticeSchedulePhase[];
        deliverables: PracticeDeliverable[];
        revisions: PracticeClientRevision[];
        addenda: PracticeAddendum[];
        opsKpis: PracticeOpsKpis;
      }
    >(`/practice/engagements/${id}`),
  updateEngagement: (
    id: string,
    data: {
      projectId?: string | null;
      serviceProjectType?: PracticeServiceProjectType | null;
      serviceType?: string | null;
      notes?: string | null;
      status?: PracticeEngagement["status"];
    },
  ) =>
    request<PracticeEngagement>(`/practice/engagements/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  linkEngagementProject: (id: string, projectId: string | null) =>
    request<PracticeEngagement>(`/practice/engagements/${id}`, {
      method: "PUT",
      body: JSON.stringify({ projectId }),
    }),
  addTeamMember: (engagementId: string, data: TeamMemberInput) =>
    request<PracticeTeamMember>(`/practice/engagements/${engagementId}/team`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTeamMember: (id: string, data: Partial<TeamMemberInput>) =>
    request<PracticeTeamMember>(`/practice/team/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteTeamMember: (id: string) =>
    request<{ ok: boolean }>(`/practice/team/${id}`, { method: "DELETE" }),
  addExpense: (engagementId: string, data: ExpenseInput) =>
    request<PracticeExpense>(`/practice/engagements/${engagementId}/expenses`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateExpense: (id: string, data: Partial<ExpenseInput>) =>
    request<PracticeExpense>(`/practice/expenses/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteExpense: (id: string) =>
    request<{ ok: boolean }>(`/practice/expenses/${id}`, { method: "DELETE" }),
  addSchedulePhase: (
    engagementId: string,
    data: {
      title: string;
      assigneeName?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      durationDays?: number | null;
      status?: PracticePhaseStatus;
      notes?: string | null;
    },
  ) =>
    request<PracticeSchedulePhase>(`/practice/engagements/${engagementId}/schedule`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  importScheduleFromMilestones: (engagementId: string) =>
    request<PracticeSchedulePhase[]>(`/practice/engagements/${engagementId}/schedule/from-milestones`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  updateSchedulePhase: (
    id: string,
    data: Partial<{
      title: string;
      assigneeName: string | null;
      startDate: string | null;
      endDate: string | null;
      durationDays: number | null;
      status: PracticePhaseStatus;
      notes: string | null;
    }>,
  ) =>
    request<PracticeSchedulePhase>(`/practice/schedule/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteSchedulePhase: (id: string) =>
    request<{ ok: boolean }>(`/practice/schedule/${id}`, { method: "DELETE" }),
  addDeliverable: (
    engagementId: string,
    data: {
      title: string;
      phaseId?: string | null;
      assigneeName?: string | null;
      dueDate?: string | null;
      status?: PracticeDeliverableStatus;
      version?: string | null;
      notes?: string | null;
    },
  ) =>
    request<PracticeDeliverable>(`/practice/engagements/${engagementId}/deliverables`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDeliverable: (
    id: string,
    data: Partial<{
      title: string;
      phaseId: string | null;
      assigneeName: string | null;
      dueDate: string | null;
      status: PracticeDeliverableStatus;
      deliveredAt: string | null;
      revisionNumber: number;
      version: string | null;
      notes: string | null;
    }>,
  ) =>
    request<PracticeDeliverable>(`/practice/deliverables/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteDeliverable: (id: string) =>
    request<{ ok: boolean }>(`/practice/deliverables/${id}`, { method: "DELETE" }),
  addClientRevision: (
    engagementId: string,
    data: {
      revisionDate: string;
      description: string;
      assigneeName?: string | null;
      phaseId?: string | null;
      deliverableId?: string | null;
      impactDays?: number;
      impactAmount?: number;
      includedInContract?: boolean;
      isAdditionalWork?: boolean;
      notes?: string | null;
    },
  ) =>
    request<PracticeClientRevision>(`/practice/engagements/${engagementId}/revisions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteClientRevision: (id: string) =>
    request<{ ok: boolean }>(`/practice/revisions/${id}`, { method: "DELETE" }),
  createAddendum: (
    engagementId: string,
    data: {
      kind?: PracticeAddendumKind;
      title: string;
      description?: string | null;
      amount?: number;
      impactDays?: number;
      status?: PracticeAddendum["status"];
      revisionId?: string | null;
      assignNumber?: boolean;
    },
  ) =>
    request<PracticeAddendum>(`/practice/engagements/${engagementId}/addenda`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAddendum: (
    id: string,
    data: Partial<{
      kind: PracticeAddendumKind;
      title: string;
      description: string | null;
      amount: number;
      impactDays: number;
      status: PracticeAddendum["status"];
      assignNumber: boolean;
    }>,
  ) =>
    request<PracticeAddendum>(`/practice/addenda/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAddendum: (id: string) =>
    request<{ ok: boolean }>(`/practice/addenda/${id}`, { method: "DELETE" }),
  invoiceMilestone: (id: string, data?: { dueDate?: string; ivaRate?: number }) =>
    request<{ invoice: PracticeInvoice; milestoneId: string }>(`/practice/milestones/${id}/invoice`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  listInvoices: () => request<PracticeInvoice[]>("/practice/invoices"),
  getInvoice: (id: string) =>
    request<PracticeInvoice & { lines: PracticeLine[]; receipts: PracticeReceipt[] }>(`/practice/invoices/${id}`),
  createInvoice: (data: {
    clientName: string;
    clientId?: string | null;
    invoiceNumber?: string;
    issueDate?: string;
    dueDate: string;
    currency?: string;
    ivaRate?: number;
    notes?: string;
    lines: QuoteLineInput[];
    status?: "rascunho" | "emitida";
  }) => request<PracticeInvoice>("/practice/invoices", { method: "POST", body: JSON.stringify(data) }),
  cancelInvoice: (id: string) =>
    request<PracticeInvoice>(`/practice/invoices/${id}/cancel`, { method: "PUT" }),
  downloadInvoicePdf: async (id: string, filename: string) => {
    const blob = await fetchPdf(`/practice/invoices/${id}/export.pdf`);
    downloadBlob(blob, filename);
  },
  downloadReceiptPdf: async (id: string, filename: string) => {
    const blob = await fetchPdf(`/practice/receipts/${id}/export.pdf`);
    downloadBlob(blob, filename);
  },
  addReceipt: (
    invoiceId: string,
    data: { amount: number; receivedDate: string; reference?: string; notes?: string; destinations: DestinationInput[] },
  ) => request<PracticeReceipt>(`/practice/invoices/${invoiceId}/receipts`, { method: "POST", body: JSON.stringify(data) }),
  markDestinationPaid: (id: string, paidAt?: string) =>
    request<PracticeDestination>(`/practice/destinations/${id}/pay`, {
      method: "PUT",
      body: JSON.stringify(paidAt ? { paidAt } : {}),
    }),
  listPayables: () => request<PracticePayable[]>("/practice/payables"),
};
