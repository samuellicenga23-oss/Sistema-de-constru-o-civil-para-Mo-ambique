import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CREDIT_PACKS,
  SUBSCRIPTION_PLANS,
  calculateVatTotals,
  type CreditPack,
} from "@sigo/shared";
import { request } from "../api/http";
import { SIGO_WHATSAPP_NUMBER, formatMzn, formatPlanPriceWithVat } from "../commercialPlans";
import Layout from "../components/Layout";
import AlertBanner from "../components/AlertBanner";

type EntitlementsSummary = {
  planKey: string;
  planLabel: string;
  status: string;
  expired: boolean;
  isTrial: boolean;
  maxUsers: number | null;
  maxActiveProjects: number | null;
  customCompositions: number | null;
  smartImportsPerMonth: number | null;
  plantAnalysesPerMonth: number | null;
  usage: {
    activeProjects: number;
    smartImportsUsed: number;
    plantAnalysesUsed: number;
    customCompositions: number;
  } | null;
  credits: {
    smartImportCredits: number;
    plantAnalysisCredits: number;
  } | null;
};

function packWhatsApp(pack: CreditPack) {
  const text = encodeURIComponent(
    `Olá — quero o pack SIGO «${pack.label}» (${pack.smartImports} importações · ${pack.plantAnalyses} plantas) por ${pack.priceMzn} MZN + IVA.`,
  );
  return `https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${text}`;
}

function planWhatsApp(planLabel: string) {
  const text = encodeURIComponent(`Olá — quero activar / mudar para o plano SIGO ${planLabel}.`);
  return `https://wa.me/${SIGO_WHATSAPP_NUMBER}?text=${text}`;
}

function Meter({
  label,
  used,
  included,
  extra,
}: {
  label: string;
  used: number;
  included: number | null;
  extra?: number;
}) {
  const max = included == null ? null : included + (extra ?? 0);
  const pct = max && max > 0 ? Math.min(100, Math.round((used / max) * 100)) : null;
  const atLimit = max != null && used >= max;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span className={atLimit ? "font-semibold text-amber-800" : ""}>
          {used}
          {included != null ? ` / ${included}` : ""}
          {extra ? ` (+${extra} créditos)` : ""}
        </span>
      </div>
      {pct != null ? (
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${atLimit ? "bg-amber-500" : "bg-brand-600"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <p className="text-xs text-slate-500">Ilimitado no seu plano</p>
      )}
    </div>
  );
}

