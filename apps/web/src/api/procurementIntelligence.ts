import { request } from "./http";

export type AgingBucketKey = "nao_vencido" | "1_30" | "31_60" | "61_90" | "mais_90" | "sem_vencimento";
export type ForecastConfidence = "alta" | "media" | "baixa";
export type ForecastSource = "pedido_pagamento" | "factura" | "factura_em_revisao" | "ordem_compra" | "necessidade_cronograma";

export type ProcurementIntelligenceDashboard = {
  asOfDate: string;
  project: { id: string; name: string; currency: string; zoneId: string | null };
  evidence: { budgetDocumentId: string | null; budgetDocumentStatus: string | null; forecastWeeks: number; rule: string };
  executive: {
    openAp: number; overdue: number; approvedPaymentRequests: number; unInvoicedCommitments: number; scheduledShortage: number;
    forecastInHorizon: number; executedPayments: number; supplierCount: number; highRiskSuppliers: number;
    competitiveSavingsVsMedian: number; boqProcurementVariance: number; boqProcurementVariancePct: number | null;
  };
  aging: Array<{ key: AgingBucketKey; label: string; amount: number; count: number; invoices: Array<{ id: string; supplierId: string; supplierName: string; invoiceNumber: string; dueDate: string | null; issueDate: string; currency: string; outstanding: number }> }>;
  cashForecast: {
    totalInHorizon: number;
    weeks: Array<{ weekIndex: number; startDate: string; endDate: string; amount: number; highConfidence: number; mediumConfidence: number; lowConfidence: number; items: ForecastItem[] }>;
    undated: ForecastItem[];
    outsideHorizon: ForecastItem[];
  };
  suppliers: SupplierExposure[];
  sourcing: {
    summary: { rfqCount: number; awardedRfqCount: number; invitationCount: number; responseCount: number; responseRatePct: number | null; averageSourcingDays: number | null; competitiveSavingsVsMedian: number; comparableRfqCount: number };
    rfqs: Array<{ rfqId: string; reference: string; title: string; awardedCost: number; comparableQuoteCount: number; lowestComparable: number | null; medianComparable: number | null; savingsVsMedian: number | null; savingsVsMedianPct: number | null; premiumVsLowest: number | null; premiumVsLowestPct: number | null; supplierCount: number; responseCount: number; sourcingDays: number | null }>;
  };
  boqVariance: {
    baselineForOrderedQty: number; orderedValue: number; variance: number; variancePct: number | null;
    materials: Array<{ materialId: string; materialName: string; unit: string; requiredQty: number; baselineValue: number; orderedQty: number; orderedValue: number; baselineUnitCost: number; baselineForOrderedQty: number; variance: number; variancePct: number | null; procurementCoveragePct: number }>;
  };
};

export type ForecastItem = {
  id: string; source: ForecastSource; confidence: ForecastConfidence; supplierId: string | null; supplierName: string | null; reference: string;
  amount: number; currency: string; forecastDate: string | null; dateBasis: string; scheduleTaskId?: string | null; scheduleTaskName?: string | null;
};

export type SupplierExposure = {
  supplierId: string; supplierName: string; committed: number; invoicedNet: number; paid: number; openAP: number; overdue: number; unInvoicedCommitment: number;
  concentrationPct: number; orderCount: number; invitationCount: number; responseRatePct: number | null; wins: number; winRatePct: number | null; onTimeRatePct: number | null;
  openNcrCount: number; risk: { score: number; level: "baixo" | "medio" | "alto"; flags: string[] };
};

export type SupplierStatement = {
  supplier: { id: string; name: string; nuit: string | null };
  projectId: string;
  currency: string;
  balance: number;
  rows: Array<{ id: string; date: string; kind: "factura" | "nota_credito" | "pagamento" | "compromisso"; reference: string; description: string; debit: number; credit: number; affectsBalance: boolean; balance: number }>;
};

export const procurementIntelligenceApi = {
  dashboard: (projectId: string, weeks = 12) => request<ProcurementIntelligenceDashboard>(`/projects/${projectId}/procurement-intelligence?weeks=${weeks}`),
  supplierStatement: (projectId: string, supplierId: string) => request<SupplierStatement>(`/projects/${projectId}/procurement-intelligence/suppliers/${supplierId}/statement`),
  cashForecastCsvUrl: (projectId: string, weeks = 12) => `/api/projects/${projectId}/procurement-intelligence/cash-forecast.csv?weeks=${weeks}`,
};
