import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { companiesApi } from "../api/companies";
import UserMenu from "./UserMenu";
import InstallAppButton from "./InstallAppButton";
import OfflineBanner from "./OfflineBanner";
import { IconHome, IconFolder, IconTag, IconBuilding, IconLogout, IconSettings, IconRuler, IconUsers, IconMenu, IconClose } from "./icons";

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Fecha o menu lateral móvel sempre que a rota muda (navegar por um link não o deixa aberto
  // por cima do ecrã seguinte).
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

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
          { to: "/painel", label: "Painel", icon: IconHome, exact: true },
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

  // Barra inferior móvel: só os módulos principais (máx. 5, para caberem sem apertar) — o resto
  // fica no menu recolhível (hamburger). Antes a "navegação móvel" era só uma tira horizontal
  // com scroll, sem hierarquia entre módulos principais e secundários.
  const bottomBarItems = navItems.slice(0, 5);

  return (
    <div className="min-h-screen flex bg-[#f5f6f8]">
      {/* Sidebar */}
      <aside className={`hidden md:flex shrink-0 flex-col border-r border-slate-200 bg-[#f8f8f9] text-slate-700 transition-[width] duration-200 ${sidebarCollapsed ? "w-[4.5rem]" : "w-60"}`}>
        <div className={`flex h-16 items-center border-b border-slate-200 ${sidebarCollapsed ? "justify-center px-2" : "justify-between px-3"}`}>
          {logoUrl ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white p-1.5">
                <img src={logoUrl} alt={companyName ?? "Logótipo"} className="max-h-full object-contain" />
              </div>
              {!sidebarCollapsed && <span className="truncate text-sm font-semibold text-slate-900">{companyName}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e86f25] text-white font-black">S</span>
              {!sidebarCollapsed && <div><p className="text-base font-black tracking-[0.14em] text-slate-900">SIGO</p><p className="max-w-[150px] text-[8px] uppercase leading-3 tracking-[0.11em] text-slate-400">Sistema Integrado de Gestão de Obras</p></div>}
            </div>
          )}
          {!sidebarCollapsed && <button onClick={() => setSidebarCollapsed(true)} className="icon-btn border-0 bg-transparent shadow-none" title="Recolher menu"><IconClose className="h-4 w-4" /></button>}
        </div>

        {sidebarCollapsed && <button onClick={() => setSidebarCollapsed(false)} className="icon-btn mx-auto mt-3" title="Expandir menu"><IconMenu className="h-4 w-4" /></button>}

        {companyName && !sidebarCollapsed && (
          <div className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="truncate">{companyName}</span>
          </div>
        )}

        <nav className={`flex-1 py-4 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          {navItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            const sectionLabel = item.to === "/painel" || item.to === "/admin" ? "Trabalho" : item.to === "/fornecedores" ? "Operações" : item.to === "/empresa" ? "Administração" : null;
            return (
              <div key={item.to}>
              {sectionLabel && !sidebarCollapsed && <p className="mb-1 mt-4 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 first:mt-0">{sectionLabel}</p>}
              <Link
                to={item.to}
                title={sidebarCollapsed ? item.label : undefined}
                className={`mb-0.5 flex items-center rounded-md text-sm font-medium transition-colors ${sidebarCollapsed ? "h-10 justify-center px-2" : "gap-3 px-2.5 py-2"} ${
                  active ? "bg-slate-200/80 text-slate-950" : "text-slate-600 hover:bg-slate-200/55 hover:text-slate-950"
                }`}
              >
                <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? "text-[#d85f18]" : "text-slate-500"}`} />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
              </div>
            );
          })}
        </nav>

        <div className={`border-t border-slate-200 ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          <div className="flex items-center gap-3">
            <Link to="/perfil" title={sidebarCollapsed ? user?.name : undefined} className={`flex min-w-0 flex-1 items-center rounded-lg hover:bg-slate-200/60 ${sidebarCollapsed ? "justify-center p-1" : "gap-3 p-2"}`}>
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                  {initials(user?.name)}
                </div>
              )}
              {!sidebarCollapsed && <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800 truncate">{user?.name}</p><p className="text-[11px] text-slate-400">{user ? ROLE_LABELS[user.role] : ""}</p></div>}
            </Link>
            {!sidebarCollapsed && <button onClick={() => logout()} title="Sair" className="icon-btn border-0 bg-transparent shadow-none">
              <IconLogout className="w-[18px] h-[18px]" />
            </button>}
          </div>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barra superior móvel (ecrãs pequenos, sem sidebar) */}
        <div className="md:hidden bg-[#172033] text-white px-3 py-2.5 flex items-center justify-between shadow-sm">
          <button onClick={() => setDrawerOpen(true)} aria-label="Abrir menu" className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-brand-200 hover:bg-white/10 hover:text-white">
            <IconMenu className="w-5 h-5" />
          </button>
          <p className="font-black tracking-[0.18em]">SIGO</p>
          <Link to="/perfil" aria-label="Perfil">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-xs font-semibold">{initials(user?.name)}</div>
            )}
          </Link>
        </div>

        {/* Gaveta lateral móvel — menu completo (todos os módulos + perfil + sair), aberta pelo
            botão hamburger acima; a barra inferior só tem os módulos principais. */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-gray-900/50" onClick={() => setDrawerOpen(false)} />
            <div className="relative w-72 max-w-[80vw] bg-[#f8f8f9] text-slate-700 flex flex-col shadow-xl">
              <div className="px-4 py-4 flex items-center justify-between border-b border-slate-200">
                <p className="text-lg font-black tracking-[0.18em] text-slate-900">SIGO</p>
                <button onClick={() => setDrawerOpen(false)} aria-label="Fechar menu" className="icon-btn">
                  <IconClose className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                {navItems.map((item) => {
                  const active = isActive(item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        active ? "bg-slate-200 text-slate-950" : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-950"
                      }`}
                    >
                      <Icon className="w-[18px] h-[18px]" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="px-3 py-4 border-t border-slate-200 space-y-1">
                <Link to="/perfil" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-950">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-[18px] h-[18px] rounded-full object-cover" />
                  ) : (
                    <span className="w-[18px] h-[18px] rounded-full bg-brand-600 flex items-center justify-center text-[9px] font-semibold">
                      {initials(user?.name)}
                    </span>
                  )}
                  Perfil
                </Link>
                <button
                  onClick={() => logout()}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-950"
                >
                  <IconLogout className="w-[18px] h-[18px]" />
                  Sair
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-4">
          <div className="min-w-0 max-w-full">
            <h1 className="break-words text-lg font-black tracking-tight text-slate-900 md:text-xl">{title}</h1>
            {subtitle && <p className="mt-1 max-w-3xl break-words text-xs leading-4 text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">
            <InstallAppButton />
            {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
            <div className="hidden md:block">
              <UserMenu />
            </div>
          </div>
        </header>

        <OfflineBanner />

        <main className="page-enter min-w-0 flex-1 overflow-x-hidden p-3 pb-20 sm:p-5 md:p-8 md:pb-8 xl:p-10">{children}</main>

        {/* Barra inferior móvel — só os módulos principais, ícone + rótulo curto, tocável. */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 flex items-stretch">
          {bottomBarItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
                  active ? "text-brand-700" : "text-gray-400"
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label.split(" ")[0]}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
