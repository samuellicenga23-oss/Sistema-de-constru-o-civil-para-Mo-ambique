import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usersApi, type CompanyUser, type CompanyUserRole } from "../api/users";
import { useAuth } from "../auth/AuthContext";
import Modal from "./Modal";
import { IconKey, IconPlus, IconRefresh, IconUsers } from "./icons";
import { InlineNotice, SectionHeader } from "./WorkspaceUI";

const ROLE_INFO: Record<CompanyUserRole, { label: string; summary: string; badgeClass: string }> = {
  admin_empresa: { label: "Administrador", summary: "Empresa, subscrição, equipa e todos os módulos operacionais.", badgeClass: "bg-[#142033] text-white" },
  orcamentista: { label: "Orçamentista", summary: "Catálogo, composições, orçamentos, cotações e preparação de compras.", badgeClass: "bg-blue-100 text-blue-800" },
  engenheiro_fiscal: { label: "Engenheiro / Fiscal", summary: "Cronograma, Diário de Obra, Autos, compras e validação da execução.", badgeClass: "bg-teal-100 text-teal-800" },
  visualizador: { label: "Visualizador", summary: "Consulta de informação e relatórios, sem alterações operacionais.", badgeClass: "bg-slate-200 text-slate-700" },
};

type Dialog =
  | { type: "create" }
  | { type: "edit"; user: CompanyUser }
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

