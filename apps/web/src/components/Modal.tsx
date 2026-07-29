import type { ReactNode } from "react";
import ModalPortal from "./ModalPortal";

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = "max-w-lg",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-2 sm:p-4" onClick={onClose}>
      <div
        className={`card w-full ${maxWidth} max-h-[94dvh] overflow-x-hidden overflow-y-auto overscroll-contain p-4 sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="icon-btn shrink-0" title="Fechar" aria-label="Fechar janela">
            ✕
          </button>
        </div>
        {children}
      </div>
      </div>
    </ModalPortal>
  );
}
