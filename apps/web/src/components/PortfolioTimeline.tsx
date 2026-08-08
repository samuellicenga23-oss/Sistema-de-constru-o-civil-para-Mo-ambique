import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SiteManagementOverview } from "../api/boq";
import { IconMap } from "./icons";

const STATUS_STYLE: Record<string, { bar: string; label: string }> = {
  concluido: { bar: "bg-emerald-500", label: "Concluída" },
  em_curso: { bar: "bg-brand-500", label: "Em curso" },
  bloqueado: { bar: "bg-red-500", label: "Bloqueada" },
  nao_iniciado: { bar: "bg-slate-300", label: "Não iniciada" },
};

function toDayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function monthLabel(iso: string): string {
  return new Intl.DateTimeFormat("pt-MZ", { month: "short", year: "2-digit" }).format(new Date(`${iso}T00:00:00Z`));
}

export default function PortfolioTimeline({ items }: { items: SiteManagementOverview[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const withSchedule = useMemo(
    () => items.filter((item) => item.schedule.startDate && item.schedule.endDate && item.schedule.phases.length > 0),
    [items],
  );

  const range = useMemo(() => {
    if (!withSchedule.length) return null;
    const starts = withSchedule.map((i) => i.schedule.startDate!);
    const ends = withSchedule.map((i) => i.schedule.endDate!);
    const minStart = starts.reduce((min, d) => (d < min ? d : min));
    const maxEnd = ends.reduce((max, d) => (d > max ? d : max));
    const todayIso = new Date().toISOString().slice(0, 10);
    const rangeStart = minStart < todayIso ? minStart : addMonths(todayIso, -1);
    const rangeEnd = maxEnd > todayIso ? maxEnd : addMonths(todayIso, 1);
    const startDay = toDayNumber(rangeStart);
    const endDay = toDayNumber(rangeEnd);
    const totalDays = Math.max(1, endDay - startDay);

    const months: string[] = [];
    let cursor = `${rangeStart.slice(0, 7)}-01`;
    while (cursor <= rangeEnd) {
      months.push(cursor);
      cursor = addMonths(cursor, 1);
    }

    return { rangeStart, rangeEnd, startDay, totalDays, months, todayIso };
  }, [withSchedule]);

  if (!range || withSchedule.length === 0) return null;

  function pct(dateIso: string): number {
    const day = toDayNumber(dateIso);
    return Math.max(0, Math.min(100, ((day - range!.startDay) / range!.totalDays) * 100));
  }

  const todayPct = pct(range.todayIso);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-200 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <IconMap className="h-4 w-4 text-brand-700" />
          <div>
            <h2 className="section-title text-base">Linha do tempo das obras</h2>
            <p className="mt-0.5 text-xs text-slate-500">Fases do cronograma de cada obra, lado a lado — hoje marcado a laranja.</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px] p-4 sm:p-5">
          {/* Eixo de meses */}
          <div className="relative mb-2 h-5 border-b border-slate-200 pl-40 text-[10px] text-slate-400 sm:pl-48">
            {range.months.map((m) => (
              <span
                key={m}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `calc(10rem + ${pct(m)}% * (100% - 10rem) / 100)` }}
              >
                {monthLabel(m)}
              </span>
            ))}
          </div>

          <ul className="space-y-3">
            {withSchedule.map((item) => (
              <li key={item.projectId} className="flex items-center gap-3">
                <Link
                  to={`/projectos/${item.projectId}/cronograma?fase=gestao`}
                  className="w-40 shrink-0 truncate text-xs font-medium text-slate-700 hover:text-brand-700 sm:w-48"
                  title={item.projectName}
                >
                  {item.projectName}
                </Link>
                <div className="relative h-6 flex-1 rounded-md bg-slate-50">
                  {/* linha de "hoje" */}
                  <div
                    className="absolute top-0 z-10 h-full w-px bg-orange-500"
                    style={{ left: `${todayPct}%` }}
                    aria-hidden="true"
                  />
                  {item.schedule.phases.map((phase) => {
                    const left = pct(phase.startDate);
                    const right = pct(phase.endDate);
                    const width = Math.max(0.8, right - left);
                    const style = STATUS_STYLE[phase.status] ?? STATUS_STYLE.nao_iniciado;
                    const key = `${item.projectId}-${phase.id}`;
                    return (
                      <Link
                        key={key}
                        to={`/projectos/${item.projectId}/cronograma?fase=gestao`}
                        onMouseEnter={() => setHovered(key)}
                        onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                        className={`group absolute top-0.5 h-5 rounded ${style.bar} opacity-80 transition hover:opacity-100`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        {hovered === key && (
                          <span className="absolute bottom-full left-0 z-20 mb-1 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg">
                            {phase.name} · {style.label} · {phase.progress.toFixed(0)}%
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            {Object.entries(STATUS_STYLE).map(([key, s]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${s.bar}`} />
                {s.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-px bg-orange-500" />
              Hoje
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
