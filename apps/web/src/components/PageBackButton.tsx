import { useNavigate } from "react-router-dom";
import { IconBack } from "./icons";

/** Volta à página anterior do histórico; se não houver, usa o fallback. */
export default function PageBackButton({
  label = "Voltar",
  fallbackTo,
  className = "btn btn-ghost btn-sm",
}: {
  label?: string;
  fallbackTo: string;
  className?: string;
}) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.history.length > 1) navigate(-1);
        else navigate(fallbackTo);
      }}
    >
      <IconBack className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
