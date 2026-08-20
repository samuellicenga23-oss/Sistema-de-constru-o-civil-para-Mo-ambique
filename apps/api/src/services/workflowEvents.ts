import { and, eq } from "drizzle-orm";
import { isCompanyUserRole, resolveRoleTemplate } from "@sigo/shared";
import { db } from "../db/index.js";
import { companies, users } from "../db/schema.js";
import { env } from "../env.js";
import { emailLayout, escapeHtml, sendEmail } from "./mailer.js";
import { notifyUsers } from "./notifications.js";

export type WorkflowEvent =
  | "document.submitted"
  | "document.approved"
  | "document.returned"
  | "certificate.submitted"
  | "certificate.approved"
  | "certificate.returned"
  | "requisition.submitted"
  | "requisition.approved"
  | "requisition.returned"
  | "payment_request.submitted"
  | "payment_request.approved"
  | "payment_request.rejected"
  | "plant.processed"
  | "plant.review_required";

export type WorkflowActor = {
  id: string;
  name: string;
  email: string;
};

export type WorkflowCompanyUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  isActive: boolean;
};

export type WorkflowEventInput = {
  event: WorkflowEvent;
  companyId: string;
  entityId: string;
  title: string;
  link: string;
  actor?: WorkflowActor | null;
  submitterUserId?: string | null;
  reason?: string | null;
  logger?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
};

export type WorkflowEventCopy = {
  title: string;
  body: string;
  emailSubject: string;
  ctaLabel: string;
};

type RecipientMode = "approvers" | "submitter" | "operators" | "super_admins";

const EVENT_POLICY: Record<WorkflowEvent, { permission?: string; recipients: RecipientMode }> = {
  "document.submitted": { permission: "orcamentos.aprovar", recipients: "approvers" },
  "document.approved": { recipients: "submitter" },
  "document.returned": { recipients: "submitter" },
  "certificate.submitted": { permission: "diario.aprovar", recipients: "approvers" },
  "certificate.approved": { recipients: "submitter" },
  "certificate.returned": { recipients: "submitter" },
  "requisition.submitted": { permission: "materiais.aprovar", recipients: "approvers" },
  "requisition.approved": { recipients: "submitter" },
  "requisition.returned": { recipients: "submitter" },
  "payment_request.submitted": { permission: "materiais.aprovar", recipients: "approvers" },
  "payment_request.approved": { recipients: "submitter" },
  "payment_request.rejected": { recipients: "submitter" },
  "plant.processed": { permission: "medicoes.editar", recipients: "operators" },
  "plant.review_required": { recipients: "super_admins" },
};

