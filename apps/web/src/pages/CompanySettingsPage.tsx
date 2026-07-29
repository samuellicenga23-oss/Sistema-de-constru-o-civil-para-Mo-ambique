import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { companiesApi, type Company, type Subscription, type CompanyUpdateInput } from "../api/companies";
import { usersApi } from "../api/users";
import { useAuth } from "../auth/AuthContext";
import Layout from "../components/Layout";
import LoadingState from "../components/LoadingState";
import TeamAccessPanel from "../components/TeamAccessPanel";
import { CURRENCIES, getPlanDefinition } from "@sigo/shared";

const STATUS_LABELS: Record<string, string> = { trial: "Trial", activo: "Activo", suspenso: "Suspenso" };
const STATUS_BADGE: Record<string, string> = { trial: "badge-yellow", activo: "badge-green", suspenso: "badge-red" };

type Tab = "geral" | "logotipo" | "calculo" | "subscricao" | "utilizadores";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "geral", label: "Dados gerais" },
  { id: "logotipo", label: "Logótipo" },
  { id: "calculo", label: "Configurações de cálculo" },
  { id: "subscricao", label: "Subscrição" },
  { id: "utilizadores", label: "Utilizadores" },
];

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
  const [searchParams, setSearchParams] = useSearchParams();
  const canEdit = user?.role === "admin_empresa";
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(requestedTab && TABS.some((item) => item.id === requestedTab) ? requestedTab : "geral");
  const [company, setCompany] = useState<Company | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [userCount, setUserCount] = useState(0);

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
    setUserCount((await usersApi.list()).length);
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

  if (!company) {
    return <LoadingState fullScreen />;
  }

  return (
    <Layout title="Definições da Empresa" subtitle="Identidade, parâmetros de cálculo, subscrição e acessos da equipa">
      <div className="max-w-6xl">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="workspace-tabs mb-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearchParams(t.id === "geral" ? {} : { tab: t.id }); }}
              className={`workspace-tab ${tab === t.id ? "workspace-tab-active" : ""}`}
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
                    {userCount} em uso), {plan.maxProjects ? `até ${plan.maxProjects} projectos` : "projectos ilimitados"}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4"><p className="text-xs text-slate-500">Precisa de mais capacidade?</p><Link to="/#planos" className="action-link">Ver planos anuais →</Link></div>
          </section>
        )}

        {tab === "utilizadores" && (
          canEdit ? <TeamAccessPanel maxUsers={getPlanDefinition(subscription?.plan ?? "free")?.maxUsers ?? null} onCountChange={setUserCount} /> : <section className="card card-pad"><p className="muted">Só um administrador da empresa pode gerir a equipa.</p></section>
        )}
      </div>
    </Layout>
  );
}
