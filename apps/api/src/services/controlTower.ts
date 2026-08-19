export type ControlAlertLevel = "critical" | "warning" | "info";

export type ControlActionCategory =
  | "safety_block"
  | "approval_finance"
  | "schedule_critical"
  | "material_risk"
  | "documentation"
  | "info";

export type ControlAlert = {
  code: string;
  level: ControlAlertLevel;
  title: string;
  detail: string;
  href: string;
};

const CODE_CATEGORY: Record<string, ControlActionCategory> = {
  stock_negative: "safety_block",
  budget_missing: "safety_block",
  contract_value_zero: "safety_block",
  cost_over_contract: "approval_finance",
  client_invoice_overdue: "approval_finance",
  supplier_invoice_overdue: "approval_finance",
  certificate_pending: "approval_finance",
  schedule_missing: "schedule_critical",
  schedule_delay: "schedule_critical",
  purchase_overdue: "material_risk",
  stock_exhausted: "material_risk",
  schedule_unlinked: "documentation",
  diary_stale: "documentation",
  client_invoice_draft: "documentation",
  stock_cost_estimated: "info",
  certified_unpaid: "info",
};

const CATEGORY_RANK: Record<ControlActionCategory, number> = {
  safety_block: 0,
  approval_finance: 1,
  schedule_critical: 2,
  material_risk: 3,
  documentation: 4,
  info: 5,
};

const LEVEL_RANK: Record<ControlAlertLevel, number> = { critical: 0, warning: 1, info: 2 };

export function controlActionCategory(code: string, level: ControlAlertLevel): ControlActionCategory {
  return CODE_CATEGORY[code] ?? (level === "critical" ? "safety_block" : level === "warning" ? "approval_finance" : "info");
}

export function rankControlActions<T extends ControlAlert>(alerts: T[]): T[] {
  return [...alerts].sort((a, b) => {
    const category = CATEGORY_RANK[controlActionCategory(a.code, a.level)] - CATEGORY_RANK[controlActionCategory(b.code, b.level)];
    if (category !== 0) return category;
    return LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
  });
}

export function pickNextAction<T extends ControlAlert>(alerts: T[], fallback: T): T {
  return rankControlActions(alerts)[0] ?? fallback;
}