export function workflowEventCopy(event: WorkflowEvent, title: string, reason?: string | null): WorkflowEventCopy {
  const label = title.trim() || "Registo";
  const note = reason?.trim() ? ` Motivo: ${reason.trim()}.` : "";
  const catalog: Record<WorkflowEvent, WorkflowEventCopy> = {
    "document.submitted": {
      title: "Documento para aprovação",
      body: `«${label}» foi submetido.${reason?.trim() ? ` Observação: ${reason.trim()}` : ""}`,
      emailSubject: `SIGO — «${label}» para aprovação`,
      ctaLabel: "Rever documento",
    },
    "document.approved": {
      title: "Documento aprovado",
      body: `«${label}» foi aprovado.`,
      emailSubject: `SIGO — «${label}» aprovado`,
      ctaLabel: "Ver documento",
    },
    "document.returned": {
      title: "Documento devolvido",
      body: `«${label}» foi devolvido.${note}`,
      emailSubject: `SIGO — «${label}» devolvido`,
      ctaLabel: "Abrir documento",
    },
    "certificate.submitted": {
      title: "Auto para fiscalização",
      body: `Auto «${label}» foi submetido.`,
      emailSubject: `SIGO — Auto «${label}» pendente`,
      ctaLabel: "Rever auto",
    },
    "certificate.approved": {
      title: "Auto aprovado",
      body: `Auto «${label}» foi aprovado.`,
      emailSubject: `SIGO — Auto «${label}» aprovado`,
      ctaLabel: "Ver auto",
    },
    "certificate.returned": {
      title: "Auto devolvido",
      body: `Auto «${label}» foi devolvido.${note}`,
      emailSubject: `SIGO — Auto «${label}» devolvido`,
      ctaLabel: "Abrir auto",
    },
    "requisition.submitted": {
      title: "Requisição para aprovação",
      body: `«${label}» aguarda aprovação.`,
      emailSubject: `SIGO — «${label}» pendente de aprovação`,
      ctaLabel: "Rever compras",
    },
    "requisition.approved": {
      title: "Requisição aprovada",
      body: `«${label}» foi aprovada.`,
      emailSubject: `SIGO — «${label}» aprovada`,
      ctaLabel: "Ver compras",
    },
    "requisition.returned": {
      title: "Requisição devolvida",
      body: `«${label}» foi devolvida.${note}`,
      emailSubject: `SIGO — «${label}» devolvida`,
      ctaLabel: "Abrir compras",
    },
    "payment_request.submitted": {
      title: "Pagamento para aprovação",
      body: `Pedido «${label}» foi submetido.`,
      emailSubject: `SIGO — pagamento «${label}» pendente`,
      ctaLabel: "Rever pagamento",
    },
    "payment_request.approved": {
      title: "Pagamento aprovado",
      body: `Pedido «${label}» foi aprovado.`,
      emailSubject: `SIGO — pagamento «${label}» aprovado`,
      ctaLabel: "Ver pagamento",
    },
    "payment_request.rejected": {
      title: "Pagamento rejeitado",
      body: `Pedido «${label}» foi rejeitado.${note}`,
      emailSubject: `SIGO — pagamento «${label}» rejeitado`,
      ctaLabel: "Ver pagamento",
    },
    "plant.processed": {
      title: "Planta pronta",
      body: `«${label}» está disponível para revisão.`,
      emailSubject: `SIGO — planta «${label}» pronta`,
      ctaLabel: "Abrir planta",
    },
    "plant.review_required": {
      title: "Planta para rever",
      body: `«${label}» precisa de revisão do motor.`,
      emailSubject: `SIGO — rever motor de plantas: ${label}`,
      ctaLabel: "Abrir painel admin",
    },
  };
  return catalog[event];
}

export function effectivePermissions(user: Pick<WorkflowCompanyUser, "role" | "permissions">): string[] {
  if (user.permissions.length > 0) return user.permissions;
  if (isCompanyUserRole(user.role)) return resolveRoleTemplate(user.role);
  return [];
}

export function userHasPermission(user: Pick<WorkflowCompanyUser, "role" | "permissions">, permission: string): boolean {
  if (user.role === "admin_empresa" || user.role === "super_admin") return true;
  return effectivePermissions(user).includes(permission);
}

export function selectWorkflowRecipients(input: {
  event: WorkflowEvent;
  companyId: string;
  actorId?: string | null;
  submitterUserId?: string | null;
  companyUsers: WorkflowCompanyUser[];
  superAdmins?: WorkflowCompanyUser[];
}): WorkflowCompanyUser[] {
  const policy = EVENT_POLICY[input.event];
  const seen = new Set<string>();
  const out: WorkflowCompanyUser[] = [];

  const push = (user: WorkflowCompanyUser | undefined) => {
    if (!user || !user.isActive || seen.has(user.id)) return;
    if (input.actorId && user.id === input.actorId) return;
    if (user.companyId && user.companyId !== input.companyId && policy.recipients !== "super_admins") return;
    seen.add(user.id);
    out.push(user);
  };

  if (policy.recipients === "super_admins") {
    for (const user of input.superAdmins ?? []) push(user);
    return out;
  }

  if (policy.recipients === "submitter") {
    push(input.companyUsers.find((user) => user.id === input.submitterUserId));
    return out;
  }

  const permission = policy.permission;
  for (const user of input.companyUsers) {
    if (user.companyId !== input.companyId) continue;
    if (permission && !userHasPermission(user, permission)) continue;
    push(user);
  }
  return out;
}

