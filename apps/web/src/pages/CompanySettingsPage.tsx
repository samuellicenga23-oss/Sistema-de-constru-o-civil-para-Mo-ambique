import { useEffect, useState, type FormEvent } from "react";
import { companiesApi, type Company, type Subscription } from "../api/companies";
import { usersApi, type CompanyUser, type CompanyUserRole } from "../api/users";
import { useAuth } from "../auth/AuthContext";
import Layout from "../components/Layout";
import { IconPlus, IconTrash, IconUsers } from "../components/icons";
import { getPlanDefinition } from "@sigo/shared";

const STATUS_LABELS: Record<string, string> = { trial: "Trial", activo: "Activo", suspenso: "Suspenso" };
const STATUS_BADGE: Record<string, string> = { trial: "badge-yellow", activo: "badge-green", suspenso: "badge-red" };

const ROLE_LABELS: Record<CompanyUserRole, string> = {
  admin_empresa: "Administrador",
  orcamentista: "Orçamentista",
  engenheiro_fiscal: "Engenheiro/Fiscal",
  visualizador: "Visualizador",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-MZ");
}

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<CompanyUserRole>("orcamentista");
  const [userError, setUserError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  async function reload() {
    const data = await companiesApi.me();
    setCompany(data.company);
    setSubscription(data.subscription);
    setName(data.company.name);
  }

  async function reloadUsers() {
    setUsers(await usersApi.list());
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    reloadUsers().catch(() => {});
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await companiesApi.updateMe({ name });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar");
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

  async function handleDeleteUser(id: string, userName: string) {
    if (!window.confirm(`Remover "${userName}" da equipa? Esta acção não pode ser desfeita.`)) return;
    setUserError(null);
    try {
      await usersApi.delete(id);
      await reloadUsers();
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Erro ao remover utilizador");
    }
  }

  if (!company) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  return (
    <Layout title="Definições da Empresa">
      <div className="space-y-5 max-w-2xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

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
          <p className="text-xs text-gray-400 mt-2">Para mudar de plano, contacte o suporte do SIGO.</p>
        </section>

        <section className="card card-pad">
          <h2 className="section-title mb-3">Logótipo</h2>
          {company.logoUrl && <img src={company.logoUrl} alt="Logótipo" className="h-16 mb-3 object-contain" />}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleLogoChange} disabled={uploading} className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:text-brand-800 file:px-2.5 file:py-1 file:text-xs file:font-medium" />
          {uploading && <p className="text-xs text-gray-400 mt-2">A carregar...</p>}
        </section>

        <section className="card card-pad">
          <h2 className="section-title mb-3">Nome da empresa</h2>
          <form onSubmit={handleSave} className="flex gap-2 items-end">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input flex-1" />
            <button type="submit" className="btn btn-primary">
              Guardar
            </button>
          </form>
        </section>

        {user?.role === "admin_empresa" && (
          <section className="card">
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
                        onClick={() => handleDeleteUser(u.id, u.name)}
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
          </section>
        )}
      </div>
    </Layout>
  );
}
