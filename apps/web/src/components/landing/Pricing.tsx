import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon } from "lucide-react";
import { calculateVatTotals } from "@sigo/shared";
import { COMMERCIAL_PLANS, formatMzn } from "../../commercialPlans";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Card";

export function Pricing() {
  const [billingView, setBillingView] = useState<"mensal" | "anual">("mensal");

  return (
    <section id="planos" className="border-y border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-[1500px] px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Planos</Eyebrow>
          <h2 className="mt-3 font-display text-[32px] font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[42px]">
            Um SIGO completo.
            <span className="mt-1.5 block font-semibold text-ink-400">
              Pague pela escala da sua operação.
            </span>
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-400">
            Individual, equipa ou empresa — o fluxo da obra está em todos os planos.
            Os preços estão em meticais, com IVA incluído. No anual poupa 15% no valor mensal.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3">
            <div className="inline-flex rounded-xl border border-slate-200 bg-surface p-1">
              <button
                type="button"
                onClick={() => setBillingView("mensal")}
                className={`rounded-lg px-4 py-2 text-sm font-display font-bold transition ${
                  billingView === "mensal" ? "bg-ink text-white" : "text-ink-400 hover:text-ink"
                }`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setBillingView("anual")}
                className={`rounded-lg px-4 py-2 text-sm font-display font-bold transition ${
                  billingView === "anual" ? "bg-ink text-white" : "text-ink-400 hover:text-ink"
                }`}
              >
                Anual
              </button>
            </div>
            <p
              className={`text-[12.5px] font-semibold transition ${
                billingView === "anual" ? "text-teal-700" : "text-ink-400"
              }`}
            >
              {billingView === "anual"
                ? "15% de desconto no mensal · facturação anual"
                : "Mude para anual e poupe 15% no valor mensal"}
            </p>
          </div>
        </div>

        <div className="mt-12 grid items-start gap-5 lg:grid-cols-3">
          {COMMERCIAL_PLANS.map((plan) => {
            const monthlyWithVat = calculateVatTotals(plan.monthlyPrice).total;
            const annualWithVat = calculateVatTotals(plan.annualPrice).total;
            // Anual = 15% sobre o mensal (preço de catálogo); mostrar o mensal já descontado.
            const monthlyWithAnnualDiscount = monthlyWithVat * 0.85;
            const savingsPct = Math.round((1 - plan.annualPrice / plan.regularAnnualPrice) * 100);
            const displayAmount = billingView === "mensal" ? monthlyWithVat : monthlyWithAnnualDiscount;
            return (
              <div
                key={plan.slug}
                className={`relative flex h-full flex-col rounded-2xl border p-6 ${
                  plan.featured
                    ? "border-teal bg-white shadow-raised lg:-mt-3 lg:pb-8 lg:pt-8"
                    : "border-slate-200 bg-white shadow-card"
                }`}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-6 rounded-lg bg-teal px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white">
                    Recomendado
                  </span>
                )}
                <h3 className="font-display text-[20px] font-bold tracking-tight text-ink">{plan.name}</h3>
                <p className="mt-1.5 min-h-[42px] text-[13.5px] leading-snug text-ink-400">{plan.description}</p>
                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className="font-display text-[34px] font-bold leading-none tracking-tight text-ink">
                    {formatMzn(displayAmount).replace(" MZN", "").replace(",00", "")}
                  </span>
                  <span className="text-[13px] font-semibold text-ink-400">MZN</span>
                </p>
                <p className="mt-1 text-[12.5px] text-ink-400">
                  {billingView === "mensal"
                    ? `/mês com IVA`
                    : `/mês com ${savingsPct}% desconto · facturado ${formatMzn(annualWithVat)}/ano`}
                </p>
                <p className="mt-3 text-[12px] font-semibold text-brand-orange">{plan.limits}</p>

                <ul className="mt-6 flex-1 space-y-3 border-t border-slate-200 pt-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-ink">
                      <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link to={`/checkout/${plan.slug}`} className="mt-7">
                  <Button variant={plan.featured ? "primary" : "secondary"} fullWidth size="lg">
                    Escolher {plan.name}
                  </Button>
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-10 max-w-3xl text-center text-[13px] leading-relaxed text-ink-400">
          Precisa de mais importações ou plantas num mês pontual? No SIGO pode pedir{" "}
          <strong className="font-semibold text-ink">packs de créditos</strong> sem mudar de plano. Utilizadores e obras
          activas sobem com o plano.
        </p>
      </div>
    </section>
  );
}
