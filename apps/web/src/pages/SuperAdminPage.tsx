import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { companiesApi, type AdminCompanyUser, type Company, type CompanyModuleKey } from "../api/companies";
import { dashboardApi, type AdminStats } from "../api/dashboard";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import AlertBanner from "../components/AlertBanner";
import { IconBuilding, IconHome, IconPlus, IconSettings, IconUsers } from "../components/icons";
import { SUBSCRIPTION_PLANS, getPlanDefinition } from "@sigo/shared";
import { useLanguage } from "../i18n";

type AdminView = "overview" | "companies" | "users" | "configuration";
type UserRole = AdminCompanyUser["role"];

const STATUS_LABELS: Record<string, string> = { trial: "Trial", activo: "Activo", suspenso: "Suspenso" };
const STATUS_BADGE: Record<string, string> = { trial: "badge-yellow", activo: "badge-green", suspenso: "badge-red" };
const ROLE_LABELS: Record<UserRole, string> = { admin_empresa: "Administrador", orcamentista: "Orçamentista", engenheiro_fiscal: "Engenheiro/Fiscal", visualizador: "Visualizador" };
const MODULES: Array<{ key: CompanyModuleKey; pt: string; en: string; descriptionPt: string; descriptionEn: string }> = [
  { key: "dashboard", pt: "Painel", en: "Dashboard", descriptionPt: "Indicadores e visão geral", descriptionEn: "Indicators and overview" },
  { key: "measurements", pt: "Medições", en: "Measurements", descriptionPt: "Leitura de plantas e quantidades", descriptionEn: "Drawing analysis and quantities" },
  { key: "budgets", pt: "Orçamentos", en: "Budgets", descriptionPt: "Mapas, preços e documentos", descriptionEn: "BOQs, prices and documents" },
  { key: "catalog", pt: "Catálogo", en: "Catalogue", descriptionPt: "Materiais, mão-de-obra e composições", descriptionEn: "Materials, labour and compositions" },
  { key: "suppliers", pt: "Fornecedores", en: "Suppliers", descriptionPt: "Cotações e preços por zona", descriptionEn: "Quotes and zone prices" },
  { key: "purchasing", pt: "Compras e armazém", en: "Purchasing & stock", descriptionPt: "Pedidos, recepção e stock", descriptionEn: "Orders, receiving and stock" },
  { key: "schedule", pt: "Cronograma", en: "Schedule", descriptionPt: "Planeamento e progresso", descriptionEn: "Planning and progress" },
  { key: "site_diary", pt: "Diário de obra", en: "Site diary", descriptionPt: "Registos diários da execução", descriptionEn: "Daily execution records" },
  { key: "financial", pt: "Financeiro", en: "Financial", descriptionPt: "Custos, receitas e facturação", descriptionEn: "Costs, revenue and invoicing" },
  { key: "quick_calculations", pt: "Cálculos rápidos", en: "Quick calculations", descriptionPt: "Ferramentas técnicas rápidas", descriptionEn: "Quick technical tools" },
  { key: "practice", pt: "Comercial", en: "Commercial", descriptionPt: "Clientes, propostas por fases, parcelas e PDFs de honorários", descriptionEn: "Clients, phased proposals, milestones and fee PDFs" },
];

function StatCard({ label, value, tone = "text-slate-950" }: { label: string; value: ReactNode; tone?: string }) {
  return <div className="card p-4"><strong className={`block text-2xl tabular-nums ${tone}`}>{value}</strong><span className="mt-1 block text-xs text-slate-500">{label}</span></div>;
}

