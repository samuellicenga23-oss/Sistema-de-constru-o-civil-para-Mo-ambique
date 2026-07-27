// Erro consistente, com hipótese de tentar de novo — antes cada página mostrava só um
// <p className="text-red-600"> solto, sem forma de recuperar sem recarregar a página inteira.
export default function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card card-pad border-red-200 bg-red-50 text-center">
      <p className="text-sm text-red-700 mb-2">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn btn-secondary btn-sm">
          Tentar novamente
        </button>
      )}
    </div>
  );
}
