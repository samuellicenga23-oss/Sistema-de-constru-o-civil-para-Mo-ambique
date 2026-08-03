import { useEffect, useMemo, useState, type FormEvent } from "react";
import { roleLabel, type CompanyUserRole, type PermissionDef } from "@sigo/shared";
import { usersApi, type CompanyUser, type PermissionCatalogResponse } from "../api/users";
import { useAuth } from "../auth/AuthContext";
import Modal from "./Modal";
import { IconKey, IconPlus, IconRefresh, IconUsers } from "./icons";
import { InlineNotice, SectionHeader } from "./WorkspaceUI";

const ROLE_INFO: Record<CompanyUserRole, { summary: string; badgeClass: string }> = {
  admin_empresa: {
    summary: "Empresa, subscrição, equipa e todos os módulos operacionais.",
    badgeClass: "bg-ink text-white",
  },
  orcamentista: {
    summary: "Catálogo, composições, orçamentos, cotações e preparação de compras.",
    badgeClass: "bg-brand-50 text-brand-800",
  },
  engenheiro_fiscal: {
    summary: "Cronograma, Diário de Obra, Autos, compras e validação da execução.",
    badgeClass: "bg-teal-50 text-teal-700",
  },
  visualizador: {
    summary: "Consulta de informação e relatórios, sem alterações operacionais.",
    badgeClass: "bg-slate-200 text-slate-700",
  },
};

type Drawer =
  | { type: "create" }
  | { type: "edit"; user: CompanyUser }
  | { type: "permissions"; user: CompanyUser }
  | { type: "password"; user: CompanyUser }
  | null;

