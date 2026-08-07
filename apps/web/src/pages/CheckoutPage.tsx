import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { calculateVatTotals } from "@sigo/shared";
import { SIGO_CONTACT_EMAIL, findCommercialPlan, formatMzn } from "../commercialPlans";
import { LogoFull } from "../components/Logo";
import { ApiError } from "../api/http";
import AlertBanner from "../components/AlertBanner";

type CheckoutForm = {
  name: string;
  company: string;
  email: string;
  phone: string;
  nuit: string;
  city: string;
  teamSize: string;
  notes: string;
};

const EMPTY_FORM: CheckoutForm = { name: "", company: "", email: "", phone: "", nuit: "", city: "", teamSize: "", notes: "" };

export default function CheckoutPage() {
  const { planSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const plan = findCommercialPlan(planSlug);
  const [billingCycle, setBillingCycle] = useState<"mensal" | "anual">(searchParams.get("periodo") === "anual" ? "anual" : "mensal");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    document.title = "Subscrição SIGO";
    return () => { document.title = "SIGO — Sistema Integrado de Gestão de Obras"; };
  }, []);
  const [accepted, setAccepted] = useState(false);
  const totals = useMemo(
    () => calculateVatTotals(billingCycle === "anual" ? plan?.annualPrice ?? 0 : plan?.monthlyPrice ?? 0),
    [billingCycle, plan?.annualPrice, plan?.monthlyPrice],
  );

  if (planSlug === "fundamento") return <Navigate to="/checkout/individual" replace />;
  if (!plan) return <Navigate to="/#planos" replace />;

  function update(field: keyof CheckoutForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeBillingCycle(value: "mensal" | "anual") {
    setBillingCycle(value);
    setSearchParams({ periodo: value }, { replace: true });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          company: form.company,
          email: form.email,
          phone: form.phone,
          nuit: form.nuit || undefined,
          city: form.city || undefined,
          teamSize: form.teamSize || undefined,
          planOrPack: plan!.name,
          billingCycle,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, typeof body.error === "string" ? body.error : "Não foi possível enviar o pedido");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar o pedido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="border-b border-slate-200/90 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex min-h-[72px] max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" aria-label="SIGO — início">
            <LogoFull tagline={false} />
          </Link>
          <Link to="/#planos" className="action-link">← Voltar aos planos</Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:py-12">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_-18px_rgba(20,32,51,0.28)]">
          <div className="border-b border-slate-200 px-5 py-5 sm:px-7">
            <p className="eyebrow text-accent">Pedido de subscrição</p>
            <h1 className="mt-2 font-display text-2xl font-black tracking-tight sm:text-3xl">Dados para activar o SIGO</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Confirme os dados da empresa. Não será feita nenhuma cobrança nesta página; a equipa SIGO valida a implementação e envia a proposta final.</p>
          </div>
          {submitted ? (
            <div className="p-5 sm:p-7">
              <AlertBanner tone="success">
                Pedido recebido! A equipa SIGO vai analisar e entrar em contacto por email ou telefone — normalmente em
                poucas horas.
              </AlertBanner>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-7">
            {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}
            <fieldset>
              <legend className="mb-3 text-sm font-bold text-slate-900">Responsável pela subscrição</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="label">Nome completo *</label><input required autoComplete="name" className="input" value={form.name} onChange={(e) => update("name", e.target.value)} /></div>
                <div><label className="label">Empresa *</label><input required autoComplete="organization" className="input" value={form.company} onChange={(e) => update("company", e.target.value)} /></div>
                <div><label className="label">Email profissional *</label><input required type="email" autoComplete="email" className="input" value={form.email} onChange={(e) => update("email", e.target.value)} /></div>
                <div><label className="label">WhatsApp / telefone *</label><input required type="tel" autoComplete="tel" className="input" placeholder="+258" value={form.phone} onChange={(e) => update("phone", e.target.value)} /></div>
              </div>
            </fieldset>
            <fieldset className="border-t border-slate-200 pt-5">
              <legend className="mb-3 text-sm font-bold text-slate-900">Dados de implementação</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="label">NUIT</label><input className="input" value={form.nuit} onChange={(e) => update("nuit", e.target.value)} /></div>
                <div><label className="label">Cidade / província</label><input className="input" value={form.city} onChange={(e) => update("city", e.target.value)} /></div>
                <div className="sm:col-span-2">
                  <label className="label">Tamanho da equipa</label>
                  <select className="input" value={form.teamSize} onChange={(e) => update("teamSize", e.target.value)}>
                    <option value="">Seleccione</option>
                    <option>1–5 pessoas</option>
                    <option>6–20 pessoas</option>
                    <option>21–50 pessoas</option>
                    <option>Mais de 50 pessoas</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">O que pretende organizar primeiro?</label>
                  <textarea className="input min-h-24 resize-y py-3" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Orçamentos, cronograma, compras, medições..." />
                </div>
              </div>
            </fieldset>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input required type="checkbox" className="mt-1 h-4 w-4" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span className="text-xs leading-5 text-slate-600">
                <strong className="block text-sm text-slate-900">Confirmo que os dados estão correctos</strong>
                Autorizo o contacto da equipa SIGO para validar a subscrição e a implementação.
              </span>
            </label>
            <button disabled={!accepted || submitting} className="btn btn-primary w-full sm:w-auto">
              {submitting ? "A enviar..." : "Enviar pedido"}
            </button>
          </form>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_-18px_rgba(20,32,51,0.28)]">
            <div className="bg-ink px-5 py-5 text-white">
              <p className="text-[10px] font-display font-black uppercase tracking-[.14em] text-orange-300">Plano escolhido</p>
              <h2 className="mt-2 font-display text-2xl font-black">{plan.name}</h2>
              <p className="mt-2 text-sm text-slate-300">{plan.limits}</p>
            </div>
            <div className="p-5">
              <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Periodicidade da subscrição">
                <button type="button" onClick={() => changeBillingCycle("mensal")} className={`rounded-lg px-3 py-2.5 text-xs font-display font-black ${billingCycle === "mensal" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Mensal</button>
                <button type="button" onClick={() => changeBillingCycle("anual")} className={`rounded-lg px-3 py-2.5 text-xs font-display font-black ${billingCycle === "anual" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Anual · −15%</button>
              </div>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Subscrição {billingCycle}</dt><dd className="font-semibold tabular-nums">{formatMzn(totals.subtotal)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">IVA 16%</dt><dd className="font-semibold tabular-nums">{formatMzn(totals.iva)}</dd></div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-3"><dt className="font-bold">Total {billingCycle}</dt><dd className="font-display text-lg font-black tabular-nums">{formatMzn(totals.total)}</dd></div>
              </dl>
              <p className={`mt-4 rounded-lg px-3 py-2 text-xs font-semibold ${billingCycle === "anual" ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600"}`}>{billingCycle === "anual" ? "15% de desconto anual já incluído." : "Cobrança mensal, sem compromisso anual."}</p>
            </div>
          </section>
          <p className="px-2 text-center text-xs leading-5 text-slate-500">Dúvidas? {SIGO_CONTACT_EMAIL}</p>
        </aside>
      </main>
    </div>
  );
}
