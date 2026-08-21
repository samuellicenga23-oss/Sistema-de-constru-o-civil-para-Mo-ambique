import type { ReactNode } from "react";

/** Barra de acções fixa no fundo em ecrãs estreitos (edição de orçamento/medições). */
export default function MobileStickyActionBar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`mobile-sticky-action-bar fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:static sm:inset-auto sm:z-auto sm:rounded-lg sm:border sm:border-brand-200 sm:bg-brand-50 sm:px-3 sm:py-2 sm:shadow-none ${className}`}
      role="toolbar"
      aria-label="Acções de edição"
    >
      {children}
    </div>
  );
}