export default function CreditsPage() {
  const [params] = useSearchParams();
  const foco = params.get("foco") ?? "";
  const [ent, setEnt] = useState<EntitlementsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<EntitlementsSummary>("/companies/me/entitlements")
      .then(setEnt)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível carregar o plano."));
  }, []);

  const highlightImports = foco === "importacoes";
  const highlightPlants = foco === "plantas";
  const highlightPlan = foco === "plano";

  const recommendedPackIds = useMemo(() => {
    if (highlightImports) return new Set(["imports_10", "imports_30", "misto_15"]);
    if (highlightPlants) return new Set(["plants_10", "plants_30", "misto_15"]);
    return new Set(CREDIT_PACKS.filter((p) => p.featured).map((p) => p.id));
  }, [highlightImports, highlightPlants]);

  return (
    <Layout title="Créditos e planos" subtitle="Packs extra e upgrade de capacidade">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <header className="space-y-2">
          <p className="max-w-2xl text-sm text-slate-600">
            Quando esgota as importações ou plantas do mês, compre créditos extra. Para mais utilizadores, obras ou
            composições, mude de plano — a equipa SIGO activa após confirmação do pagamento.
          </p>
        </header>

        {error && <AlertBanner tone="error">{error}</AlertBanner>}

        {ent && (
          <section className="card card-pad space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="section-title">Utilização actual</h2>
                <p className="text-sm text-slate-600">
                  Plano <strong>{ent.planLabel}</strong>
                  {ent.isTrial ? " · trial" : ""}
                  {ent.expired ? " · expirado" : ""}
                </p>
              </div>
              <Link to="/empresa?tab=subscricao" className="btn btn-secondary btn-sm">
                Definições da empresa
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Meter
                label="Importações este mês"
                used={ent.usage?.smartImportsUsed ?? 0}
                included={ent.smartImportsPerMonth}
                extra={ent.credits?.smartImportCredits}
              />
              <Meter
                label="Plantas este mês"
                used={ent.usage?.plantAnalysesUsed ?? 0}
                included={ent.plantAnalysesPerMonth}
                extra={ent.credits?.plantAnalysisCredits}
              />
              <Meter label="Obras activas" used={ent.usage?.activeProjects ?? 0} included={ent.maxActiveProjects} />
              <Meter
                label="Composições próprias"
                used={ent.usage?.customCompositions ?? 0}
                included={ent.customCompositions}
              />
            </div>
            <p className="text-xs text-slate-500">
              Créditos em saldo: <strong>{ent.credits?.smartImportCredits ?? 0}</strong> importações ·{" "}
              <strong>{ent.credits?.plantAnalysisCredits ?? 0}</strong> plantas (não expiram no fim do mês — consomem-se
              ao usar).
            </p>
          </section>
        )}

        <section className="space-y-4">
          <div>
            <h2 className="section-title">Packs de créditos</h2>
            <p className="text-sm text-slate-600">
              Preços com IVA. Pedido via WhatsApp — o super-admin confirma o pagamento e carrega o saldo.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CREDIT_PACKS.map((pack) => {
              const withVat = calculateVatTotals(pack.priceMzn).total;
              const recommended = recommendedPackIds.has(pack.id) || pack.featured;
              return (
                <div
                  key={pack.id}
                  className={`card card-pad flex flex-col ${
                    recommended ? "border-teal-300 ring-1 ring-teal-200" : ""
                  } ${highlightImports && pack.smartImports > 0 && pack.plantAnalyses === 0 ? "border-amber-300" : ""} ${
                    highlightPlants && pack.plantAnalyses > 0 && pack.smartImports === 0 ? "border-amber-300" : ""
                  }`}
                >
                  {(recommended || pack.featured) && (
                    <span className="mb-2 self-start rounded-md bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {pack.featured ? "Recomendado" : "Sugestão"}
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-slate-950">{pack.label}</h3>
                  <p className="mt-1 flex-1 text-sm text-slate-600">{pack.description}</p>
                  <p className="mt-4 font-display text-2xl font-bold tabular-nums text-slate-950">
                    {formatMzn(withVat).replace(",00", "")}
                  </p>
                  <p className="text-xs text-slate-500">com IVA · líquido {formatMzn(pack.priceMzn)}</p>
                  <a href={packWhatsApp(pack)} target="_blank" rel="noreferrer" className="btn btn-primary mt-4 w-full">
                    Pedir este pack
                  </a>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`space-y-4 ${highlightPlan ? "rounded-2xl ring-2 ring-amber-300 p-4" : ""}`}>
          <div>
            <h2 className="section-title">Mudar de plano</h2>
            <p className="text-sm text-slate-600">
              Utilizadores, obras activas e composições próprias sobem com o plano — não com packs de créditos.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {SUBSCRIPTION_PLANS.filter((p) => p.key !== "enterprise" && p.monthlyPriceMzn != null).map((plan) => (
              <div key={plan.key} className={`card card-pad ${plan.featured ? "border-teal-300" : ""}`}>
                <h3 className="font-semibold text-slate-950">{plan.label}</h3>
                <p className="mt-1 text-xs text-slate-500">{plan.audience}</p>
                <p className="mt-3 text-lg font-bold tabular-nums">
                  {formatPlanPriceWithVat(plan.monthlyPriceMzn!)}
                  <span className="text-sm font-normal text-slate-500"> /mês</span>
                </p>
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {plan.features.slice(0, 4).map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
                <a href={planWhatsApp(plan.label)} target="_blank" rel="noreferrer" className="btn btn-secondary mt-4 w-full btn-sm">
                  Pedir {plan.label}
                </a>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Enterprise e condições especiais:{" "}
            <a className="font-semibold text-brand-800 hover:underline" href={planWhatsApp("Enterprise")}>
              contacte a equipa SIGO
            </a>
            .
          </p>
        </section>
      </div>
    </Layout>
  );
}