export type WorkflowEventDeps = {
  listCompanyUsers: (companyId: string) => Promise<WorkflowCompanyUser[]>;
  listSuperAdmins: () => Promise<WorkflowCompanyUser[]>;
  notify: (
    userIds: string[],
    title: string,
    body: string,
    link?: string,
    options?: { priority?: "normal" | "high" },
  ) => Promise<void>;
  mail: (input: { to: string | string[]; subject: string; html: string }, logger?: WorkflowEventInput["logger"]) => Promise<boolean>;
  publicUrl: string;
  emailWorkflowEnabled?: (companyId: string) => Promise<boolean>;
};

const defaultDeps: WorkflowEventDeps = {
  listCompanyUsers: loadCompanyUsers,
  listSuperAdmins: loadSuperAdmins,
  notify: notifyUsers,
  mail: sendEmail,
  publicUrl: env.publicUrl,
  emailWorkflowEnabled: async (companyId: string) => {
    const [company] = await db.select({ prefs: companies.emailNotificationPrefs }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return company?.prefs?.workflow !== false;
  },
};

async function loadCompanyUsers(companyId: string): Promise<WorkflowCompanyUser[]> {
  const rows = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      name: users.name,
      email: users.email,
      role: users.role,
      permissions: users.permissions,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.isActive, true)));
  return rows.map((row) => ({
    ...row,
    companyId: row.companyId ?? companyId,
    permissions: row.permissions ?? [],
  }));
}

async function loadSuperAdmins(): Promise<WorkflowCompanyUser[]> {
  const rows = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      name: users.name,
      email: users.email,
      role: users.role,
      permissions: users.permissions,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
  return rows.map((row) => ({
    ...row,
    companyId: row.companyId ?? "",
    permissions: row.permissions ?? [],
  }));
}

export async function emitWorkflowEvent(input: WorkflowEventInput, deps: WorkflowEventDeps = defaultDeps): Promise<void> {
  try {
    const [companyUsers, superAdmins] = await Promise.all([
      deps.listCompanyUsers(input.companyId),
      EVENT_POLICY[input.event].recipients === "super_admins" ? deps.listSuperAdmins() : Promise.resolve([]),
    ]);
    const recipients = selectWorkflowRecipients({
      event: input.event,
      companyId: input.companyId,
      actorId: input.actor?.id,
      submitterUserId: input.submitterUserId,
      companyUsers,
      superAdmins,
    });
    if (!recipients.length) return;

    const copy = workflowEventCopy(input.event, input.title, input.reason);
    const highPriority =
      input.event === "document.submitted" ||
      input.event === "certificate.submitted" ||
      input.event === "requisition.submitted" ||
      input.event === "payment_request.submitted" ||
      input.event === "document.approved" ||
      input.event === "document.returned" ||
      input.event === "certificate.approved" ||
      input.event === "certificate.returned" ||
      input.event === "requisition.approved" ||
      input.event === "requisition.returned" ||
      input.event === "payment_request.approved" ||
      input.event === "payment_request.rejected";
    await deps.notify(recipients.map((user) => user.id), copy.title, copy.body, input.link, {
      priority: highPriority ? "high" : "normal",
    });

    const emailOn = await (deps.emailWorkflowEnabled ?? (async () => true))(input.companyId);
    if (!emailOn) return;

    const emails = [...new Set(recipients.map((user) => user.email).filter(Boolean))];
    if (!emails.length) return;
    const href = input.link.startsWith("http") ? input.link : `${deps.publicUrl}${input.link}`;
    try {
      await deps.mail(
        {
          to: emails,
          subject: copy.emailSubject,
          html: emailLayout(copy.title, `<p>${escapeHtml(copy.body)}</p>`, href, copy.ctaLabel),
        },
        input.logger,
      );
    } catch (error) {
      input.logger?.error({ error, event: input.event, entityId: input.entityId }, "Falha de email no evento de workflow");
    }
  } catch (error) {
    input.logger?.error({ error, event: input.event, entityId: input.entityId }, "Falha ao emitir evento de workflow");
  }
}
