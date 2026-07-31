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

  function handleThemeChange(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  if (!user) return null;

  const plan = company?.subscription ? getPlanDefinition(company.subscription.plan) : null;
  const otherSessions = sessions.filter((s) => !s.current);

  return (
    <Layout title="Perfil" subtitle="Conta, segurança e sessões activas">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}

        {user.mustChangePassword && (
          <AlertBanner tone="warning">
            <p className="font-semibold">Defina a sua palavra-passe</p>
            <p className="mt-1 text-sm opacity-90">Está a usar uma credencial temporária. Escolha uma palavra-passe pessoal para continuar.</p>
            <button onClick={() => setShowChangePassword(true)} className="btn btn-primary btn-sm mt-3">Definir palavra-passe</button>
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
          <h2 className="section-title mb-3">Preferências</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="label mb-1.5">Tema</p>
              <div className="flex gap-2">
                <button onClick={() => handleThemeChange("light")} className={`btn btn-sm ${theme === "light" ? "btn-primary" : "btn-secondary"}`}>Claro</button>
                <button onClick={() => handleThemeChange("dark")} className={`btn btn-sm ${theme === "dark" ? "btn-primary" : "btn-secondary"}`} disabled title="Em breve">Escuro</button>
              </div>
              <p className="muted mt-1">O tema escuro estará disponível numa actualização futura.</p>
            </div>
            <div>
              <p className="label mb-1.5">Idioma</p>
              <select disabled className="input max-w-[200px] bg-slate-50 text-slate-500"><option>Português</option></select>
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
