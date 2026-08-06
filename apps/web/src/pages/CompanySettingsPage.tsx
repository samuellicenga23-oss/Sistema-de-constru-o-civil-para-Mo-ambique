import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { companiesApi, type Company, type Subscription, type CompanyUpdateInput } from "../api/companies";
import { usersApi } from "../api/users";
import { boqApi } from "../api/boq";
import { useAuth } from "../auth/AuthContext";
import Layout from "../components/Layout";
import LoadingState from "../components/LoadingState";
import AlertBanner from "../components/AlertBanner";
import TeamAccessPanel from "../components/TeamAccessPanel";
import { CURRENCIES, getPlanDefinition } from "@sigo/shared";
import { SIGO_WHATSAPP_NUMBER, formatMzn } from "../commercialPlans";

const STATUS_LABELS: Record<string, string> = { trial: "Trial", activo: "Activo", suspenso: "Suspenso" };
const STATUS_BADGE: Record<string, string> = { trial: "badge-yellow", activo: "badge-green", suspenso: "badge-red" };

type Tab = "geral" | "logotipo" | "calculo" | "subscricao" | "utilizadores";
const TABS: Array<{ id: Tab; label: string; short: string }> = [
  { id: "geral", label: "Dados gerais", short: "Geral" },
  { id: "logotipo", label: "Logótipo", short: "Logo" },
  { id: "calculo", label: "Cálculo", short: "Cálculo" },
  { id: "subscricao", label: "Subscrição", short: "Plano" },
  { id: "utilizadores", label: "Utilizadores", short: "Equipa" },
];

