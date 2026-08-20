import { useEffect, useState } from "react";
import {
  PROJECT_ROLE_LABELS,
  PROJECT_WORKFLOW_LABELS,
  projectTeamApi,
  type ProjectApprovalRoute,
  type ProjectMember,
  type ProjectRole,
  type ProjectWorkflowType,
} from "../api/projectTeam";
import { usersApi, type CompanyUser } from "../api/users";

const WORKFLOWS = Object.keys(PROJECT_WORKFLOW_LABELS) as ProjectWorkflowType[];
const ROLES = Object.keys(PROJECT_ROLE_LABELS) as ProjectRole[];

export default function ProjectTeamApprovalsPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<"equipa" | "aprovacoes">("equipa");
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [routes, setRoutes] = useState<ProjectApprovalRoute[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("supervisor");
  const [editType, setEditType] = useState<ProjectWorkflowType | null>(null);
  const [editMode, setEditMode] = useState<"any" | "all" | "sequential">("any");
  const [editUserIds, setEditUserIds] = useState<string[]>([]);
  const [sourceProjectId, setSourceProjectId] = useState("");

  async function reload() {
    const [m, r, u] = await Promise.all([
      projectTeamApi.listMembers(projectId),
      projectTeamApi.listRoutes(projectId),
      usersApi.list(),
    ]);
    setMembers(m.items);
    setRoutes(r.items);
    setCompanyUsers(u.filter((user) => user.isActive));
  }

  useEffect(() => {
    void reload().catch((err) => setError(err instanceof Error ? err.message : "Erro"));
  }, [projectId]);

  async function addMember() {
    if (!addUserId) return;
    setBusy(true);
    setError(null);
    try {
      await projectTeamApi.addMember(projectId, { userId: addUserId, projectRole: addRole });
      setAddUserId("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id: string) {
    setBusy(true);
    try {
      await projectTeamApi.removeMember(projectId, id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(type: ProjectWorkflowType) {
    const existing = routes.find((r) => r.workflowType === type);
    setEditType(type);
    setEditMode(existing?.approvalMode ?? "any");
    setEditUserIds(existing?.steps.flatMap((s) => s.users.map((u) => u!.id)) ?? []);
  }

  async function saveRoute() {
    if (!editType || !editUserIds.length) return;
    setBusy(true);
    setError(null);
    try {
      const steps =
        editMode === "sequential"
          ? editUserIds.map((userId, index) => ({ stepOrder: index + 1, userIds: [userId] }))
          : [{ stepOrder: 1, userIds: editUserIds }];
      await projectTeamApi.saveRoute(projectId, {
        workflowType: editType,
        approvalMode: editMode,
        isActive: true,
        steps,
      });
      setEditType(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar");
    } finally {
      setBusy(false);
    }
  }

  async function cloneFrom() {
    if (!sourceProjectId) return;
    setBusy(true);
    try {
      await projectTeamApi.cloneTeam(projectId, sourceProjectId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao copiar");
    } finally {
      setBusy(false);
    }
  }

  const memberUserIds = new Set(members.map((m) => m.userId));

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <button type="button" className={`btn btn-sm ${tab === "equipa" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("equipa")}>
          Equipa
        </button>
        <button type="button" className={`btn btn-sm ${tab === "aprovacoes" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("aprovacoes")}>
          Aprovações
        </button>
      </div>

      {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}

      {tab === "equipa" && (
        <div className="space-y-4 px-4 py-4">
          <ul className="divide-y divide-slate-100">
            {members.length === 0 && <li className="py-4 text-sm text-slate-500">Nenhuma pessoa na equipa desta obra.</li>}
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{m.userName}</p>
                  <p className="text-xs text-slate-500">{PROJECT_ROLE_LABELS[m.projectRole as ProjectRole] ?? m.projectRole}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm text-red-700" disabled={busy} onClick={() => void removeMember(m.id)}>
                  Remover
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="min-w-[10rem] flex-1 text-xs font-semibold text-slate-600">
              Pessoa
              <select className="input input-sm mt-1 w-full" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
                <option value="">Escolher…</option>
                {companyUsers
                  .filter((u) => !memberUserIds.has(u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="min-w-[9rem] text-xs font-semibold text-slate-600">
              Função
              <select className="input input-sm mt-1 w-full" value={addRole} onChange={(e) => setAddRole(e.target.value as ProjectRole)}>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {PROJECT_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !addUserId} onClick={() => void addMember()}>
              Adicionar
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
              Copiar de outra obra (UUID)
              <input className="input input-sm mt-1 w-full" value={sourceProjectId} onChange={(e) => setSourceProjectId(e.target.value)} placeholder="ID do projecto origem" />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !sourceProjectId} onClick={() => void cloneFrom()}>
              Copiar equipa e aprovações
            </button>
          </div>
        </div>
      )}

      {tab === "aprovacoes" && (
        <div className="space-y-3 px-4 py-4">
          {WORKFLOWS.map((type) => {
            const route = routes.find((r) => r.workflowType === type && r.isActive);
            const names =
              route?.steps
                .flatMap((s) => s.users.map((u) => u?.name))
                .filter(Boolean)
                .join(route.approvalMode === "sequential" ? " → " : ", ") || "— (fallback empresa)";
            return (
              <div key={type} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{PROJECT_WORKFLOW_LABELS[type]}</p>
                  <p className="text-xs text-slate-500">{names}</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => beginEdit(type)}>
                  Configurar
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setEditType(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-950">{PROJECT_WORKFLOW_LABELS[editType]}</h3>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Modo
              <select className="input mt-1 w-full" value={editMode} onChange={(e) => setEditMode(e.target.value as typeof editMode)}>
                <option value="any">Qualquer aprovador</option>
                <option value="all">Todos devem aprovar</option>
                <option value="sequential">Sequencial</option>
              </select>
            </label>
            <p className="mt-3 text-xs font-semibold text-slate-600">Aprovadores</p>
            <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
              {(members.length ? members : companyUsers.map((u) => ({ userId: u.id, userName: u.name }))).map((u) => {
                const id = "userId" in u ? u.userId : (u as CompanyUser).id;
                const name = "userName" in u ? u.userName : (u as CompanyUser).name;
                const checked = editUserIds.includes(id);
                return (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setEditUserIds((prev) => (checked ? prev.filter((x) => x !== id) : [...prev, id]))
                        }
                      />
                      {name}
                    </label>
                  </li>
                );
              })}
            </ul>
            {editMode === "sequential" && editUserIds.length > 1 && (
              <p className="mt-2 text-[11px] text-slate-500">Ordem = ordem de selecção (1.º marcado actua primeiro).</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditType(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !editUserIds.length} onClick={() => void saveRoute()}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
