// Estado de carregamento consistente — substitui o "A carregar..." repetido inline em cada
// página (encontrado em pelo menos 6 páginas com markup ligeiramente diferente).
export default function LoadingState({ label = "A carregar...", fullScreen = false }: { label?: string; fullScreen?: boolean }) {
  return (
    <div className={`flex items-center justify-center text-gray-400 text-sm ${fullScreen ? "min-h-screen" : "min-h-[200px]"}`}>
      {label}
    </div>
  );
}