export default function SuperAdminPage() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const en = language === "en";
  const [view, setView] = useState<AdminView>("overview");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AdminCompanyUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [resetUser, setResetUser] = useState<AdminCompanyUser | null>(null);

  const [companyForm, setCompanyForm] = useState({ name: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [userForm, setUserForm] = useState<{ name: string; email: string; password: string; role: UserRole; preferredLanguage: "pt" | "en" }>({ name: "", email: "", password: "", role: "orcamentista", preferredLanguage: "pt" });
  const [resetPassword, setResetPassword] = useState("");
  const [settings, setSettings] = useState({ name: "", brandName: "", defaultCurrency: "MZN", primaryColor: "#1AADB4", accentColor: "#ED6C22", defaultLanguage: "pt" as "pt" | "en", enabledModules: [] as CompanyModuleKey[] });

  async function reload() {
    const [companyRows, userRows, statsData] = await Promise.all([companiesApi.list(), companiesApi.listAdminUsers(), dashboardApi.adminStats()]);
    setCompanies(companyRows);
    setUsers(userRows);
    setStats(statsData);
    setSelectedCompanyId((current) => current || companyRows[0]?.id || "");
  }

  useEffect(() => { reload().catch((err) => setError(err.message)); }, []);

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null;
  useEffect(() => {
    if (!selectedCompany) return;
    setSettings({ name: selectedCompany.name, brandName: selectedCompany.brandName ?? "", defaultCurrency: selectedCompany.defaultCurrency, primaryColor: selectedCompany.primaryColor, accentColor: selectedCompany.accentColor, defaultLanguage: selectedCompany.defaultLanguage, enabledModules: selectedCompany.enabledModules });
  }, [selectedCompany?.id]);

  const normalizedQuery = query.trim().toLocaleLowerCase("pt");
  const filteredCompanies = useMemo(() => companies.filter((company) => !normalizedQuery || [company.name, company.nuit, company.email, company.province, company.subscription?.plan, company.subscription?.status].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(normalizedQuery))), [companies, normalizedQuery]);
  const filteredUsers = useMemo(() => users.filter((member) => (!selectedCompanyId || member.companyId === selectedCompanyId) && (!normalizedQuery || [member.name, member.email, member.companyName, ROLE_LABELS[member.role]].some((value) => value.toLocaleLowerCase("pt").includes(normalizedQuery)))), [users, selectedCompanyId, normalizedQuery]);

  function notify(message: string) { setSuccess(message); setTimeout(() => setSuccess(null), 3000); }

  async function createCompany(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const result = await companiesApi.create(companyForm);
      setCompanyForm({ name: "", adminName: "", adminEmail: "", adminPassword: "" }); setShowCreateCompany(false); await reload(); setSelectedCompanyId(result.company.id); notify(en ? "Company created." : "Empresa criada.");
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao criar empresa"); } finally { setSaving(false); }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault(); if (!selectedCompanyId) return; setSaving(true); setError(null);
    try {
      await companiesApi.createAdminUser(selectedCompanyId, userForm);
      setUserForm({ name: "", email: "", password: "", role: "orcamentista", preferredLanguage: "pt" }); setShowCreateUser(false); await reload(); notify(en ? "User created." : "Utilizador criado.");
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao criar utilizador"); } finally { setSaving(false); }
  }

  async function updateSubscription(companyId: string, data: { status?: "trial" | "activo" | "suspenso"; plan?: string }) {
    setError(null); try { await companiesApi.updateSubscription(companyId, data); await reload(); } catch (err) { setError(err instanceof Error ? err.message : "Erro ao actualizar subscrição"); }
  }

  async function updateUser(member: AdminCompanyUser, data: Partial<Pick<AdminCompanyUser, "role" | "isActive" | "preferredLanguage">>) {
    setError(null); try { await companiesApi.updateAdminUser(member.id, data); await reload(); } catch (err) { setError(err instanceof Error ? err.message : "Erro ao actualizar utilizador"); }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); if (!selectedCompanyId) return; setSaving(true); setError(null);
    try {
      await companiesApi.updateAdminSettings(selectedCompanyId, { ...settings, brandName: settings.brandName || null });
      await reload(); notify(en ? "Company settings saved." : "Configuração da empresa guardada.");
    } catch (err) { setError(err instanceof Error ? err.message : "Erro ao guardar configuração"); } finally { setSaving(false); }
  }

  async function performPasswordReset(event: FormEvent) {
    event.preventDefault(); if (!resetUser) return; setSaving(true); setError(null);
    try { await companiesApi.resetAdminUserPassword(resetUser.id, resetPassword); setResetUser(null); setResetPassword(""); notify(en ? "Temporary password created and sessions revoked." : "Palavra-passe temporária criada e sessões terminadas."); }
    catch (err) { setError(err instanceof Error ? err.message : "Erro ao repor palavra-passe"); } finally { setSaving(false); }
  }

  function toggleModule(module: CompanyModuleKey) {
    setSettings((current) => {
      const enabled = current.enabledModules.includes(module);
      if (enabled && current.enabledModules.length === 1) return current;
      return { ...current, enabledModules: enabled ? current.enabledModules.filter((key) => key !== module) : [...current.enabledModules, module] };
    });
  }

  if (user?.role !== "super_admin") return <div className="grid min-h-screen place-items-center text-slate-500">Sem acesso.</div>;

  const views: Array<{ key: AdminView; label: string; icon: typeof IconHome }> = [
    { key: "overview", label: en ? "Overview" : "Visão geral", icon: IconHome },
    { key: "companies", label: en ? "Companies" : "Empresas", icon: IconBuilding },
    { key: "users", label: en ? "Users" : "Utilizadores", icon: IconUsers },
    { key: "configuration", label: en ? "Modules & branding" : "Módulos e identidade", icon: IconSettings },
  ];

  return (
    <Layout title={en ? "SIGO Control Center" : "Centro de Controlo SIGO"} subtitle={en ? "Companies, users, access, subscriptions and platform configuration" : "Empresas, utilizadores, acessos, subscrições e configuração da plataforma"} actions={<button type="button" onClick={() => setShowCreateCompany(true)} className="btn btn-primary btn-sm"><IconPlus className="h-4 w-4" />{en ? "New company" : "Nova empresa"}</button>}>
      <div className="mx-auto w-full max-w-7xl space-y-5">
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}
        {success && <AlertBanner tone="success">{success}</AlertBanner>}

        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5" aria-label="Administração">
          {views.map((item) => { const Icon = item.icon; return <button type="button" key={item.key} onClick={() => { setView(item.key); setQuery(""); }} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${view === item.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}
        </nav>

        {view === "overview" && stats && <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={en ? "Companies" : "Empresas"} value={stats.totalCompanies} />
            <StatCard label={en ? "Active" : "Activas"} value={stats.activeCompanies} tone="text-emerald-700" />
            <StatCard label="Trial" value={stats.trialCompanies} tone="text-amber-700" />
            <StatCard label={en ? "Suspended" : "Suspensas"} value={stats.suspendedCompanies} tone="text-red-700" />
            <StatCard label={en ? "Users" : "Utilizadores"} value={stats.totalUsers} />
            <StatCard label={en ? "Projects" : "Projectos"} value={stats.totalProjects} />
            <StatCard label="API" value={stats.services.api ? (en ? "Online" : "Operacional") : (en ? "Offline" : "Indisponível")} tone={stats.services.api ? "text-emerald-700" : "text-red-700"} />
            <StatCard label="Plant service" value={stats.services.plantService ? (en ? "Online" : "Operacional") : (en ? "Offline" : "Indisponível")} tone={stats.services.plantService ? "text-emerald-700" : "text-red-700"} />
            <StatCard
              label="Plant IA"
              value={
                (() => {
                  const ai = stats.services.plantAi as { enabled?: boolean; reachable?: boolean; model?: string } | null | undefined;
                  if (!stats.services.plantService) return en ? "n/a" : "n/d";
                  if (!ai?.enabled) return en ? "Off" : "Desligada";
                  if (!ai.reachable) return en ? "Ollama down" : "Ollama offline";
                  return ai.model ? `Ollama · ${ai.model}` : "Ollama";
                })()
              }
              tone={
                (() => {
                  const ai = stats.services.plantAi as { enabled?: boolean; reachable?: boolean } | null | undefined;
                  if (ai?.enabled && ai?.reachable) return "text-emerald-700";
                  if (ai?.enabled) return "text-amber-700";
                  return "text-slate-500";
                })()
              }
            />
          </div>
          <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="section-title">{en ? "Portfolio status" : "Estado da carteira"}</h2><p className="muted mt-1">{en ? "Companies grouped by commercial plan" : "Empresas agrupadas por plano comercial"}</p></div><div className="flex flex-wrap gap-2">{Object.entries(stats.planCounts).map(([plan, total]) => <span key={plan} className="badge badge-brand">{getPlanDefinition(plan)?.label ?? plan}: {total}</span>)}</div></div></section>
        </>}

        {view === "companies" && <>
          <section className="card p-4"><PageSearch value={query} onChange={setQuery} placeholder={en ? "Search company, plan, province or status…" : "Pesquisar empresa, plano, província ou estado…"} resultLabel={`${filteredCompanies.length} ${en ? "result(s)" : "resultado(s)"}`} /></section>
          <section className="card overflow-hidden">
            <div className="divide-y divide-slate-100">{filteredCompanies.map((company) => <article key={company.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_180px_150px_auto] lg:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-base text-slate-950">{company.name}</strong><span className={`badge ${STATUS_BADGE[company.subscription?.status ?? "trial"]}`}>{STATUS_LABELS[company.subscription?.status ?? "trial"]}</span></div><p className="mt-1 text-xs text-slate-500">{company.province ?? "Moçambique"} · {company.defaultCurrency} · {company.enabledModules.length}/{MODULES.length} {en ? "modules" : "módulos"}</p></div>
              <select value={company.subscription?.plan ?? "free"} onChange={(event) => updateSubscription(company.id, { plan: event.target.value })} className="input"><>{SUBSCRIPTION_PLANS.map((plan) => <option key={plan.key} value={plan.key}>{plan.label}</option>)}</></select>
              <select value={company.subscription?.status ?? "trial"} onChange={(event) => updateSubscription(company.id, { status: event.target.value as "trial" | "activo" | "suspenso" })} className="input"><option value="trial">Trial</option><option value="activo">{en ? "Active" : "Activo"}</option><option value="suspenso">{en ? "Suspended" : "Suspenso"}</option></select>
              <button type="button" onClick={() => { setSelectedCompanyId(company.id); setView("configuration"); }} className="btn btn-secondary btn-sm">{en ? "Manage" : "Gerir"}</button>
            </article>)}</div>
          </section>
        </>}

        {view === "users" && <>
          <section className="card p-4"><div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)_auto]"><select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)} className="input">{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><PageSearch value={query} onChange={setQuery} placeholder={en ? "Search name, email or role…" : "Pesquisar nome, email ou perfil…"} resultLabel={`${filteredUsers.length} ${en ? "user(s)" : "utilizador(es)"}`} /><button type="button" onClick={() => setShowCreateUser(true)} disabled={!selectedCompanyId} className="btn btn-primary"><IconPlus className="h-4 w-4" />{en ? "New user" : "Novo utilizador"}</button></div></section>
          <section className="card overflow-hidden"><div className="divide-y divide-slate-100">{filteredUsers.map((member) => <article key={member.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_190px_150px_110px_auto] lg:items-center"><div className="min-w-0"><strong className="block truncate text-sm text-slate-950">{member.name}</strong><span className="block truncate text-xs text-slate-500">{member.email}</span></div><select value={member.role} onChange={(event) => updateUser(member, { role: event.target.value as UserRole })} className="input text-sm">{Object.entries(ROLE_LABELS).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select><select value={member.preferredLanguage} onChange={(event) => updateUser(member, { preferredLanguage: event.target.value as "pt" | "en" })} className="input text-sm"><option value="pt">Português</option><option value="en">English</option></select><button type="button" onClick={() => updateUser(member, { isActive: !member.isActive })} className={`badge justify-center ${member.isActive ? "badge-green" : "badge-red"}`}>{member.isActive ? (en ? "Active" : "Activo") : (en ? "Inactive" : "Inactivo")}</button><button type="button" onClick={() => setResetUser(member)} className="btn btn-secondary btn-sm">{en ? "Reset password" : "Repor palavra-passe"}</button></article>)}</div></section>
        </>}

        {view === "configuration" && <>
          <section className="card p-4"><label className="label">{en ? "Company to configure" : "Empresa a configurar"}</label><select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)} className="input max-w-md">{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></section>
          {selectedCompany && <form onSubmit={saveSettings} className="space-y-5">
            <section className="card p-5"><div className="mb-4"><h2 className="section-title">{en ? "Identity and defaults" : "Identidade e padrões"}</h2><p className="muted mt-1">{en ? "Controls the company workspace appearance and initial language." : "Controla a apresentação do espaço da empresa e o idioma inicial."}</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><div><label className="label">{en ? "Legal/company name" : "Nome da empresa"}</label><input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} className="input" required /></div><div><label className="label">{en ? "Display brand" : "Marca apresentada"}</label><input value={settings.brandName} onChange={(event) => setSettings({ ...settings, brandName: event.target.value })} placeholder="SIGO" className="input" /></div><div><label className="label">{en ? "Default currency" : "Moeda padrão"}</label><select value={settings.defaultCurrency} onChange={(event) => setSettings({ ...settings, defaultCurrency: event.target.value })} className="input"><option value="MZN">MZN</option><option value="USD">USD</option></select></div><div><label className="label">{en ? "Default language" : "Idioma padrão"}</label><select value={settings.defaultLanguage} onChange={(event) => setSettings({ ...settings, defaultLanguage: event.target.value as "pt" | "en" })} className="input"><option value="pt">Português</option><option value="en">English</option></select></div><div><label className="label">{en ? "Primary colour" : "Cor principal"}</label><div className="flex gap-2"><input type="color" value={settings.primaryColor} onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })} className="h-11 w-14 rounded-lg border bg-white p-1" /><input value={settings.primaryColor} onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })} className="input" /></div></div><div><label className="label">{en ? "Action colour" : "Cor de acção"}</label><div className="flex gap-2"><input type="color" value={settings.accentColor} onChange={(event) => setSettings({ ...settings, accentColor: event.target.value })} className="h-11 w-14 rounded-lg border bg-white p-1" /><input value={settings.accentColor} onChange={(event) => setSettings({ ...settings, accentColor: event.target.value })} className="input" /></div></div></div><div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="h-10 w-10 rounded-lg" style={{ backgroundColor: settings.primaryColor }} /><div><strong className="text-sm text-slate-950">{settings.brandName || settings.name}</strong><p className="text-xs text-slate-500">{en ? "Brand preview" : "Pré-visualização da marca"}</p></div><button type="button" className="ml-auto rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: settings.accentColor }}>{en ? "Primary action" : "Acção principal"}</button></div></section>
            <section className="card p-5"><div className="mb-4"><h2 className="section-title">{en ? "Enabled modules" : "Módulos activos"}</h2><p className="muted mt-1">{en ? "Disabled modules disappear from navigation and are blocked by the API." : "Módulos desligados desaparecem da navegação e ficam bloqueados na API."}</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{MODULES.map((module) => { const active = settings.enabledModules.includes(module.key); return <button type="button" key={module.key} onClick={() => toggleModule(module.key)} className={`flex min-h-20 items-center justify-between gap-3 rounded-xl border p-4 text-left ${active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50 opacity-70"}`}><span><strong className="block text-sm text-slate-950">{en ? module.en : module.pt}</strong><small className="mt-1 block text-slate-500">{en ? module.descriptionEn : module.descriptionPt}</small></span><span className={`relative h-6 w-11 shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${active ? "translate-x-6" : "translate-x-1"}`} /></span></button>; })}</div></section>
            <div className="flex justify-end"><button type="submit" disabled={saving} className="btn btn-primary">{saving ? (en ? "Saving…" : "A guardar…") : (en ? "Save configuration" : "Guardar configuração")}</button></div>
          </form>}
        </>}
      </div>

      {showCreateCompany && <Modal title={en ? "New company" : "Nova empresa"} subtitle={en ? "Creates the company and its first administrator" : "Cria a empresa e o primeiro administrador"} onClose={() => setShowCreateCompany(false)} maxWidth="max-w-3xl"><form onSubmit={createCompany} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div><label className="label">{en ? "Company name" : "Nome da empresa"}</label><input required value={companyForm.name} onChange={(event) => setCompanyForm({ ...companyForm, name: event.target.value })} className="input" /></div><div><label className="label">{en ? "Administrator name" : "Nome do administrador"}</label><input required value={companyForm.adminName} onChange={(event) => setCompanyForm({ ...companyForm, adminName: event.target.value })} className="input" /></div><div><label className="label">{en ? "Administrator email" : "Email do administrador"}</label><input required type="email" value={companyForm.adminEmail} onChange={(event) => setCompanyForm({ ...companyForm, adminEmail: event.target.value })} className="input" /></div><div><label className="label">{en ? "Temporary password" : "Palavra-passe temporária"}</label><input required minLength={8} type="password" value={companyForm.adminPassword} onChange={(event) => setCompanyForm({ ...companyForm, adminPassword: event.target.value })} className="input" /></div></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreateCompany(false)} className="btn btn-secondary">{en ? "Cancel" : "Cancelar"}</button><button type="submit" disabled={saving} className="btn btn-primary">{en ? "Create company" : "Criar empresa"}</button></div></form></Modal>}
      {showCreateUser && <Modal title={en ? "New company user" : "Novo utilizador da empresa"} subtitle={selectedCompany?.name} onClose={() => setShowCreateUser(false)} maxWidth="max-w-2xl"><form onSubmit={createUser} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div><label className="label">{en ? "Name" : "Nome"}</label><input required value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} className="input" /></div><div><label className="label">Email</label><input required type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} className="input" /></div><div><label className="label">{en ? "Role" : "Perfil"}</label><select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as UserRole })} className="input">{Object.entries(ROLE_LABELS).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></div><div><label className="label">{en ? "Language" : "Idioma"}</label><select value={userForm.preferredLanguage} onChange={(event) => setUserForm({ ...userForm, preferredLanguage: event.target.value as "pt" | "en" })} className="input"><option value="pt">Português</option><option value="en">English</option></select></div><div className="sm:col-span-2"><label className="label">{en ? "Temporary password" : "Palavra-passe temporária"}</label><input required minLength={8} type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} className="input" /></div></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreateUser(false)} className="btn btn-secondary">{en ? "Cancel" : "Cancelar"}</button><button type="submit" disabled={saving} className="btn btn-primary">{en ? "Create user" : "Criar utilizador"}</button></div></form></Modal>}
      {resetUser && <Modal title={en ? "Reset password" : "Repor palavra-passe"} subtitle={`${resetUser.name} · ${resetUser.companyName}`} onClose={() => setResetUser(null)} maxWidth="max-w-lg"><form onSubmit={performPasswordReset} className="space-y-4"><div><label className="label">{en ? "New temporary password" : "Nova palavra-passe temporária"}</label><input required minLength={8} type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} className="input" /><p className="muted mt-1">{en ? "All active sessions will be revoked." : "Todas as sessões activas serão terminadas."}</p></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setResetUser(null)} className="btn btn-secondary">{en ? "Cancel" : "Cancelar"}</button><button type="submit" disabled={saving} className="btn btn-primary">{en ? "Reset password" : "Repor palavra-passe"}</button></div></form></Modal>}
    </Layout>
  );
}
