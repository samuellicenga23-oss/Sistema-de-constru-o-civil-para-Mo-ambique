import { useEffect, useState, type FormEvent } from "react";
import { companiesApi, type Company, type Subscription, type CompanyUpdateInput } from "../api/companies";
import { usersApi, type CompanyUser, type CompanyUserRole } from "../api/users";
import { useAuth } from "../auth/AuthContext";
import Layout from "../components/Layout";
import LoadingState from "../components/LoadingState";
import ConfirmDialog from "../components/ConfirmDialog";
import { IconPlus, IconTrash, IconUsers } from "../components/icons";
import { CURRENCIES, getPlanDefinition } from "@sigo/shared";

const STATUS_LABELS: Record<string, string> = { trial: "Trial", activo: "Activo", suspenso: "Suspenso" };
const STATUS_BADGE: Record<string, string> = { trial: "badge-yellow", activo: "badge-green", suspenso: "badge-red" };

const ROLE_LABELS: Record<CompanyUserRole, string> = {
  admin_empresa: "Administrador",
  orcamentista: "Orçamentista",
  engenheiro_fiscal: "Engenheiro/Fiscal",
  visualizador: "Visualizador",
};

type Tab = "geral" | "logotipo" | "calculo" | "subscricao" | "utilizadores";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "geral", label: "Dados gerais" },
  { id: "logotipo", label: "Logótipo" },
  { id: "calculo", label: "Configurações de cálculo" },
  { id: "subscricao", label: "Subscrição" },
  { id: "utilizadores", label: "Utilizadores" },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-MZ");
}

