import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import ModalPortal from "./ModalPortal";
import { canSeeGestao } from "../permissions";

type TourStep = {
  id: string;
  title: string;
  body: string;
  bullets?: string[];
  ctaLabel?: string;
  ctaTo?: string;
};

const STORAGE_PREFIX = "sigo-onboarding-v2:";

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function isOnboardingComplete(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "done";
  } catch {
    return true;
  }
}

export function markOnboardingComplete(userId: string) {
  try {
    window.localStorage.setItem(storageKey(userId), "done");
  } catch {
    /* ignore quota / private mode */
  }
}

/** Limpa tours antigas (v1) e marca a nova como por fazer. */
export function resetOnboarding(userId: string) {
  try {
    window.localStorage.removeItem(`sigo-onboarding-v1:${userId}`);
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

function buildSteps(opts: {
  includeMedicoes: boolean;
  includeOrcamentos: boolean;
  includeGestao: boolean;
}): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome",
      title: "Bem-vindo ao SIGO",
      body: "O SIGO acompanha a obra do preço ao resultado. Em poucos minutos vê o fluxo principal — pode saltar e voltar depois em Perfil.",
      bullets: [
        "1. Medir — quantidades e plantas",
        "2. Orçamentar — preços e propostas",
        "3. Gerir a obra — cronograma, compras e execução",
      ],
    },
  ];

  if (opts.includeMedicoes) {
    steps.push({
      id: "medicoes",
      title: "1. Medições",
      body: "Comece aqui. Crie o mapa de quantidades da obra a partir de plantas, Excel ou medição manual.",
      bullets: [
        "Crie uma obra e escolha o modo de medição",
        "Revise quantidades e submeta para aprovação",
        "A medição aprovada alimenta o orçamento",
      ],
      ctaLabel: "Ir a Medições",
      ctaTo: "/medicoes",
    });
  }

  if (opts.includeOrcamentos) {
    steps.push({
      id: "orcamentos",
      title: "2. Orçamentos",
      body: "Com a medição pronta, transforme as quantidades numa proposta com composições, margem e preço de venda.",
      bullets: [
        "Crie o orçamento a partir da medição aprovada",
        "Ligue itens ao catálogo ou ajuste preços",
        "Submeta e aprove antes de planear a obra",
      ],
      ctaLabel: "Ir a Orçamentos",
      ctaTo: "/orcamentos",
    });
  }

  if (opts.includeGestao) {
    steps.push({
      id: "gestao",
      title: "3. Gestão da obra",
      body: "Depois do orçamento aprovado, a obra passa para o campo: cronograma, compras, stock, diário e financeiro.",
      bullets: [
        "Planeie o cronograma a partir do orçamento",
        "Compre materiais com RFQ e recepção em stock",
        "Acompanhe execução, autos e facturação",
      ],
      ctaLabel: "Ir à Gestão",
      ctaTo: "/gestao",
    });
  }

  steps.push({
    id: "ready",
    title: "Pronto a trabalhar",
    body: "Pode começar já no Painel. A palavra-passe pode ser alterada em Perfil quando quiser — não é obrigatório agora.",
    bullets: [
      "Painel — resumo e alertas",
      "Perfil — dados, preferências e segurança",
      "Pode repetir esta introdução em Perfil → Preferências",
    ],
  });

  return steps;
}

export default function OnboardingTour() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = useMemo(
    () =>
      buildSteps({
        includeMedicoes: Boolean(user?.enabledModules.includes("measurements")),
        includeOrcamentos: Boolean(user?.enabledModules.includes("budgets")),
        includeGestao: Boolean(user && canSeeGestao(user)),
      }),
    [user],
  );
  const step = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;

  useEffect(() => {
    if (!user || user.role === "super_admin") return;
    if (isOnboardingComplete(user.id)) return;
    setOpen(true);
    setStepIndex(0);
  }, [user?.id, user?.role]);

  if (!user || !open || !step) return null;

  function finish(goTo?: string) {
    markOnboardingComplete(user!.id);
    setOpen(false);
    if (goTo) navigate(goTo);
    else if (window.location.pathname !== "/painel") navigate("/painel");
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/55 p-3 sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <div className="card w-full max-w-lg border border-slate-200 p-5 shadow-2xl sm:p-6">
          <div className="mb-4 flex items-center gap-1.5" aria-hidden>
            {steps.map((s, index) => (
              <span
                key={s.id}
                className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? "bg-brand-600" : "bg-slate-200"}`}
              />
            ))}
          </div>

          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            Introdução · {stepIndex + 1} de {steps.length}
          </p>
          <h2 id="onboarding-title" className="mt-1 text-xl font-bold text-slate-900">
            {step.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>

          {step.bullets && step.bullets.length > 0 && (
            <ul className="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              {step.bullets.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="btn btn-ghost btn-sm order-3 sm:order-1" onClick={() => finish()}>
              Saltar
            </button>
            <div className="order-1 flex flex-wrap gap-2 sm:order-2 sm:justify-end">
              {stepIndex > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStepIndex((i) => i - 1)}>
                  Anterior
                </button>
              )}
              {step.ctaTo && step.ctaLabel && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => finish(step.ctaTo)}>
                  {step.ctaLabel}
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={next}>
                {isLast ? "Começar no Painel" : "Seguinte"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
