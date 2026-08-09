import { Link } from "react-router-dom";
import type { ProjectWorkflowStatus } from "../api/boq";

const TONE: Record<string, string> = {
  info: "border-brand-200 bg-brand-50 text-brand-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  error: "border-red-200 bg-red-50 text-red-950",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-950",
};

const PRIORITY = { error: 0, warning: 1, info: 2 } as const;

function WorkflowAction({ action }: { action: ProjectWorkflowStatus["guidance"][number]["actions"][number] }) {
  if (action.path) return <Link to={action.path} className="btn btn-secondary btn-sm !text-xs">{action.label}</Link>;
  if (action.anchor) return <a href={`#${action.anchor}`} className="btn btn-secondary btn-sm !text-xs">{action.label}</a>;
  return null;
}

export default function ProjectWorkflowBanner({
  status,
}: {
  status: ProjectWorkflowStatus | null;
  projectId: string;
}) {
  if (!status) return null;

  const items = [...status.guidance].sort((a, b) => PRIORITY[a.severity] - PRIORITY[b.severity]);
  const primary = items[0] ?? null;
  const remaining = items.slice(1);
  const modeLabel = status.control.mode === "automatico" ? "Automático" : status.control.mode === "assistido" ? "Requer confirmação" : "Bloqueado";

  return (
    <section className={`rounded-xl border px-4 py-3 xl:col-span-2 ${TONE[primary?.severity ?? "ready"]}`} aria-label="Controlo operacional do projecto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">SIGO Control</span>
            <span className="badge badge-gray">{status.control.score}%</span>
            <span className="text-[11px] font-semibold opacity-70">{modeLabel}</span>
            {remaining.length > 0 && <span className="badge badge-gray">+{remaining.length}</span>}
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{primary?.title ?? "Fluxo operacional validado"}</p>
          {primary && <p className="mt-0.5 line-clamp-1 text-xs opacity-75">{primary.message}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {primary?.actions.slice(0, 2).map((action) => <WorkflowAction key={action.label} action={action} />)}
        </div>
      </div>

      <div className="mt-3 flex gap-1" aria-label={`${status.control.completed} de ${status.control.total} etapas concluídas`}>
        {status.control.checks.map((check) => (
          <div
            key={check.id}
            title={`${check.label}: ${check.status}`}
            className={`h-1.5 min-w-4 flex-1 rounded-full ${check.status === "concluido" ? "bg-emerald-500" : check.status === "bloqueado" ? "bg-red-500" : check.status === "actual" ? "bg-brand-600" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {remaining.length > 0 && (
        <details className="mt-2 border-t border-current/10 pt-2">
          <summary className="cursor-pointer text-xs font-semibold opacity-75">Ver outras verificações</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {remaining.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-md bg-white/55 px-2.5 py-2 text-xs">
                <span className="truncate font-medium">{item.title}</span>
                {item.actions[0] && <WorkflowAction action={item.actions[0]} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
