import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { roleLabel } from "./RoleBadge";
import { IconLogout } from "./icons";

function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Menu do perfil no cabeçalho — pedido explícito do documento da Fase 1 (Prioridade 5:
// "Menu do perfil" como elemento do layout, disponível em qualquer página, não só na barra
// lateral). Fecha ao clicar fora.
export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2" title={user.name}>
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-800 flex items-center justify-center text-xs font-semibold">
            {initials(user.name)}
          </div>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 card p-1 z-20 shadow-lg">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
            <p className="muted">{roleLabel(user.role)}</p>
          </div>
          <Link to="/perfil" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md">
            Perfil
          </Link>
          <button
            onClick={() => logout()}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md flex items-center gap-2"
          >
            <IconLogout className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
