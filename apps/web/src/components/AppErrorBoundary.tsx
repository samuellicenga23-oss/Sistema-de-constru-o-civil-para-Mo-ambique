import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "../monitoring";
import { recoverApplication } from "../releaseRecovery";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("SIGO UI error:", error, info.componentStack);
    captureException(error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface px-5">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-raised">
          <p className="font-display text-lg font-bold text-ink">Algo falhou ao carregar</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Não foi possível abrir esta página. Actualize a aplicação; o seu trabalho guardado não será apagado.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" className="btn btn-primary" onClick={() => void recoverApplication()}>
              Actualizar aplicação
            </button>
            <a href="/" className="btn btn-secondary">
              Ir ao início
            </a>
          </div>
        </div>
      </div>
    );
  }
}