export default function TeamAccessPanel({ maxUsers, onCountChange }: { maxUsers: number | null; onCountChange?: (count: number) => void }) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<CompanyUserRole | "todos">("todos");
  const [statusFilter, setStatusFilter] = useState<"todos" | "activos" | "inactivos">("todos");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CompanyUserRole>("orcamentista");
  const [isActive, setIsActive] = useState(true);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const data = await usersApi.list();
      data.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "pt"));
      setUsers(data);
      onCountChange?.(data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a equipa");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => users.filter((member) => {
    const text = `${member.name} ${member.email}`.toLocaleLowerCase("pt");
    return text.includes(query.toLocaleLowerCase("pt"))
      && (roleFilter === "todos" || member.role === roleFilter)
      && (statusFilter === "todos" || (statusFilter === "activos" ? member.isActive : !member.isActive));
  }), [users, query, roleFilter, statusFilter]);

  const activeUsers = users.filter((member) => member.isActive).length;
  const admins = users.filter((member) => member.isActive && member.role === "admin_empresa").length;
  const pending = users.filter((member) => !member.lastLoginAt || member.mustChangePassword).length;
  const usage = maxUsers ? Math.min(100, Math.round(users.length / maxUsers * 100)) : null;

  function openCreate() {
    setName(""); setEmail(""); setPassword(generatePassword()); setRole("orcamentista"); setIsActive(true); setDialog({ type: "create" });
  }

  function openEdit(member: CompanyUser) {
    setName(member.name); setRole(member.role); setIsActive(member.isActive); setDialog({ type: "edit", user: member });
  }

  function openPassword(member: CompanyUser) {
    setPassword(generatePassword()); setDialog({ type: "password", user: member });
  }

  async function saveCreate(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      await usersApi.create({ name, email, password, role });
      setDialog(null); await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível criar o acesso"); }
    finally { setSaving(false); }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!dialog || dialog.type !== "edit") return;
    setSaving(true); setError(null);
    try {
      await usersApi.update(dialog.user.id, { name, role, isActive });
      setDialog(null); await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível actualizar o acesso"); }
    finally { setSaving(false); }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!dialog || dialog.type !== "password") return;
    setSaving(true); setError(null);
    try {
      await usersApi.resetPassword(dialog.user.id, password);
      setDialog(null); await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível redefinir a palavra-passe"); }
    finally { setSaving(false); }
  }

  const atCapacity = Boolean(maxUsers && users.length >= maxUsers);

  return <div className="space-y-5">
    {error && <InlineNotice tone="danger">{error}</InlineNotice>}

    <section className="card overflow-hidden">
      <SectionHeader
        title="Equipa e acessos"
        description="Crie credenciais, atribua responsabilidades e suspenda acessos sem apagar o histórico da obra."
        actions={atCapacity
          ? <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Plano cheio ({users.length}/{maxUsers}) — liberte um acesso ou actualize o plano na aba Subscrição.</span>
          : <button onClick={openCreate} className="btn btn-primary btn-sm"><IconPlus className="h-4 w-4" /> Novo utilizador</button>}
      />

      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 text-sm">
        <span><strong className="text-slate-900">{maxUsers ? `${users.length}/${maxUsers}` : users.length}</strong> <span className="text-slate-500">na equipa</span></span>
        <span><strong className="text-emerald-700">{activeUsers}</strong> <span className="text-slate-500">com acesso activo</span></span>
        <span><strong className="text-slate-900">{admins}</strong> <span className="text-slate-500">administradores</span></span>
        {pending > 0 && <span><strong className="text-amber-700">{pending}</strong> <span className="text-slate-500">por concluir primeiro acesso</span></span>}
        {maxUsers && (
          <span className="ml-auto flex items-center gap-2">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full rounded-full ${usage && usage >= 90 ? "bg-amber-500" : "bg-blue-600"}`} style={{ width: `${usage}%` }} /></span>
            <span className="text-xs text-slate-400">{usage}% do plano</span>
          </span>
        )}
      </div>

      <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_190px_150px_auto]">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Procurar por nome ou email" aria-label="Procurar utilizador" />
        <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as CompanyUserRole | "todos")} aria-label="Filtrar por perfil"><option value="todos">Todos os perfis</option>{Object.entries(ROLE_INFO).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filtrar por estado"><option value="todos">Todos os estados</option><option value="activos">Activos</option><option value="inactivos">Desactivados</option></select>
        <button onClick={reload} className="btn btn-secondary" title="Actualizar lista"><IconRefresh className="h-4 w-4" /> Actualizar</button>
      </div>

      <div className="hidden grid-cols-[minmax(230px,1.5fr)_170px_160px_170px] gap-4 border-b border-slate-200 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 lg:grid"><span>Utilizador</span><span>Perfil e estado</span><span>Último acesso</span><span className="text-right">Acções</span></div>
      <div className="divide-y divide-slate-100">
        {loading && <div className="p-8 text-center text-sm text-slate-500">A carregar a equipa…</div>}
        {!loading && filtered.map((member) => <div key={member.id} className={`grid gap-4 px-5 py-4 lg:grid-cols-[minmax(230px,1.5fr)_170px_160px_170px] lg:items-center ${!member.isActive ? "bg-slate-50/70" : ""}`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${member.isActive ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-500"}`}>{member.name.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                {member.name}
                {member.id === currentUser?.id && <span className="badge badge-brand shrink-0">Você</span>}
                {member.mustChangePassword && <span className="badge badge-yellow shrink-0">1º acesso pendente</span>}
              </p>
              <p className="truncate text-xs text-slate-500">{member.email}</p>
            </div>
          </div>
          <div>
            <span className={`badge ${ROLE_INFO[member.role].badgeClass}`}>{ROLE_INFO[member.role].label}</span>
            <p className={`mt-1.5 text-[11px] font-semibold ${member.isActive ? "text-emerald-700" : "text-slate-400"}`}>{member.isActive ? "● Acesso activo" : "○ Acesso suspenso"}</p>
          </div>
          <div><p className="text-xs font-medium text-slate-700">{fmtAccess(member.lastLoginAt)}</p><p className="mt-1 text-[10px] text-slate-400">{member.hasGoogleLogin ? "Google associado" : "Email e palavra-passe"}</p></div>
          <div className="flex justify-start gap-2 lg:justify-end"><button onClick={() => openEdit(member)} className="btn btn-secondary btn-sm">Editar</button>{member.id !== currentUser?.id && <button onClick={() => openPassword(member)} className="btn btn-ghost btn-sm" title="Redefinir palavra-passe"><IconKey className="h-4 w-4" /></button>}</div>
        </div>)}
        {!loading && filtered.length === 0 && <div className="p-10 text-center"><IconUsers className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 text-sm font-semibold">Nenhum utilizador corresponde aos filtros.</p><button onClick={() => { setQuery(""); setRoleFilter("todos"); setStatusFilter("todos"); }} className="mt-2 text-xs font-semibold text-blue-700">Limpar filtros</button></div>}
      </div>

      <details className="group border-t border-slate-200 px-5 py-3 text-sm open:pb-5">
        <summary className="cursor-pointer list-none font-semibold text-slate-600 marker:content-none">
          <span className="inline-flex items-center gap-1.5">O que cada perfil pode fazer <span className="text-slate-400 transition group-open:rotate-180">▾</span></span>
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(ROLE_INFO).map(([key, info]) => <div key={key}><span className={`badge ${info.badgeClass}`}>{info.label}</span><p className="mt-2 text-xs leading-5 text-slate-500">{info.summary}</p></div>)}
        </div>
      </details>
    </section>

    {dialog?.type === "create" && <Modal title="Criar acesso da equipa" subtitle="A credencial é temporária e deverá ser alterada no primeiro acesso." onClose={() => setDialog(null)} maxWidth="max-w-xl"><form onSubmit={saveCreate} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div><label className="label">Nome completo</label><input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></div><div><label className="label">Email de acesso</label><input className="input" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div></div><div><label className="label">Perfil</label><select className="input" value={role} onChange={(e) => setRole(e.target.value as CompanyUserRole)}>{Object.entries(ROLE_INFO).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select><p className="mt-1 text-xs text-slate-500">{ROLE_INFO[role].summary}</p></div><div><div className="flex items-center justify-between"><label className="label">Palavra-passe temporária</label><button type="button" onClick={() => setPassword(generatePassword())} className="text-xs font-semibold text-blue-700">Gerar outra</button></div><input className="input font-mono" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /><p className="mt-1 text-xs text-amber-700">Copie e entregue esta credencial de forma segura. Ela não voltará a ser mostrada.</p></div><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setDialog(null)} className="btn btn-secondary">Cancelar</button><button disabled={saving} className="btn btn-primary">{saving ? "A criar…" : "Criar acesso"}</button></div></form></Modal>}

    {dialog?.type === "edit" && <Modal title="Editar utilizador" subtitle={dialog.user.email} onClose={() => setDialog(null)}><form onSubmit={saveEdit} className="space-y-4"><div><label className="label">Nome</label><input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></div><div><label className="label">Perfil</label><select className="input" disabled={dialog.user.id === currentUser?.id} value={role} onChange={(e) => setRole(e.target.value as CompanyUserRole)}>{Object.entries(ROLE_INFO).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select><p className="mt-1 text-xs text-slate-500">{dialog.user.id === currentUser?.id ? "Outro administrador deve alterar o seu perfil de acesso." : ROLE_INFO[role].summary}</p></div><label className={`flex items-start gap-3 rounded-lg border p-3 ${dialog.user.id === currentUser?.id ? "cursor-not-allowed bg-slate-50 opacity-60" : "cursor-pointer"}`}><input type="checkbox" className="mt-1" disabled={dialog.user.id === currentUser?.id} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /><span><strong className="block text-sm">Acesso activo</strong><small className="text-xs text-slate-500">Ao desactivar, todas as sessões terminam; os registos e aprovações permanecem.</small></span></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn btn-secondary">Cancelar</button><button disabled={saving} className="btn btn-primary">{saving ? "A guardar…" : "Guardar alterações"}</button></div></form></Modal>}

    {dialog?.type === "password" && <Modal title="Redefinir palavra-passe" subtitle={`O acesso de ${dialog.user.name} será terminado em todos os dispositivos.`} onClose={() => setDialog(null)}><form onSubmit={savePassword} className="space-y-4"><InlineNotice>Depois de entrar com esta credencial temporária, o utilizador terá de escolher uma nova palavra-passe.</InlineNotice><div><div className="flex items-center justify-between"><label className="label">Nova palavra-passe temporária</label><button type="button" onClick={() => setPassword(generatePassword())} className="text-xs font-semibold text-blue-700"><IconRefresh className="mr-1 inline h-3 w-3" />Gerar outra</button></div><input className="input font-mono" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="btn btn-secondary">Cancelar</button><button disabled={saving} className="btn btn-primary">{saving ? "A redefinir…" : "Redefinir acesso"}</button></div></form></Modal>}
  </div>;
}
