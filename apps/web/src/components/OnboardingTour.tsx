import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import ModalPortal from "./ModalPortal";
import { canSeeGestao } from "../permissions";

type TourStep = {
  id: string;
  title: string;
  body: string;
  route?: string;
  target?: string;
};

const STORAGE_PREFIX = "sigo-onboarding-v1:";

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

function buildSteps(opts: {
  includeGestao: boolean;
  includeMedicoes: boolean;
  includeOrcamentos: boolean;
}): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome",
      title: "Bem-vindo ao SIGO",
      body: "Esta visita rápida mostra as áreas principais. Pode saltar a qualquer momento e voltar ao perfil quando quiser.",
    },
    {
      id: "painel",
      title: "Painel",
      body: "O ponto de partida: resumo da empresa, alertas e atalhos para o que precisa de atenção.",
      route: "/painel",
      target: "nav-painel",
    },
  ];
  if (opts.includeMedicoes) {
    steps.push({
      id: "medicoes",
      title: "Medições",
      body: "Aqui cria e gere mapas de quantidades — a partir de plantas, importação ou medição manual.",
      route: "/medicoes",
      target: "nav-medicoes",
    });
  }
  if (opts.includeOrcamentos) {
    steps.push({
      id: "orcamentos",
      title: "Orçamentos",
      body: "Transforme medições em propostas com preços, composições e margem.",
      route: "/orcamentos",
      target: "nav-orcamentos",
    });
  }
  if (opts.includeGestao) {
    steps.push({
      id: "gestao",
      title: "Gestão de obras",
      body: "Cronograma, compras, stock, diário e financeiro das obras em execução.",
      route: "/gestao",
      target: "nav-gestao",
    });
  }
  steps.push({
    id: "perfil",
    title: "O seu perfil",
    body: "Pode actualizar o nome, fotografia ou palavra-passe quando quiser — não é obrigatório na primeira entrada.",
    route: "/perfil",
    target: "nav-perfil",
  });
  return steps;
}

export default function OnboardingTour() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const steps = useMemo(
    () =>
      buildSteps({
        includeGestao: Boolean(user && canSeeGestao(user)),
        includeMedicoes: Boolean(user?.enabledModules.includes("measurements")),
        includeOrcamentos: Boolean(user?.enabledModules.includes("budgets")),
      }),
    [user],
  );
  const step = steps[stepIndex];

  useEffect(() => {
    if (!user || user.role === "super_admin") return;
    if (isOnboardingComplete(user.id)) return;
    setOpen(true);
    setStepIndex(0);
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!open || !step) return;
    if (step.route && location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [open, step?.id, step?.route, location.pathname, navigate]);

  useEffect(() => {
    if (!open || !step?.target) {
      setTargetRect(null);
      return;
    }
    function measure() {
      const el = document.querySelector(`[data-tour="${step!.target}"]`);
      setTargetRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    const timer = window.setTimeout(measure, 180);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step?.id, step?.target, location.pathname]);

  if (!user || !open || !step) return null;

  function finish() {
    markOnboardingComplete(user!.id);
    setOpen(false);
    if (location.pathname !== "/painel") navigate("/painel");
  }

  function next() {
    if (stepIndex >= steps.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function back() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  const pad = 8;
  const hole = targetRect
    ? {
        top: Math.max(0, targetRect.top - pad),
        left: Math.max(0, targetRect.left - pad),
        width: targetRect.width + pad * 2,
        height: targetRect.height + pad * 2,
      }
    : null;

  const cardStyle: CSSProperties = hole
    ? {
        position: "fixed",
        top: Math.min(hole.top + hole.height + 12, window.innerHeight - 260),
        left: Math.min(Math.max(16, hole.left), window.innerWidth - 360),
        width: "min(22rem, calc(100vw - 2rem))",
        zIndex: 62,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(26rem, calc(100vw - 2rem))",
        zIndex: 62,
      };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <mask id="onboarding-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {hole && (
                <rect
                  x={hole.left}
                  y={hole.top}
                  width={hole.width}
                  height={hole.height}
                  rx="12"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="rgba(15, 23, 42, 0.55)" mask="url(#onboarding-mask)" />
        </svg>
        {hole && (
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-accent ring-offset-2 ring-offset-transparent"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          />
        )}

        <div className="card border border-slate-200 p-5 shadow-xl" style={cardStyle}>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            Tour · {stepIndex + 1} de {steps.length}
          </p>
          <h2 id="onboarding-title" className="mt-1 text-lg font-bold text-slate-900">{step.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>
              Saltar tour
            </button>
            <div className="flex gap-2">
              {stepIndex > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={back}>
                  Anterior
                </button>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={next}>
                {stepIndex >= steps.length - 1 ? "Começar a trabalhar" : "Seguinte"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
