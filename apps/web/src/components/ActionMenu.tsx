import { useEffect, useRef, useState, type ReactNode } from "react";

export type ActionMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
};

export default function ActionMenu({
  label = "Mais acções",
  items,
  align = "right",
}: {
  label?: string;
  items: ActionMenuItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-secondary btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <span className="text-[10px] opacity-60" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {visible.map((item) => {
            const className = `flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50 ${
              item.danger ? "text-red-700 hover:bg-red-50" : "text-slate-700"
            }`;
            if (item.href) {
              return (
                <a key={item.id} href={item.href} role="menuitem" className={className} onClick={() => setOpen(false)}>
                  {item.icon}
                  {item.label}
                </a>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={className}
                onClick={() => {
                  item.onClick?.();
                  setOpen(false);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
