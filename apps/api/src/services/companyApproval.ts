import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { companies, users } from "../db/schema.js";
import { canApproveWithMatrix, DEFAULT_APPROVAL_MATRIX, type ApprovalEntityType, type ApprovalRule } from "./approvalMatrix.js";

export async function loadCompanyApprovalRules(companyId: string): Promise<ApprovalRule[]> {
  const [company] = await db.select({ approvalMatrix: companies.approvalMatrix }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return (company?.approvalMatrix?.length ? company.approvalMatrix : DEFAULT_APPROVAL_MATRIX) as ApprovalRule[];
}

export async function countActiveAdmins(companyId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  return rows.length;
}

export async function assertMatrixApproval(args: {
  companyId: string;
  entityType: ApprovalEntityType;
  role: string;
  permissions?: string[] | null;
  isSubmitter: boolean;
  amount?: number;
}): Promise<{ ok: true } | { ok: false; status: 403 | 409; error: string }> {
  const [rules, adminCount] = await Promise.all([
    loadCompanyApprovalRules(args.companyId),
    countActiveAdmins(args.companyId),
  ]);
  const decision = canApproveWithMatrix({
    entityType: args.entityType,
    role: args.role,
    permissions: args.permissions ?? [],
    isSubmitter: args.isSubmitter,
    adminCount,
    amount: args.amount,
    rules,
  });
  if (!decision.allowed) {
    return {
      ok: false,
      status: decision.reason?.includes("submeteu") || decision.reason?.includes("Quem submeteu") ? 409 : 403,
      error: decision.reason ?? "Sem autoridade de aprovação",
    };
  }
  return { ok: true };
}
