import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { roleLabel } from "./RoleBadge";
import { IconLogout } from "./icons";
import { useLanguage } from "../i18n";

function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Menu de perfil no cabeçalho: nome visível + Perfil e Sair em destaque. */
export default function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex max-w-[14rem] items-center gap-2 rounded-full border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:bg-slate-50 ${
          compact ? "h-10 w-10 justify-center p-0.5" : "h-10 pl-1.5 pr-3"
        }`}
        title={user.name}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${t("profile")}: ${user.name}`}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" draggable={false} className="h-7 w-7 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
            {initials(user.name)}
          </div>
        )}
        {!compact && (
          <span className="min-w-0 text-left">
            <span className="block truncate text-xs font-semibold text-slate-900">{user.name.split(" ")[0]}</span>
            <span className="block truncate text-[10px] text-slate-500">Perfil</span>
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg" role="menu">
          <div className="border-b border-slate-100 px-3 py-3">
            <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{roleLabel(user.role)}</p>
          </div>
          <Link
            to="/perfil"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            role="menuitem"
          >
            {t("profile")}
          </Link>
          <button
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
            role="menuitem"
          >
            <IconLogout className="h-4 w-4" />
            {t("logout")}
          </button>
        </div>
      )}
    </div>
  );
}
