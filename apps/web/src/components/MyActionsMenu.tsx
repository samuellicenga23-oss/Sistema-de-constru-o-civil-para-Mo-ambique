import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { workflowTasksApi, type WorkflowTask } from "../api/projectTeam";
import { useDataSaverPollingInterval } from "../hooks/useDataSaverPolling";

const POLL_BASE_MS = 60_000;

export default function MyActionsMenu() {
  const navigate = useNavigate();
  const pollMs = useDataSaverPollingInterval(POLL_BASE_MS);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WorkflowTask[]>([]);
  const [count, setCount] = useState(0);

  async function reload() {
    try {
      const res = await workflowTasksApi.listMine();
      setItems(res.items.slice(0, 8));
      setCount(res.pendingCount);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void reload();
    const id = window.setInterval(reload, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs]);

  return (
    <div className="relative">
      <button
        type="button"
        className="btn btn-ghost btn-sm relative"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void reload();
        }}
        title="Minhas acções"
      >
        Acções
        {count > 0 && (
          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Fechar" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Minhas acções</p>
              <span className="badge badge-brand">{count}</span>
            </div>
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Sem acções pendentes.</p>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {items.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-slate-50"
                      onClick={() => {
                        setOpen(false);
                        if (task.link) navigate(task.link);
                      }}
                    >
                      <span className="text-sm font-semibold text-slate-900">{task.title}</span>
                      <span className="truncate text-xs text-slate-500">
                        {task.projectNameSnapshot ?? "Obra"}
                        {task.kind === "correction" ? " · Correcção" : " · Aprovação"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-slate-100 px-3 py-2">
              <Link to="/painel" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setOpen(false)}>
                Ver no painel
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
