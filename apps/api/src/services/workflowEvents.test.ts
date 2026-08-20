import { describe, expect, it, vi } from "vitest";
import {
  emitWorkflowEvent,
  selectWorkflowRecipients,
  userHasPermission,
  workflowEventCopy,
  type WorkflowCompanyUser,
  type WorkflowEventDeps,
} from "./workflowEvents.js";

function user(partial: Partial<WorkflowCompanyUser> & Pick<WorkflowCompanyUser, "id" | "role">): WorkflowCompanyUser {
  return {
    companyId: "co-1",
    name: partial.id,
    email: `${partial.id}@sigo.test`,
    permissions: [],
    isActive: true,
    ...partial,
  };
}

describe("workflowEvents — destinatários", () => {
  it("notifica quem pode aprovar e exclui o actor", () => {
    const recipients = selectWorkflowRecipients({
      event: "document.submitted",
      companyId: "co-1",
      actorId: "admin-a",
      companyUsers: [
        user({ id: "admin-a", role: "admin_empresa" }),
        user({ id: "admin-b", role: "admin_empresa" }),
        user({ id: "orc", role: "orcamentista" }),
        user({ id: "view", role: "visualizador" }),
        user({ id: "other-co", role: "admin_empresa", companyId: "co-2" }),
      ],
    });
    expect(recipients.map((row) => row.id)).toEqual(["admin-b"]);
  });

  it("na aprovação notifica só o submissor, nunca o actor", () => {
    const recipients = selectWorkflowRecipients({
      event: "document.approved",
      companyId: "co-1",
      actorId: "admin-a",
      submitterUserId: "orc",
      companyUsers: [
        user({ id: "admin-a", role: "admin_empresa" }),
        user({ id: "orc", role: "orcamentista" }),
      ],
    });
    expect(recipients.map((row) => row.id)).toEqual(["orc"]);
  });

  it("não notifica o submissor se for o próprio actor", () => {
    const recipients = selectWorkflowRecipients({
      event: "document.approved",
      companyId: "co-1",
      actorId: "orc",
      submitterUserId: "orc",
      companyUsers: [user({ id: "orc", role: "orcamentista" })],
    });
    expect(recipients).toEqual([]);
  });

  it("isola tenants mesmo com permissão equivalente noutra empresa", () => {
    const recipients = selectWorkflowRecipients({
      event: "requisition.submitted",
      companyId: "co-1",
      companyUsers: [
        user({ id: "a1", role: "admin_empresa" }),
        user({ id: "a2", role: "admin_empresa", companyId: "co-2" }),
      ],
    });
    expect(recipients.map((row) => row.id)).toEqual(["a1"]);
  });

  it("não duplica o mesmo destinatário", () => {
    const twin = user({ id: "admin-a", role: "admin_empresa" });
    const recipients = selectWorkflowRecipients({
      event: "certificate.submitted",
      companyId: "co-1",
      companyUsers: [twin, { ...twin }],
    });
    expect(recipients).toHaveLength(1);
  });

  it("usa permissão específica quando o utilizador não é admin", () => {
    expect(userHasPermission(user({ id: "fiscal", role: "engenheiro_fiscal" }), "diario.aprovar")).toBe(true);
    expect(userHasPermission(user({ id: "fiscal", role: "engenheiro_fiscal" }), "orcamentos.aprovar")).toBe(false);
    const recipients = selectWorkflowRecipients({
      event: "certificate.submitted",
      companyId: "co-1",
      companyUsers: [
        user({ id: "fiscal", role: "engenheiro_fiscal" }),
        user({ id: "view", role: "visualizador" }),
      ],
    });
    expect(recipients.map((row) => row.id)).toEqual(["fiscal"]);
  });
});

