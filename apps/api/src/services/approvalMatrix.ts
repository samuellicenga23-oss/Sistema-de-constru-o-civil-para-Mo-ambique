export type ApprovalEntityType = "medicao" | "auto" | "requisicao" | "payment_request";

export type ApprovalRule = {
  entityType: ApprovalEntityType;
  submitRoles: string[];
  approveRoles: string[];
  submitPermission: string | null;
  approvePermission: string | null;
  singleAdminException: boolean;
  currency: "MZN" | "USD" | null;
  thresholdMin: number | null;
  thresholdMax: number | null;
  sequence: number;
};

/** Defaults alinhados com as rotas actuais — a UI não é autoridade. */
export const DEFAULT_APPROVAL_MATRIX: ApprovalRule[] = [
  {
    entityType: "medicao",
    submitRoles: ["admin_empresa", "orcamentista"],
    approveRoles: ["admin_empresa"],
    submitPermission: null,
    approvePermission: null,
    singleAdminException: true,
    currency: null,
    thresholdMin: null,
    thresholdMax: null,
    sequence: 1,
  },
  {
    entityType: "auto",
    submitRoles: ["admin_empresa", "engenheiro_fiscal"],
    approveRoles: ["admin_empresa"],
    submitPermission: null,
    approvePermission: null,
    singleAdminException: true,
    currency: null,
    thresholdMin: null,
    thresholdMax: null,
    sequence: 1,
  },
  {
    entityType: "requisicao",
    submitRoles: ["admin_empresa", "orcamentista", "engenheiro_fiscal"],
    approveRoles: ["admin_empresa"],
    submitPermission: "materiais.requisitar",
    approvePermission: "materiais.aprovar",
    singleAdminException: false,
    currency: null,
    thresholdMin: null,
    thresholdMax: null,
    sequence: 1,
  },
  {
    entityType: "payment_request",
    submitRoles: ["admin_empresa"],
    approveRoles: ["admin_empresa"],
    submitPermission: null,
    approvePermission: null,
    singleAdminException: true,
    currency: null,
    thresholdMin: null,
    thresholdMax: null,
    sequence: 1,
  },
];

export function approvalRulesFor(entityType: ApprovalEntityType, rules = DEFAULT_APPROVAL_MATRIX): ApprovalRule[] {
  return rules.filter((rule) => rule.entityType === entityType && rule.sequence >= 1);
}

export function canApproveWithMatrix(args: {
  entityType: ApprovalEntityType;
  role: string;
  permissions?: string[];
  isSubmitter: boolean;
  adminCount: number;
  amount?: number;
  currency?: string;
  rules?: ApprovalRule[];
}): { allowed: boolean; reason: string | null } {
  const rules = approvalRulesFor(args.entityType, args.rules);
  const rule = rules[0];
  if (!rule) return { allowed: false, reason: "Sem regra de aprovação" };
  if (args.amount != null && rule.thresholdMin != null && args.amount < rule.thresholdMin) {
    return { allowed: true, reason: null };
  }
  if (args.amount != null && rule.thresholdMax != null && args.amount > rule.thresholdMax) {
    return { allowed: false, reason: "Acima do limiar desta regra" };
  }
  if (rule.approvePermission && !(args.permissions ?? []).includes(rule.approvePermission)) {
    return { allowed: false, reason: "Sem permissão de aprovação" };
  }
  if (!rule.approveRoles.includes(args.role)) {
    return { allowed: false, reason: "Função sem autoridade de aprovação" };
  }
  if (args.isSubmitter && rule.singleAdminException && args.adminCount > 1) {
    return { allowed: false, reason: "Quem submeteu não pode aprovar" };
  }
  return { allowed: true, reason: null };
}