// Campos de texto simples reaproveitados nos separadores "Dados gerais" — cada um é só
// {chave, rótulo}, para não repetir o mesmo bloco de label+input onze vezes.
const GENERAL_FIELDS: Array<{ key: keyof CompanyUpdateInput; label: string; placeholder?: string }> = [
  { key: "nuit", label: "NUIT" },
  { key: "address", label: "Endereço" },
  { key: "province", label: "Província" },
  { key: "district", label: "Distrito" },
  { key: "phone", label: "Telefone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "responsibleName", label: "Responsável / assinatura" },
];

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin_empresa";
  const [tab, setTab] = useState<Tab>("geral");
  const [company, setCompany] = useState<Company | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<CompanyUserRole>("orcamentista");
  const [userError, setUserError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [deletingUser, setDeletingUser] = useState<{ id: string; name: string } | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  async function reload() {
    const data = await companiesApi.me();
    setCompany(data.company);
    setSubscription(data.subscription);
    setForm({
      name: data.company.name,
      nuit: data.company.nuit ?? "",
      address: data.company.address ?? "",
      province: data.company.province ?? "",
      district: data.company.district ?? "",
      phone: data.company.phone ?? "",
      email: data.company.email ?? "",
      website: data.company.website ?? "",
      bankDetails: data.company.bankDetails ?? "",
      documentFooter: data.company.documentFooter ?? "",
      responsibleName: data.company.responsibleName ?? "",
      defaultCurrency: data.company.defaultCurrency,
      workingDaysPerMonth: String(data.company.workingDaysPerMonth),
      workingHoursPerDay: data.company.workingHoursPerDay,
    });
  }

  async function reloadUsers() {
    setUsers(await usersApi.list());
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    reloadUsers().catch(() => {});
  }, []);

  async function handleSaveGeneral(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      await companiesApi.updateMe({
        name: form.name,
        nuit: form.nuit,
        address: form.address,
        province: form.province,
        district: form.district,
        phone: form.phone,
        email: form.email,
        website: form.website,
        responsibleName: form.responsibleName,
        bankDetails: form.bankDetails,
        documentFooter: form.documentFooter,
      });
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCalc(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      await companiesApi.updateMe({
        defaultCurrency: form.defaultCurrency,
        workingDaysPerMonth: Number(form.workingDaysPerMonth),
        workingHoursPerDay: Number(form.workingHoursPerDay),
      });
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await companiesApi.uploadLogo(file);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar logótipo");
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setUserError(null);
    setSavingUser(true);
    try {
      await usersApi.create({ name: newUserName, email: newUserEmail, password: newUserPassword, role: newUserRole });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("orcamentista");
      setShowUserForm(false);
      await reloadUsers();
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Erro ao criar utilizador");
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDeleteUser() {
    if (!deletingUser) return;
    setUserError(null);
    setDeletingBusy(true);
    try {
      await usersApi.delete(deletingUser.id);
      await reloadUsers();
      setDeletingUser(null);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Erro ao remover utilizador");
    } finally {
      setDeletingBusy(false);
    }
  }

  if (!company) {
    return <LoadingState fullScreen />;
  }

  return (
    <Layout title="Definições da Empresa">
      <div className="max-w-2xl">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === t.id ? "border-brand-700 text-brand-800" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "geral" && (
          <section className="card card-pad">
            <form onSubmit={handleSaveGeneral} className="space-y-4">
              <div>
                <label className="label">Nome da empresa</label>
                <input
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={!canEdit}
                  className="input"
                  required
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {GENERAL_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="label">{field.label}</label>
                    <input
                      value={form[field.key] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                      disabled={!canEdit}
                      className="input"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="label">Dados bancários</label>
                <textarea
                  value={form.bankDetails ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, bankDetails: e.target.value }))}
                  disabled={!canEdit}
                  className="input"
                  rows={2}
                  placeholder="Banco, NIB, número de conta..."
                />
              </div>
              <div>
                <label className="label">Rodapé para documentos exportados</label>
                <textarea
                  value={form.documentFooter ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, documentFooter: e.target.value }))}
                  disabled={!canEdit}
                  className="input"
                  rows={2}
                />
              </div>
              {canEdit && (
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={saving} className="btn btn-primary">
                    {saving ? "A guardar..." : "Guardar"}
                  </button>
                  {saved && <span className="text-sm text-green-600">Guardado.</span>}
                </div>
              )}
            </form>
          </section>
        )}

        {tab === "logotipo" && (
          <section className="card card-pad">
            <h2 className="section-title mb-3">Logótipo</h2>
            {company.logoUrl && <img src={company.logoUrl} alt="Logótipo" className="h-16 mb-3 object-contain" />}
            {canEdit ? (
              <>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleLogoChange}
                  disabled={uploading}
                  className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:text-brand-800 file:px-2.5 file:py-1 file:text-xs file:font-medium"
                />
                {uploading && <p className="text-xs text-gray-400 mt-2">A carregar...</p>}
              </>
            ) : (
              <p className="muted">Só um administrador da empresa pode mudar o logótipo.</p>
            )}
          </section>
        )}

        {tab === "calculo" && (
          <section className="card card-pad">
            <h2 className="section-title mb-3">Configurações de cálculo</h2>
            <p className="muted mb-4">Valores por omissão usados em novos orçamentos e composições de custo desta empresa.</p>
            <form onSubmit={handleSaveCalc} className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Moeda por omissão</label>
                <select
                  value={form.defaultCurrency ?? "MZN"}
                  onChange={(e) => setForm((f) => ({ ...f, defaultCurrency: e.target.value }))}
                  disabled={!canEdit}
                  className="input"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Dias de trabalho / mês</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={form.workingDaysPerMonth ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, workingDaysPerMonth: e.target.value }))}
                  disabled={!canEdit}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Horas de trabalho / dia</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  step="0.5"
                  value={form.workingHoursPerDay ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, workingHoursPerDay: e.target.value }))}
                  disabled={!canEdit}
                  className="input"
                />
              </div>
              {canEdit && (
                <div className="sm:col-span-3 flex items-center gap-3">
                  <button type="submit" disabled={saving} className="btn btn-primary">
                    {saving ? "A guardar..." : "Guardar"}
                  </button>
                  {saved && <span className="text-sm text-green-600">Guardado.</span>}
                </div>
              )}
            </form>
          </section>
        )}

        {tab === "subscricao" && (
          <section className="card card-pad">
            <h2 className="section-title mb-3">Subscrição</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`badge ${STATUS_BADGE[subscription?.status ?? "trial"]}`}>{STATUS_LABELS[subscription?.status ?? "trial"]}</span>
              {(() => {
                const plan = getPlanDefinition(subscription?.plan ?? "free");
                return plan ? (
                  <span className="text-sm text-gray-700">
                    Plano <span className="font-semibold">{plan.label}</span> — {plan.maxUsers ? `até ${plan.maxUsers} utilizador(es)` : "utilizadores ilimitados"} (
                    {users.length} em uso), {plan.maxProjects ? `até ${plan.maxProjects} projectos` : "projectos ilimitados"}
                  </span>
                ) : null;
              })()}
            </div>
            <p className="text-xs text-gray-400 mt-2">Para mudar de plano, contacte o suporte do SIGA.</p>
          </section>
        )}

        {tab === "utilizadores" && (
          <section className="card">
            {canEdit ? (
              <>
                <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <IconUsers className="w-4 h-4 text-brand-700" />
                    <h2 className="section-title text-base">Utilizadores da Equipa</h2>
                  </div>
                  <button onClick={() => setShowUserForm((s) => !s)} className="btn btn-secondary btn-sm">
                    <IconPlus className="w-3.5 h-3.5" />
                    Adicionar
                  </button>
                </div>

                {userError && <p className="text-sm text-red-600 px-5 pt-3">{userError}</p>}

                {showUserForm && (
                  <form onSubmit={handleCreateUser} className="grid gap-3 sm:grid-cols-2 px-5 py-4 border-b border-gray-100">
                    <div>
                      <label className="label">Nome</label>
                      <input required value={newUserName} onChange={(e) => setNewUserName(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Email</label>
                      <input required type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Palavra-passe inicial (mín. 8 caracteres)</label>
                      <input required minLength={8} type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Perfil</label>
                      <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as CompanyUserRole)} className="input">
                        {(Object.keys(ROLE_LABELS) as CompanyUserRole[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <button type="submit" disabled={savingUser} className="btn btn-primary">
                        {savingUser ? "A criar..." : "Criar utilizador"}
                      </button>
                    </div>
                  </form>
                )}

                <ul>
                  {users.map((u) => (
                    <li key={u.id} className="table-row group flex items-center justify-between px-5 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{u.name}</p>
                        <p className="muted truncate">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="badge badge-gray">{ROLE_LABELS[u.role]}</span>
                        <span className="muted hidden sm:inline">desde {fmtDate(u.createdAt)}</span>
                        {u.id !== user?.id && (
                          <button
                            onClick={() => setDeletingUser({ id: u.id, name: u.name })}
                            className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                            title="Remover utilizador"
                          >
                            <IconTrash className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                  {users.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Ainda não há mais ninguém na equipa.</li>}
                </ul>
              </>
            ) : (
              <p className="p-5 muted">Só um administrador da empresa pode gerir a equipa.</p>
            )}
          </section>
        )}
      </div>

      {deletingUser && (
        <ConfirmDialog
          title="Remover utilizador"
          message={`Remover "${deletingUser.name}" da equipa? Esta acção não pode ser desfeita.`}
          confirmLabel="Remover"
          danger
          busy={deletingBusy}
          onConfirm={handleDeleteUser}
          onCancel={() => setDeletingUser(null)}
        />
      )}
    </Layout>
  );
}