const GENERAL_FIELDS: Array<{ key: keyof CompanyUpdateInput; label: string }> = [
  { key: "nuit", label: "NUIT" },
  { key: "address", label: "Endereço" },
  { key: "province", label: "Província" },
  { key: "district", label: "Distrito" },
  { key: "phone", label: "Telefone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Sítio web" },
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
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [projectCount, setProjectCount] = useState(0);

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
    const [users, projects] = await Promise.all([usersApi.list(), boqApi.listProjects()]);
    setUserCount(users.length);
    setProjectCount(projects.length);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
    reloadUsers().catch(() => {});
  }, []);

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage((current) => (current === text ? null : current)), 2500);
  }

  async function handleSaveGeneral(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
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
      flash("Dados da empresa guardados.");
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
    try {
      await companiesApi.updateMe({
        defaultCurrency: form.defaultCurrency,
        workingDaysPerMonth: Number(form.workingDaysPerMonth),
        workingHoursPerDay: Number(form.workingHoursPerDay),
      });
      await reload();
      flash("Parâmetros de cálculo guardados.");
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
      flash("Logótipo actualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar logótipo");
    } finally {
      setUploading(false);
    }
  }

  if (!company) {
    return <LoadingState fullScreen label="A carregar empresa..." />;
  }

  const plan = getPlanDefinition(subscription?.plan ?? "free");

  return (
    <Layout title="Empresa" subtitle="Identidade, parâmetros de cálculo e equipa">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}
        {message && <AlertBanner tone="success" onDismiss={() => setMessage(null)}>{message}</AlertBanner>}

        <section className="card overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-2">
              {company.logoUrl ? (
                <img src={company.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-2xl font-black text-brand-700">{company.name.charAt(0)}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold text-slate-900">{company.name}</h2>
              <p className="mt-0.5 text-sm text-slate-500">{[company.district, company.province].filter(Boolean).join(" · ") || "Localização por definir"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`badge ${STATUS_BADGE[subscription?.status ?? "trial"]}`}>{STATUS_LABELS[subscription?.status ?? "trial"]}</span>
                {plan && <span className="badge badge-gray">Plano {plan.label}</span>}
                <span className="badge badge-gray">{userCount} utilizador(es)</span>
              </div>
            </div>
          </div>
        </section>

        <div className="workspace-tabs overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearchParams(t.id === "geral" ? {} : { tab: t.id }); }}
              className={`workspace-tab whitespace-nowrap ${tab === t.id ? "workspace-tab-active" : ""}`}
            >
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.short}</span>
            </button>
          ))}
        </div>

        {tab === "geral" && (
          <section className="card card-pad">
            <h2 className="section-title mb-4">Dados gerais</h2>
            <form onSubmit={handleSaveGeneral} className="space-y-4">
              <div>
                <label className="label">Nome da empresa *</label>
                <input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={!canEdit} className="input" required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {GENERAL_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="label">{field.label}</label>
                    <input value={form[field.key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))} disabled={!canEdit} className="input" />
                  </div>
                ))}
              </div>
              <div>
                <label className="label">Meios de pagamento</label>
                <textarea
                  value={form.bankDetails ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, bankDetails: e.target.value }))}
                  disabled={!canEdit}
                  className="input min-h-20"
                  placeholder={"Banco XYZ\nConta / NIB: …\nM-Pesa / e-Mola: …\nTitular: …"}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Aparece nas propostas, facturas e recibos do Comercial como «Meios de pagamento».
                </p>
              </div>
              <div>
                <label className="label">Rodapé dos documentos exportados</label>
                <textarea value={form.documentFooter ?? ""} onChange={(e) => setForm((f) => ({ ...f, documentFooter: e.target.value }))} disabled={!canEdit} className="input min-h-16" placeholder="Morada, site, agradecimento…" />
                <p className="mt-1 text-xs text-slate-500">Texto complementar no rodapé do PDF (além dos meios de pagamento).</p>
              </div>
              {canEdit && (
                <button type="submit" disabled={saving} className="btn btn-primary">{saving ? "A guardar..." : "Guardar dados"}</button>
              )}
            </form>
          </section>
        )}

        {tab === "logotipo" && (
          <section className="card card-pad">
            <h2 className="section-title mb-2">Logótipo</h2>
            <p className="muted mb-4">Aparece na barra lateral e no cabeçalho dos PDFs do Comercial (propostas, facturas, recibos).</p>
            {company.logoUrl && <img src={company.logoUrl} alt="Logótipo" className="mb-4 h-20 object-contain" />}
            {canEdit ? (
              <>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleLogoChange} disabled={uploading} className="input py-2 file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-800" />
                {uploading && <p className="muted mt-2">A carregar...</p>}
              </>
            ) : (
              <p className="muted">Só um administrador pode alterar o logótipo.</p>
            )}
          </section>
        )}

        {tab === "calculo" && (
          <section className="card card-pad">
            <h2 className="section-title mb-2">Parâmetros de cálculo</h2>
            <p className="muted mb-4">Usados no custo/hora da mão-de-obra e em novos projectos.</p>
            <form onSubmit={handleSaveCalc} className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Moeda por omissão</label>
                <select value={form.defaultCurrency ?? "MZN"} onChange={(e) => setForm((f) => ({ ...f, defaultCurrency: e.target.value }))} disabled={!canEdit} className="input">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Dias úteis / mês</label>
                <input type="number" min={1} max={31} value={form.workingDaysPerMonth ?? ""} onChange={(e) => setForm((f) => ({ ...f, workingDaysPerMonth: e.target.value }))} disabled={!canEdit} className="input" />
                <p className="muted mt-1">Típico: 22 (seg–sáb)</p>
              </div>
              <div>
                <label className="label">Horas / dia</label>
                <input type="number" min={1} max={24} step="0.01" value={form.workingHoursPerDay ?? ""} onChange={(e) => setForm((f) => ({ ...f, workingHoursPerDay: e.target.value }))} disabled={!canEdit} className="input" />
              </div>
              {canEdit && (
                <div className="sm:col-span-3">
                  <button type="submit" disabled={saving} className="btn btn-primary">{saving ? "A guardar..." : "Guardar parâmetros"}</button>
                </div>
              )}
            </form>
          </section>
        )}

        {tab === "subscricao" && (
          <section className="card card-pad space-y-4">
            <h2 className="section-title">Subscrição e capacidade</h2>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${STATUS_BADGE[subscription?.status ?? "trial"]}`}>{STATUS_LABELS[subscription?.status ?? "trial"]}</span>
                {plan && <span className="text-sm font-semibold text-slate-800">Plano {plan.label}</span>}
              </div>
              {plan && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="flex justify-between text-xs text-slate-600 mb-1">
                        <span>Utilizadores</span>
                        <span>{userCount}{plan.maxUsers ? ` / ${plan.maxUsers}` : ""}</span>
                      </div>
                      {plan.maxUsers && (
                        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div className="h-full bg-brand-600 rounded-full" style={{ width: `${Math.min(100, (userCount / plan.maxUsers) * 100)}%` }} />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-slate-600 mb-1">
                        <span>Projectos</span>
                        <span>{projectCount}{plan.maxProjects ? ` / ${plan.maxProjects}` : ""}</span>
                      </div>
                      {plan.maxProjects && (
                        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div className="h-full bg-brand-600 rounded-full" style={{ width: `${Math.min(100, (projectCount / plan.maxProjects) * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                  {plan.annualPriceMzn != null && plan.annualPriceMzn > 0 && (
                    <p className="text-sm text-slate-700">Referência anual: <strong>{formatMzn(plan.annualPriceMzn)}</strong> · mensal {formatMzn(plan.monthlyPriceMzn ?? 0)}</p>
                  )}
                  {plan.priceNote && <p className="text-xs text-slate-500">{plan.priceNote}</p>}
                  <ul className="space-y-1 text-sm text-slate-600">
                    {plan.features.slice(0, 6).map((f) => (
                      <li key={f} className="flex gap-2"><span className="text-emerald-600">✓</span>{f}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <p className="text-xs text-slate-500">A activação e alteração de plano é feita pela equipa SIGO (facturação fora do sistema). Contacte o suporte para upgrade ou mais capacidade.</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/creditos" className="btn btn-primary btn-sm">Créditos e planos</Link>
              <Link to="/#planos" className="btn btn-secondary btn-sm">Ver planos públicos</Link>
              <a
                href={`https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${encodeURIComponent("Olá, gostaria de alterar o plano ou aumentar a capacidade da minha empresa no SIGO.")}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
              >
                Pedir upgrade
              </a>
            </div>
          </section>
        )}

        {tab === "utilizadores" && (
          canEdit ? (
            plan?.limits.maxUsers === 1 && !plan.capabilities.teamManagement ? (
              <section className="card card-pad space-y-3">
                <p className="text-sm text-slate-800">
                  O plano <strong>{plan.label}</strong> inclui 1 utilizador — o sistema completo para uma pessoa.
                </p>
                <p className="text-xs text-slate-500">
                  Para engenheiro, orçamentista, fiscal e financeiro com contas separadas, active o plano Profissional (5 utilizadores).
                </p>
                <a
                  href={`https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${encodeURIComponent("Olá — quero passar ao plano Profissional para trabalhar em equipa no SIGO.")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary btn-sm w-fit"
                >
                  Activar Profissional
                </a>
              </section>
            ) : (
              <TeamAccessPanel maxUsers={plan?.maxUsers ?? null} onCountChange={setUserCount} />
            )
          ) : (
            <section className="card card-pad"><p className="muted">Só um administrador pode gerir a equipa.</p></section>
          )
        )}
      </div>
    </Layout>
  );
}
