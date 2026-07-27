import type { ReactNode } from "react";

// Estado vazio consistente — antes cada página escrevia o seu próprio bloco "ainda não há X"
// com estilos ligeiramente diferentes.
export default function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="py-10 px-4 text-center">
      <p className="text-gray-500 mb-1">{title}</p>
      {description && <p className="muted mb-3">{description}</p>}
      {action}
    </div>
  );
}
