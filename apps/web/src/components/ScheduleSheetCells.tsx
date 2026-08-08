import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ScheduleTaskStatus } from "../api/schedule";

export const STATUS_LABELS: Record<ScheduleTaskStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_curso: "Em curso",
  bloqueado: "Bloqueado",
  concluido: "Concluído",
};

export const STATUS_PILL: Record<ScheduleTaskStatus, string> = {
  nao_iniciado: "bg-slate-100 text-slate-600",
  em_curso: "bg-brand-50 text-brand-700",
  bloqueado: "bg-red-50 text-red-700",
  concluido: "bg-emerald-50 text-emerald-700",
};

export function fmtDate(value: string) {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function CellInput({
  value,
  type = "text",
  step,
  onCommit,
  onCancel,
}: {
  value: string;
  type?: string;
  step?: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type={type}
      step={step}
      className="h-7 w-full rounded border border-blue-400 bg-white px-1.5 text-[12px] outline-none ring-2 ring-blue-100"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export function SheetCell({
  children,
  onEdit,
  align = "left",
  className = "",
  rowH = 36,
}: {
  children: ReactNode;
  onEdit?: () => void;
  align?: "left" | "right";
  className?: string;
  rowH?: number;
}) {
  return (
    <td
      className={`border-b border-slate-100 px-2 align-middle ${align === "right" ? "text-right" : "text-left"} ${onEdit ? "cursor-text" : ""} ${className}`}
      style={{ height: rowH }}
      onDoubleClick={onEdit}
    >
      {children}
    </td>
  );
}
