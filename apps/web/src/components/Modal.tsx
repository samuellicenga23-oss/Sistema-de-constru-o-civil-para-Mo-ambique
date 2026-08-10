import { useRef, type ReactNode, type MouseEvent } from "react";
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
  // Só fecha se o clique (mousedown+mouseup) começa e acaba no backdrop.
  // Evita fechar ao seleccionar texto num input e soltar o rato fora do cartão.
  const backdropPointerDown = useRef(false);

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    backdropPointerDown.current = event.target === event.currentTarget;
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (backdropPointerDown.current && event.target === event.currentTarget) {
      onClose();
    }
    backdropPointerDown.current = false;
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-2 sm:p-4"
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
      >
        <div
          className={`card w-full ${maxWidth} max-h-[94dvh] overflow-x-hidden overflow-y-auto overscroll-contain p-4 sm:p-6`}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
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