function fmtAccess(iso: string | null) {
  if (!iso) return "Ainda não entrou";
  return new Date(iso).toLocaleString("pt-MZ", { dateStyle: "medium", timeStyle: "short" });
}

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function PermissionGrid({
  catalog,
  groups,
  selected,
  onChange,
  columnsClass,
}: {
  catalog: PermissionDef[];
  groups: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  columnsClass: string;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const items = catalog.filter((p) => p.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{group}</p>
            <div className={`grid gap-2 ${columnsClass}`}>
              {items.map((perm) => {
                const on = selected.has(perm.id);
                return (
                  <label
                    key={perm.id}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                      on ? "border-brand-200 bg-brand-50/70" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[#ed6c22]"
                      checked={on}
                      onChange={() => {
                        const next = new Set(selected);
                        if (on) next.delete(perm.id);
                        else next.add(perm.id);
                        onChange(next);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-900">{perm.label}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{perm.id}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TeamAccessPanel({
  maxUsers,
  onCountChange,
}: {
  maxUsers: number | null;
  onCountChange?: (count: number) => void;
}) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<CompanyUserRole | "todos">("todos");
  const [statusFilter, setStatusFilter] = useState<"todos" | "activos" | "inactivos">("todos");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateRole, setTemplateRole] = useState<CompanyUserRole>("orcamentista");
  const [templateSelected, setTemplateSelected] = useState<Set<string>>(new Set());
  const [userPermSelected, setUserPermSelected] = useState<Set<string>>(new Set());

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CompanyUserRole>("orcamentista");
  const [isActive, setIsActive] = useState(true);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [data, cat] = await Promise.all([usersApi.list(), usersApi.permissionCatalog()]);
      data.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "pt"));
      setUsers(data);
      setCatalog(cat);
      setTemplateSelected(new Set(cat.roleTemplates[templateRole] ?? []));
      onCountChange?.(data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a equipa");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!catalog) return;
    setTemplateSelected(new Set(catalog.roleTemplates[templateRole] ?? []));
  }, [templateRole, catalog]);

  const filtered = useMemo(
    () =>
      users.filter((member) => {
        const text = `${member.name} ${member.email}`.toLocaleLowerCase("pt");
        return (
          text.includes(query.toLocaleLowerCase("pt")) &&
          (roleFilter === "todos" || member.role === roleFilter) &&
          (statusFilter === "todos" || (statusFilter === "activos" ? member.isActive : !member.isActive))
        );
      }),
    [users, query, roleFilter, statusFilter],
  );

  const activeUsers = users.filter((m) => m.isActive).length;
  const atCapacity = Boolean(maxUsers && users.length >= maxUsers);

  function openCreate() {
    setName("");
    setEmail("");
    setPassword(generatePassword());
    setRole("orcamentista");
    setIsActive(true);
    setDrawer({ type: "create" });
  }

  function openEdit(member: CompanyUser) {
    setName(member.name);
    setRole(member.role);
    setIsActive(member.isActive);
    setDrawer({ type: "edit", user: member });
  }

  function openPermissions(member: CompanyUser) {
    setUserPermSelected(new Set(member.permissions ?? []));
    setDrawer({ type: "permissions", user: member });
  }

  async function saveCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await usersApi.create({ name, email, password, role });
      setDrawer(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o acesso");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!drawer || drawer.type !== "edit") return;
    setSaving(true);
    setError(null);
    try {
      await usersApi.update(drawer.user.id, { name, role, isActive });
      setDrawer(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível actualizar o acesso");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(member: CompanyUser) {
    if (member.id === currentUser?.id) return;
    setError(null);
    try {
      await usersApi.update(member.id, { isActive: !member.isActive });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível alterar o estado");
    }
  }

  async function saveUserPermissions() {
    if (!drawer || drawer.type !== "permissions") return;
    setSaving(true);
    setError(null);
    try {
      await usersApi.update(drawer.user.id, { permissions: [...userPermSelected] });
      setDrawer(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar permissões");
    } finally {
      setSaving(false);
    }
  }

  async function restoreUserPermissions() {
    if (!drawer || drawer.type !== "permissions") return;
    setSaving(true);
    setError(null);
    try {
      const updated = await usersApi.restorePermissions(drawer.user.id);
      setUserPermSelected(new Set(updated.permissions));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível restaurar o padrão");
    } finally {
      setSaving(false);
    }
  }

  async function saveRoleTemplate() {
    if (!catalog) return;
    setSaving(true);
    setError(null);
    try {
      const rolePermissions = { ...catalog.roleTemplates, [templateRole]: [...templateSelected] };
      const res = await usersApi.saveRolePermissions(rolePermissions);
      setCatalog({ ...catalog, roleTemplates: res.roleTemplates });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o template");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    try {
      await usersApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a conta");
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!drawer || drawer.type !== "password") return;
    setSaving(true);
    setError(null);
    try {
      await usersApi.resetPassword(drawer.user.id, password);
      setDrawer(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível redefinir a palavra-passe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <InlineNotice tone="danger">{error}</InlineNotice>}

      <section className="card overflow-hidden">
        <SectionHeader
          title="Utilizadores"
          description="Listagem leve — criar e editar abrem no painel lateral. Permissões padrão por função e ajuste fino por conta."
          actions={
            atCapacity ? (
              <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Plano cheio ({users.length}/{maxUsers})
              </span>
            ) : (
              <button onClick={openCreate} className="btn btn-primary btn-sm">
                <IconPlus className="h-4 w-4" /> Novo utilizador
              </button>
            )
          }
        />

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 text-sm">
          <span>
            <strong className="text-slate-900">{maxUsers ? `${users.length}/${maxUsers}` : users.length}</strong>{" "}
            <span className="text-slate-500">na equipa</span>
          </span>
          <span>
            <strong className="text-emerald-700">{activeUsers}</strong> <span className="text-slate-500">activos</span>
          </span>
        </div>

        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_190px_150px_auto]">
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Procurar por nome ou email" />
          <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as CompanyUserRole | "todos")}>
            <option value="todos">Todos os perfis</option>
            {(Object.keys(ROLE_INFO) as CompanyUserRole[]).map((key) => (
              <option key={key} value={key}>
                {roleLabel(key)}
              </option>
            ))}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="todos">Todos os estados</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Desactivados</option>
          </select>
          <button onClick={reload} className="btn btn-secondary" type="button">
            <IconRefresh className="h-4 w-4" /> Actualizar
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {loading && <div className="p-8 text-center text-sm text-slate-500">A carregar a equipa…</div>}
          {!loading &&
            filtered.map((member) => (
              <div
                key={member.id}
                className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${!member.isActive ? "bg-slate-50/70" : ""}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      member.isActive ? "bg-brand-100 text-brand-800" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {initials(member.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <span className="truncate">{member.name}</span>
                      {member.id === currentUser?.id && <span className="badge badge-brand">Você</span>}
                      <span className={`badge ${ROLE_INFO[member.role].badgeClass}`}>{roleLabel(member.role)}</span>
                      <span className={`badge ${member.isActive ? "badge-green" : "badge-gray"}`}>
                        {member.isActive ? "Activo" : "Inactivo"}
                      </span>
                      <span className="badge badge-gray">{member.permissionCount ?? member.permissions?.length ?? 0} perm.</span>
                    </p>
                    <p className="truncate text-xs text-slate-500">{member.email}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{fmtAccess(member.lastLoginAt)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      className="accent-[#ed6c22]"
                      checked={member.isActive}
                      disabled={member.id === currentUser?.id}
                      onChange={() => toggleActive(member)}
                    />
                    Activo
                  </label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPermissions(member)}>
                    Permissões
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(member)}>
                    Editar
                  </button>
                  {member.id !== currentUser?.id && (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Redefinir palavra-passe"
                        onClick={() => {
                          setPassword(generatePassword());
                          setDrawer({ type: "password", user: member });
                        }}
                      >
                        <IconKey className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(member)}>
                        Remover
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          {!loading && filtered.length === 0 && (
            <div className="p-10 text-center">
              <IconUsers className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold">Nenhum utilizador corresponde aos filtros.</p>
            </div>
          )}
        </div>
      </section>

      {catalog && (
        <section className="card overflow-hidden">
          <SectionHeader
            title="Permissões por função"
            description="Altera o template da função. Novos utilizadores herdam este pacote; contas com ajuste fino mantêm o seu até restaurar."
            actions={
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={saveRoleTemplate}>
                {saving ? "A guardar…" : "Guardar template"}
              </button>
            }
          />
          <div className="border-b border-slate-200 px-5 py-4">
            <label className="label">Função</label>
            <select className="input max-w-sm" value={templateRole} onChange={(e) => setTemplateRole(e.target.value as CompanyUserRole)}>
              {(Object.keys(ROLE_INFO) as CompanyUserRole[]).map((key) => (
                <option key={key} value={key}>
                  {roleLabel(key)}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">{ROLE_INFO[templateRole].summary}</p>
          </div>
          <div className="p-5">
            <PermissionGrid
              catalog={catalog.catalog}
              groups={catalog.groups}
              selected={templateSelected}
              onChange={setTemplateSelected}
              columnsClass="sm:grid-cols-2 xl:grid-cols-3"
            />
          </div>
        </section>
      )}

      {/* Right drawer */}
      {drawer && drawer.type !== "password" && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Fechar" onClick={() => setDrawer(null)} />
          <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-raised sm:max-w-lg">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">
                  {drawer.type === "create" && "Novo utilizador"}
                  {drawer.type === "edit" && "Editar utilizador"}
                  {drawer.type === "permissions" && `Permissões — ${drawer.user.name}`}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {drawer.type === "create" && "A credencial temporária deve ser alterada no primeiro acesso."}
                  {drawer.type === "edit" && drawer.user.email}
                  {drawer.type === "permissions" && "Ajuste fino só desta conta — não altera o template da função."}
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setDrawer(null)}>
                ×
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              {(drawer.type === "create" || drawer.type === "edit") && (
                <form
                  id="user-drawer-form"
                  onSubmit={drawer.type === "create" ? saveCreate : saveEdit}
                  className="space-y-4"
                >
                  <div>
                    <label className="label">Nome completo</label>
                    <input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  {drawer.type === "create" && (
                    <div>
                      <label className="label">Email</label>
                      <input className="input" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                  )}
                  <div>
                    <label className="label">Função</label>
                    <select
                      className="input"
                      value={role}
                      disabled={drawer.type === "edit" && drawer.user.id === currentUser?.id}
                      onChange={(e) => setRole(e.target.value as CompanyUserRole)}
                    >
                      {(Object.keys(ROLE_INFO) as CompanyUserRole[]).map((key) => (
                        <option key={key} value={key}>
                          {roleLabel(key)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">{ROLE_INFO[role].summary}</p>
                  </div>
                  {drawer.type === "create" && (
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="label">Palavra-passe temporária</label>
                        <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => setPassword(generatePassword())}>
                          Gerar outra
                        </button>
                      </div>
                      <input className="input font-mono" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                    </div>
                  )}
                  {drawer.type === "edit" && (
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                      <input
                        type="checkbox"
                        className="mt-1 accent-[#ed6c22]"
                        checked={isActive}
                        disabled={drawer.user.id === currentUser?.id}
                        onChange={(e) => setIsActive(e.target.checked)}
                      />
                      <span>
                        <strong className="block text-sm">Acesso activo</strong>
                        <small className="text-xs text-slate-500">Desactivar termina todas as sessões; o histórico da obra permanece.</small>
                      </span>
                    </label>
                  )}
                </form>
              )}

              {drawer.type === "permissions" && catalog && (
                <PermissionGrid
                  catalog={catalog.catalog}
                  groups={catalog.groups}
                  selected={userPermSelected}
                  onChange={setUserPermSelected}
                  columnsClass="sm:grid-cols-2"
                />
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
              {drawer.type === "permissions" ? (
                <>
                  <button type="button" className="btn btn-secondary" disabled={saving} onClick={restoreUserPermissions}>
                    Restaurar padrão da função
                  </button>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={saveUserPermissions}>
                    {saving ? "A guardar…" : "Concluído"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => setDrawer(null)}>
                    Cancelar
                  </button>
                  <button type="submit" form="user-drawer-form" className="btn btn-primary" disabled={saving}>
                    {saving ? "A guardar…" : drawer.type === "create" ? "Criar acesso" : "Guardar"}
                  </button>
                </>
              )}
            </footer>
          </aside>
        </div>
      )}

      {drawer?.type === "password" && (
        <Modal title="Redefinir palavra-passe" subtitle={`O acesso de ${drawer.user.name} será terminado em todos os dispositivos.`} onClose={() => setDrawer(null)}>
          <form onSubmit={savePassword} className="space-y-4">
            <InlineNotice>Depois de entrar, o utilizador terá de escolher uma nova palavra-passe.</InlineNotice>
            <div>
              <div className="flex items-center justify-between">
                <label className="label">Nova palavra-passe temporária</label>
                <button type="button" onClick={() => setPassword(generatePassword())} className="text-xs font-semibold text-brand-700">
                  Gerar outra
                </button>
              </div>
              <input className="input font-mono" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDrawer(null)} className="btn btn-secondary">
                Cancelar
              </button>
              <button disabled={saving} className="btn btn-primary">
                {saving ? "A redefinir…" : "Redefinir acesso"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Remover conta" subtitle={deleteTarget.email} onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-slate-600">
            Remover <strong>{deleteTarget.name}</strong>? Só é possível se a conta nunca tiver entrado. Caso contrário, desactive o acesso.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" disabled={saving} onClick={confirmDelete}>
              {saving ? "A remover…" : "Remover definitivamente"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
