import { request } from "./http";

export type SupplierProcurementOpportunity = {
  id: string;
  reference: string;
  title: string;
  status: "rascunho" | "aberta" | "em_avaliacao" | "adjudicada" | "cancelada" | "expirada";
  invitationId: string;
  invitationStatus: "convidado" | "visualizado" | "respondido" | "recusado" | "expirado";
  companyName: string;
  projectName: string;
  supplierName: string;
  deadlineDate: string | null;
  requiredByDate: string | null;
  currency: string;
  allowPartialQuotes: boolean;
  allowPartialAward: boolean;
  createdAt: string;
};

export type SupplierProcurementOpportunityDetail = SupplierProcurementOpportunity & {
  message: string | null;
  deliveryLocation: string | null;
  paymentRequirements: string | null;
  commercialTerms: string | null;
  buyerName: string | null;
  lines: Array<{
    id: string;
    materialId: string;
    materialName: string;
    description: string;
    quantity: string;
    unit: string | null;
    specification: string | null;
    requiredByDate: string | null;
  }>;
  quoteVersions: Array<{
    id: string;
    version: number;
    status: "rascunho" | "submetida" | "substituida" | "retirada";
    submittedAt: string | null;
  }>;
};

export const supplierProcurementApi = {
  opportunities: () => request<SupplierProcurementOpportunity[]>("/supplier/procurement/rfqs"),
  opportunity: (id: string) => request<SupplierProcurementOpportunityDetail>(`/supplier/procurement/rfqs/${id}`),
  submitQuote: (id: string, data: {
    validUntil?: string | null;
    leadTimeDays?: number | null;
    paymentTerms?: string;
    transportIncluded?: boolean;
    transportCost?: number;
    supplierNotes?: string;
    lines: Array<{
      rfqLineId: string;
      available: boolean;
      quantityOffered: number;
      unitCost: number;
      discountPct?: number;
      brand?: string;
      leadTimeDays?: number | null;
      notes?: string;
    }>;
  }) => request<{ id: string; version: number; status: string }>(`/supplier/procurement/rfqs/${id}/quotes`, { method: "POST", body: JSON.stringify(data) }),
};
