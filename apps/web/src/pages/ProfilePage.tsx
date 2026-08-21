import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, type UserSession } from "../api/client";
import { companiesApi, type Company } from "../api/companies";
import { getPlanDefinition } from "@sigo/shared";
import Layout from "../components/Layout";
import RoleBadge from "../components/RoleBadge";
import ChangePasswordModal from "../components/ChangePasswordModal";
import AlertBanner from "../components/AlertBanner";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { applyTheme, getStoredTheme, type Theme } from "../theme";
import { IconTrash } from "../components/icons";
import { useLanguage, type Language } from "../i18n";
import {
  DATA_SAVER_CHANGE_EVENT,
  isDataSaverEnabled,
  setDataSaverEnabled,
} from "../lib/dataSaver";

function fmtDateTime(iso: string | null) {
  if (!iso) return "Nunca";
  return new Date(iso).toLocaleString("pt-MZ", { dateStyle: "medium", timeStyle: "short" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-MZ");
}

function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "Dispositivo desconhecido";
  if (/Mobile|Android|iPhone/i.test(ua)) return "Telemóvel";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  return "Computador";
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { t } = useLanguage();
  const { confirm, dialog } = useConfirmDialog();
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [dataSaver, setDataSaver] = useState(isDataSaverEnabled());
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageSaved, setLanguageSaved] = useState(false);

  async function reloadSessions() {
    setSessions(await api.listSessions());
  }

  useEffect(() => {
    if (user?.companyId) {
      companiesApi.me().then((d) => setCompany(d.company)).catch(() => {});
    }
    reloadSessions().catch(() => {});
  }, [user?.companyId]);

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
    const ok = await confirm({
      title: "Remover fotografia?",
      message: "A sua fotografia de perfil será eliminada.",
      confirmLabel: "Remover",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteAvatar();
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao remover fotografia");
    }
  }

  async function handleEndSession(id: string) {
    const ok = await confirm({
      title: "Terminar sessão?",
      message: "Esse dispositivo terá de voltar a entrar com email e palavra-passe.",
      confirmLabel: "Terminar sessão",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteSession(id);
      await reloadSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao terminar sessão");
    }
  }

  async function handleEndOtherSessions() {
    const ok = await confirm({
      title: "Terminar outras sessões?",
      message: "Todos os outros dispositivos serão desligados. Mantém-se autenticado apenas neste ecrã.",
      confirmLabel: "Terminar as outras",
      danger: true,
      details: ["Telemóveis, tablets e outros computadores", "Não afecta a sessão actual"],
    });
    if (!ok) return;
    setError(null);
    try {
      await api.terminateOtherSessions();
      await reloadSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao terminar sessões");
    }
  }

  useEffect(() => {
    function syncDataSaver() {
      setDataSaver(isDataSaverEnabled());
    }
    window.addEventListener(DATA_SAVER_CHANGE_EVENT, syncDataSaver);
    return () => window.removeEventListener(DATA_SAVER_CHANGE_EVENT, syncDataSaver);
  }, []);

  function handleDataSaverToggle(enabled: boolean) {
    setDataSaverEnabled(enabled);
    setDataSaver(enabled);
  }

  function handleThemeChange(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  async function handleLanguageChange(language: Language) {
    setSavingLanguage(true);
    setLanguageSaved(false);
    setError(null);
    try {
      await api.updateProfile({ preferredLanguage: language });
      await refreshUser();
      setLanguageSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao actualizar idioma");
    } finally {
      setSavingLanguage(false);
    }
  }

  if (!user) return null;

  const plan = company?.subscription ? getPlanDefinition(company.subscription.plan) : null;
  const otherSessions = sessions.filter((s) => !s.current);

  return (
    <Layout title={t("profile")} subtitle={t("accountSecurity")}>
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}

        {user.mustChangePassword && (
          <AlertBanner tone="info">
            <p className="font-semibold">Palavra-passe temporária</p>
            <p className="mt-1 text-sm opacity-90">
              Pode continuar a trabalhar normalmente. Quando quiser, defina uma palavra-passe pessoal em Perfil.
            </p>
            <button onClick={() => setShowChangePassword(true)} className="btn btn-secondary btn-sm mt-3">
              Alterar palavra-passe
            </button>
          </AlertBanner>
        )}

        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-950 to-brand-800 px-5 py-6 text-white sm:px-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="relative shrink-0">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="h-20 w-20 rounded-full border-2 border-white/30 object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/15 text-2xl font-bold">
                    {user.name.trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <h2 className="truncate text-xl font-bold">{user.name}</h2>
                <p className="mt-0.5 truncate text-sm text-brand-200">{user.email}</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <RoleBadge role={user.role} />
                  {company && (
                    <Link to="/empresa" className="badge badge-brand bg-white/15 text-white hover:bg-white/25">
                      {company.name}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="card-pad flex flex-wrap gap-2 border-b border-slate-100">
            <label className="btn btn-secondary btn-sm cursor-pointer">
              {uploadingAvatar ? "A carregar..." : "Mudar fotografia"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleAvatarChange} disabled={uploadingAvatar} className="hidden" />
            </label>
            {user.avatarUrl && (
              <button type="button" onClick={handleRemoveAvatar} className="btn btn-danger btn-sm">Remover fotografia</button>
            )}
            <button type="button" onClick={() => setShowChangePassword(true)} className="btn btn-ghost btn-sm">Palavra-passe</button>
          </div>
          <div className="card-pad">
            <form onSubmit={handleSaveName} className="space-y-4">
              <div>
                <label className="label">Nome apresentado</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input flex-1" required />
                  <button type="submit" disabled={savingName || name === user.name} className="btn btn-primary sm:shrink-0">
                    {savingName ? "A guardar..." : "Guardar"}
                  </button>
                </div>
                {nameSaved && <p className="mt-1 text-xs text-emerald-600">Nome actualizado.</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="label">Membro desde</p>
                  <p className="text-sm text-slate-700">{fmtDate(user.createdAt)}</p>
                </div>
                <div>
                  <p className="label">Último acesso</p>
                  <p className="text-sm text-slate-700">{fmtDateTime(user.lastLoginAt)}</p>
                </div>
                {plan && (
                  <div className="sm:col-span-2">
                    <p className="label">Plano da empresa</p>
                    <p className="text-sm text-slate-700">{plan.label}</p>
                  </div>
                )}
              </div>
            </form>
          </div>
        </section>

        <section className="card card-pad">
          <h2 className="section-title mb-3">{t("preferences")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="label mb-1.5">Tema</p>
              <div className="flex gap-2">
                <button onClick={() => handleThemeChange("light")} className={`btn btn-sm ${theme === "light" ? "btn-primary" : "btn-secondary"}`}>Claro</button>
                <button onClick={() => handleThemeChange("dark")} className={`btn btn-sm ${theme === "dark" ? "btn-primary" : "btn-secondary"}`} disabled title="Em breve">Escuro</button>
              </div>
              <p className="muted mt-1">O tema escuro estará disponível numa actualização futura.</p>
            </div>
            <div>
              <p className="label mb-1.5">{t("language")}</p>
              <select value={user.preferredLanguage === "en" ? "en" : "pt"} disabled={savingLanguage} onChange={(event) => handleLanguageChange(event.target.value as Language)} className="input max-w-[240px]">
                <option value="pt">{t("portuguese")}</option>
                <option value="en">{t("english")}</option>
              </select>
              {languageSaved && <p className="mt-1 text-xs text-emerald-600">{t("languageSaved")}</p>}
            </div>
            <div>
              <p className="label mb-1.5">Modo económico de dados</p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={dataSaver}
                  onChange={(e) => handleDataSaverToggle(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Poupar dados móveis
              </label>
              <p className="muted mt-1">Menos actualizações automáticas, imagens mais pequenas e sem pré-carregar PDFs.</p>
            </div>
            <div>
              <p className="label mb-1.5">Ajuda</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(`sigo-onboarding-v1:${user.id}`);
                    window.localStorage.removeItem(`sigo-onboarding-v2:${user.id}`);
                  } catch {
                    /* ignore */
                  }
                  window.location.assign("/painel");
                }}
              >
                Repetir introdução
              </button>
            </div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="section-title">Sessões activas</h2>
              <p className="muted mt-0.5">{sessions.length} dispositivo(s) com acesso</p>
            </div>
            {otherSessions.length > 0 && (
              <button onClick={handleEndOtherSessions} className="btn btn-danger btn-sm w-full sm:w-auto">Terminar as outras</button>
            )}
          </div>
          <ul className="divide-y divide-slate-100">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {summarizeUserAgent(s.userAgent)}
                    {s.current && <span className="badge badge-green ml-2">Actual</span>}
                  </p>
                  <p className="muted truncate">
                    {fmtDateTime(s.createdAt)}{s.ipAddress ? ` · ${s.ipAddress}` : ""}
                  </p>
                </div>
                {!s.current && (
                  <button onClick={() => handleEndSession(s.id)} className="icon-btn-danger shrink-0" title="Terminar sessão">
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
            {sessions.length === 0 && <li className="px-5 py-6 text-sm text-slate-400">Sem sessões activas.</li>}
          </ul>
        </section>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} onSuccess={refreshUser} />}
      {dialog}
    </Layout>
  );
}