describe("workflowEvents — emissão", () => {
  function deps(overrides: Partial<WorkflowEventDeps> = {}): WorkflowEventDeps & { notified: string[][]; mailed: unknown[] } {
    const notified: string[][] = [];
    const mailed: unknown[] = [];
    return {
      listCompanyUsers: async () => [
        user({ id: "admin-a", role: "admin_empresa" }),
        user({ id: "admin-b", role: "admin_empresa" }),
        user({ id: "orc", role: "orcamentista" }),
      ],
      listSuperAdmins: async () => [user({ id: "root", role: "super_admin", companyId: "" })],
      notify: async (ids) => { notified.push(ids); },
      mail: async (payload) => { mailed.push(payload); return true; },
      publicUrl: "https://sud30s.org",
      ...overrides,
      notified,
      mailed,
    };
  }

  it("submissão cria in-app + email para aprovadores, sem o actor", async () => {
    const runtime = deps();
    await emitWorkflowEvent({
      event: "document.submitted",
      companyId: "co-1",
      entityId: "doc-1",
      title: "Orçamento T3",
      link: "/documentos/doc-1",
      actor: { id: "admin-a", name: "Ana", email: "admin-a@sigo.test" },
      reason: "Rever pilares do P1",
    }, runtime);
    expect(runtime.notified).toEqual([["admin-b"]]);
    expect(runtime.mailed).toHaveLength(1);
    const mail = runtime.mailed[0] as { to: string[]; subject: string; html: string };
    expect(mail.to).toEqual(["admin-b@sigo.test"]);
    expect(mail.subject).toContain("Orçamento T3");
    expect(mail.html).toContain("https://sud30s.org/documentos/doc-1");
    expect(workflowEventCopy("document.submitted", "Orçamento T3", "Rever pilares do P1").body).toContain("Rever pilares do P1");
  });

  it("submissão marca notificação com prioridade alta", async () => {
    const priorities: Array<"normal" | "high" | undefined> = [];
    const runtime = deps({
      notify: async (ids, _t, _b, _l, options) => {
        runtime.notified.push(ids);
        priorities.push(options?.priority);
      },
    });
    await emitWorkflowEvent({
      event: "document.submitted",
      companyId: "co-1",
      entityId: "doc-1",
      title: "Medição Rev. 02",
      link: "/documentos/doc-1",
      actor: { id: "orc", name: "Samuel", email: "orc@sigo.test" },
    }, runtime);
    expect(priorities).toEqual(["high"]);
  });

  it("devolução inclui o motivo e avisa o submissor", async () => {
    const runtime = deps();
    await emitWorkflowEvent({
      event: "document.returned",
      companyId: "co-1",
      entityId: "doc-1",
      title: "Medição",
      link: "/documentos/doc-1",
      actor: { id: "admin-a", name: "Ana", email: "admin-a@sigo.test" },
      submitterUserId: "orc",
      reason: "Faltam vigas do piso 1",
    }, runtime);
    expect(runtime.notified[0]).toEqual(["orc"]);
    expect(workflowEventCopy("document.returned", "Medição", "Faltam vigas do piso 1").body).toContain("Faltam vigas do piso 1");
  });

  it("falha do mailer não impede a notificação in-app", async () => {
    const runtime = deps({
      mail: async () => { throw new Error("SMTP down"); },
    });
    await expect(emitWorkflowEvent({
      event: "certificate.approved",
      companyId: "co-1",
      entityId: "auto-1",
      title: "n.º 3",
      link: "/autos/auto-1",
      actor: { id: "admin-a", name: "Ana", email: "admin-a@sigo.test" },
      submitterUserId: "orc",
    }, runtime)).resolves.toBeUndefined();
    expect(runtime.notified).toEqual([["orc"]]);
  });

  it("falha a listar destinatários não lança para fora", async () => {
    const runtime = deps({
      listCompanyUsers: async () => { throw new Error("db down"); },
    });
    await expect(emitWorkflowEvent({
      event: "plant.processed",
      companyId: "co-1",
      entityId: "plant-1",
      title: "Cortes.pdf",
      link: "/plantas/plant-1",
    }, runtime)).resolves.toBeUndefined();
  });
});
