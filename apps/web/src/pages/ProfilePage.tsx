import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type UserSession } from "../api/client";
import { companiesApi, type Company } from "../api/companies";
import { getPlanDefinition } from "@sigo/shared";
import Layout from "../components/Layout";
import RoleBadge from "../components/RoleBadge";
import ChangePasswordModal from "../components/ChangePasswordModal";
import { applyTheme, getStoredTheme, type Theme } from "../theme";
import { IconTrash } from "../components/icons";

function fmtDateTime(iso: string | null) {
  if (!iso) return "Nunca";
  return new Date(iso).toLocaleString("pt-MZ", { dateStyle: "medium", timeStyle: "short" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-MZ");
}

// Resumo curto do user-agent gravado na sessão — não é detecção fiável de dispositivo, só o
// suficiente para o utilizador reconhecer "isto é o meu telemóvel" vs "isto não sou eu".
function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "Dispositivo desconhecido";
  if (/Mobile|Android|iPhone/i.test(ua)) return "Telemóvel";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  return "Computador";
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [company, setCompany] = useState<Company | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme());

  async function reloadSessions() {
    setSessions(await api.listSessions());
  }

  useEffect(() => {
    if (user?.companyId) {
      companiesApi.me().then((d) => setCompany(d.company)).catch(() => {});
    }
    reloadSessions().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingName(true);
    setNameSaved(false);
    try {
      await api.updateProfile({ name });
      await refreshUser();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao guardar");
    } finally {
      setSavingName(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      await api.uploadAvatar(file);
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao carregar fotografia");
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  }

  async function handleRemoveAvatar() {
    setError(null);
    try {
      await api.deleteAvatar();
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao remover fotografia");
    }
  }

  async function handleEndSession(id: string) {
    setError(null);
    try {
      await api.deleteSession(id);
      await reloadSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao terminar sessão");
    }
  }

  async function handleEndOtherSessions() {
    if (!window.confirm("Terminar todas as outras sessões? Vai continuar com sessão aqui.")) return;
    setError(null);
    try {
      await api.terminateOtherSessions();
      await reloadSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao terminar sessões");
    }
  }

  function handleThemeChange(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  if (!user) return null;

  const plan = company?.subscription ? getPlanDefinition(company.subscription.plan) : null;

  return (
    <Layout title="Perfil" subtitle="Dados pessoais, segurança e sessões activas">
      <div className="space-y-5 max-w-2xl">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {user.mustChangePassword && <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4"><p className="font-semibold text-amber-950">Proteja o seu acesso antes de continuar</p><p className="mt-1 text-sm leading-6 text-amber-800">Está a usar uma palavra-passe temporária definida pelo administrador. Escolha agora uma palavra-passe pessoal; as restantes áreas ficam disponíveis logo depois.</p><button onClick={() => setShowChangePassword(true)} className="btn btn-primary mt-3">Definir a minha palavra-passe</button></div>}

        <section className="card card-pad">
          <h2 className="section-title mb-4">Dados pessoais</h2>
          <div className="flex items-start gap-4 mb-5">
            <div className="shrink-0">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-16 h-16 rounded-full object-cover border border-gray-200" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-800 flex items-center justify-center text-lg font-semibold">
                  {user.name.trim().charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1">
              <label className="input-sm inline-block cursor-pointer text-xs font-medium text-brand-700 hover:text-brand-900">
                {uploadingAvatar ? "A carregar..." : "Mudar fotografia"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleAvatarChange} disabled={uploadingAvatar} className="hidden" />
              </label>
              {user.avatarUrl && (
                <button onClick={handleRemoveAvatar} className="ml-3 text-xs text-red-600 hover:underline">
                  Remover
                </button>
              )}
            </div>
          </div>

          <form onSubmit={handleSaveName} className="space-y-3">
            <div>
              <label className="label">Nome</label>
              <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} className="input flex-1" required />
                <button type="submit" disabled={savingName || name === user.name} className="btn btn-primary">
                  {savingName ? "A guardar..." : "Guardar"}
                </button>
              </div>
              {nameSaved && <p className="text-xs text-green-600 mt-1">Nome actualizado.</p>}
            </div>
            <div>
              <label className="label">Email</label>
              <input value={user.email} disabled className="input bg-gray-50 text-gray-500" />
              <p className="muted mt-1">O email é a sua identidade de acesso — para mudar, contacte um administrador.</p>
            </div>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-100 grid sm:grid-cols-2 gap-4">
            <div>
              <p className="label mb-1">Perfil</p>
              <RoleBadge role={user.role} />
            </div>
            <div>
              <p className="label mb-1">Empresa</p>
              {company ? (
                <Link to="/empresa" className="text-sm text-brand-700 hover:underline font-medium">
                  {company.name}
                </Link>
              ) : (
                <p className="text-sm text-gray-500">Sem empresa associada</p>
              )}
              {plan && <p className="muted mt-0.5">Plano {plan.label}</p>}
            </div>
            <div>
              <p className="label mb-1">Membro desde</p>
              <p className="text-sm text-gray-700">{fmtDate(user.createdAt)}</p>
            </div>
            <div>
              <p className="label mb-1">Último acesso</p>
              <p className="text-sm text-gray-700">{fmtDateTime(user.lastLoginAt)}</p>
            </div>
          </div>
        </section>

        <section className="card card-pad">
          <h2 className="section-title mb-3">Preferências</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="label mb-1.5">Tema</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleThemeChange("light")}
                  className={`btn btn-sm ${theme === "light" ? "btn-primary" : "btn-secondary"}`}
                >
                  Claro
                </button>
                <button
                  onClick={() => handleThemeChange("dark")}
                  className={`btn btn-sm ${theme === "dark" ? "btn-primary" : "btn-secondary"}`}
                >
                  Escuro
                </button>
              </div>
            </div>
            <div>
              <p className="label mb-1.5">Idioma</p>
              <select disabled className="input bg-gray-50 text-gray-500 max-w-[200px]">
                <option>Português</option>
              </select>
              <p className="muted mt-1">Mais idiomas em breve.</p>
            </div>
          </div>
        </section>

        <section className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Palavra-passe</h2>
            <button onClick={() => setShowChangePassword(true)} className="btn btn-secondary btn-sm">
              Mudar palavra-passe
            </button>
          </div>
          <p className="muted">Mudar a palavra-passe termina automaticamente as restantes sessões noutros dispositivos.</p>
        </section>

        <section className="card">
          <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-gray-100">
            <h2 className="section-title text-base">Sessões</h2>
            {sessions.filter((s) => !s.current).length > 0 && (
              <button onClick={handleEndOtherSessions} className="btn btn-secondary btn-sm">
                Terminar as outras
              </button>
            )}
          </div>
          <ul>
            {sessions.map((s) => (
              <li key={s.id} className="table-row flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm text-gray-900">
                    {summarizeUserAgent(s.userAgent)}
                    {s.current && <span className="badge badge-green ml-2">Sessão actual</span>}
                  </p>
                  <p className="muted">
                    Iniciada em {fmtDateTime(s.createdAt)}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                  </p>
                </div>
                {!s.current && (
                  <button onClick={() => handleEndSession(s.id)} className="icon-btn-danger" title="Terminar sessão">
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
            {sessions.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">Sem sessões activas.</li>}
          </ul>
        </section>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} onSuccess={refreshUser} />}
    </Layout>
  );
}
