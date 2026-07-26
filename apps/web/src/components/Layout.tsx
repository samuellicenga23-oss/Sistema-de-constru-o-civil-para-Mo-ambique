import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { companiesApi } from "../api/companies";
import { IconHome, IconFolder, IconTag, IconBuilding, IconLogout, IconSettings, IconRuler, IconUsers } from "./icons";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin_empresa: "Administrador",
  orcamentista: "Orçamentista",
  engenheiro_fiscal: "Engenheiro/Fiscal",
  visualizador: "Visualizador",
};

type NavItem = { to: string; label: string; icon: (p: { className?: string }) => ReactNode; exact?: boolean };

function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default function Layout({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (user?.companyId) {
      companiesApi
        .me()
        .then((data) => {
          setCompanyName(data.company.name);
          setLogoUrl(data.company.logoUrl);
        })
        .catch(() => {});
    }
  }, [user?.companyId]);

  const navItems: NavItem[] =
    user?.role === "super_admin"
      ? [{ to: "/admin", label: "Painel da Plataforma", icon: IconSettings }]
      : [
          { to: "/", label: "Painel", icon: IconHome, exact: true },
          { to: "/projectos", label: "Projectos e Orçamentos", icon: IconFolder },
          { to: "/catalogo", label: "Catálogo de Preços", icon: IconTag },
          { to: "/fornecedores", label: "Fornecedores", icon: IconUsers },
          { to: "/calculos-rapidos", label: "Cálculos Rápidos", icon: IconRuler },
          ...(user?.role === "admin_empresa" ? [{ to: "/empresa", label: "Definições da Empresa", icon: IconBuilding }] : []),
        ];

  function isActive(item: NavItem) {
    if (item.exact) return location.pathname === item.to;
    return location.pathname === item.to || location.pathname.startsWith(item.to + "/");
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-gradient-to-b from-brand-950 to-brand-900 text-white">
        <div className="px-5 py-6 border-b border-white/10">
          {logoUrl ? (
            <div className="bg-white rounded-lg p-2 inline-block mb-2">
              <img src={logoUrl} alt={companyName ?? "Logótipo"} className="h-8 object-contain" />
            </div>
          ) : (
            <p className="text-xl font-bold tracking-tight">
              SIG<span className="text-brand-300">O</span>
            </p>
          )}
          {companyName && <p className="text-xs text-brand-300 mt-1 truncate">{companyName}</p>}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-white/15 text-white shadow-sm" : "text-brand-200 hover:bg-white/8 hover:text-white"
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <Link to="/perfil" className="flex items-center gap-3 min-w-0 flex-1 group">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-sm font-semibold shrink-0">
                  {initials(user?.name)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate group-hover:underline">{user?.name}</p>
                <p className="text-[11px] text-brand-300">{user ? ROLE_LABELS[user.role] : ""}</p>
              </div>
            </Link>
            <button onClick={() => logout()} title="Sair" className="text-brand-300 hover:text-white transition-colors">
              <IconLogout className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barra móvel (ecrãs pequenos, sem sidebar) */}
        <div className="md:hidden bg-brand-950 text-white px-4 py-3 flex items-center justify-between">
          <p className="font-bold">
            SIG<span className="text-brand-300">O</span>
          </p>
          <div className="flex gap-3 text-xs overflow-x-auto">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to} className={isActive(item) ? "text-white font-semibold" : "text-brand-300"}>
                {item.label.split(" ")[0]}
              </Link>
            ))}
            <Link to="/perfil" className={location.pathname === "/perfil" ? "text-white font-semibold" : "text-brand-300"}>
              Perfil
            </Link>
            <button onClick={() => logout()} className="text-brand-300">
              Sair
            </button>
          </div>
        </div>

        <header className="bg-white border-b border-gray-200 px-5 md:px-8 py-4 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-gray-900 truncate">{title}</h1>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </header>

        <main className="flex-1 p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
