import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { companiesApi } from "../api/companies";
import UserMenu from "./UserMenu";
import InstallAppButton from "./InstallAppButton";
import OfflineBanner from "./OfflineBanner";
import { IconHome, IconFolder, IconTag, IconBuilding, IconLogout, IconSettings, IconRuler, IconUsers, IconMenu, IconClose } from "./icons";
import { LogoFull, LogoIcon } from "./Logo";
import { useLanguage } from "../i18n";
import type { CompanyModuleKey } from "../api/companies";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin_empresa: "Administrador",
  orcamentista: "Orçamentista",
  engenheiro_fiscal: "Engenheiro/Fiscal",
  visualizador: "Visualizador",
};

type NavItem = { to: string; label: string; icon: (p: { className?: string }) => ReactNode; exact?: boolean; module?: CompanyModuleKey };

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
  const { t } = useLanguage();
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
          setCompanyName(data.company.brandName || data.company.name);
          setLogoUrl(data.company.logoUrl);
          document.documentElement.style.setProperty("--color-brand-500", data.company.primaryColor);
          document.documentElement.style.setProperty("--color-brand-600", `color-mix(in srgb, ${data.company.primaryColor} 88%, black)`);
          document.documentElement.style.setProperty("--color-brand-700", `color-mix(in srgb, ${data.company.primaryColor} 76%, black)`);
          document.documentElement.style.setProperty("--color-accent", data.company.accentColor);
          document.documentElement.style.setProperty("--color-accent-hover", `color-mix(in srgb, ${data.company.accentColor} 88%, black)`);
          document.documentElement.style.setProperty("--color-accent-active", `color-mix(in srgb, ${data.company.accentColor} 76%, black)`);
        })
        .catch(() => {});
    } else {
      setCompanyName(null);
      setLogoUrl(null);
      document.documentElement.style.setProperty("--color-brand-500", "#1AADB4");
      document.documentElement.style.setProperty("--color-brand-600", "#0F8A90");
      document.documentElement.style.setProperty("--color-brand-700", "#0C6F74");
      document.documentElement.style.setProperty("--color-accent", "#ED6C22");
      document.documentElement.style.setProperty("--color-accent-hover", "#D85F18");
      document.documentElement.style.setProperty("--color-accent-active", "#C75112");
    }
  }, [user?.companyId]);

  const navItems: NavItem[] =
    user?.role === "super_admin"
      ? [{ to: "/admin", label: t("platformPanel"), icon: IconSettings }]
      : [
          { to: "/painel", label: t("dashboard"), icon: IconHome, exact: true, module: "dashboard" as const },
          { to: "/medicoes", label: t("measurements"), icon: IconRuler, module: "measurements" as const },
          { to: "/orcamentos", label: t("budgets"), icon: IconFolder, module: "budgets" as const },
          { to: "/catalogo", label: t("catalog"), icon: IconTag, module: "catalog" as const },
          { to: "/fornecedores", label: t("suppliers"), icon: IconUsers, module: "suppliers" as const },
          { to: "/calculos-rapidos", label: t("quickCalculations"), icon: IconRuler, module: "quick_calculations" as const },
          ...(user?.role === "admin_empresa" ? [{ to: "/empresa", label: t("companySettings"), icon: IconBuilding }] : []),
        ].filter((item) => !item.module || user?.enabledModules.includes(item.module));

  function isActive(item: NavItem) {
    if (item.exact) return location.pathname === item.to;
    return location.pathname === item.to || location.pathname.startsWith(item.to + "/");
  }

  // Barra inferior móvel: só os módulos principais (máx. 5, para caberem sem apertar) — o resto
  // fica no menu recolhível (hamburger). Antes a "navegação móvel" era só uma tira horizontal
  // com scroll, sem hierarquia entre módulos principais e secundários.
  const bottomBarItems = navItems.slice(0, 5);

  return (
    <div className="min-h-screen flex bg-surface">
      {/* Sidebar */}
      <aside className={`hidden md:flex shrink-0 flex-col border-r border-slate-200 bg-surface-sidebar text-slate-700 transition-[width] duration-200 ${sidebarCollapsed ? "w-[4.5rem]" : "w-60"}`}>
        <div className={`flex h-16 items-center border-b border-slate-200 ${sidebarCollapsed ? "justify-center px-2" : "justify-between px-3"}`}>
          {logoUrl ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white p-1.5">
                <img src={logoUrl} alt={companyName ?? "Logótipo"} className="max-h-full object-contain" />
              </div>
              {!sidebarCollapsed && <span className="truncate text-sm font-semibold text-slate-900">{companyName}</span>}
            </div>
          ) : (
            <div className="flex min-w-0 items-center">
              {sidebarCollapsed ? (
                <LogoIcon className="h-9 w-9" />
              ) : (
                <LogoFull tagline={false} />
              )}
            </div>
          )}
          {!sidebarCollapsed && <button type="button" onClick={() => setSidebarCollapsed(true)} className="icon-btn border-0 bg-transparent shadow-none" title={t("collapseMenu")}><IconClose className="h-4 w-4" /></button>}
        </div>

        {sidebarCollapsed && <button type="button" onClick={() => setSidebarCollapsed(false)} className="icon-btn mx-auto mt-3" title={t("expandMenu")}><IconMenu className="h-4 w-4" /></button>}

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
            const sectionLabel = item.to === "/painel" || item.to === "/admin" ? t("work") : item.to === "/fornecedores" ? t("operations") : item.to === "/empresa" ? t("administration") : null;
            return (
              <div key={item.to}>
              {sectionLabel && !sidebarCollapsed && <p className="mb-1 mt-4 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 first:mt-0">{sectionLabel}</p>}
              <Link
                to={item.to}
                title={sidebarCollapsed ? item.label : undefined}
                className={`mb-0.5 flex items-center rounded-xl text-sm font-medium transition-colors ${sidebarCollapsed ? "h-10 justify-center px-2" : "gap-3 px-2.5 py-2"} ${
                  active
                    ? "bg-white text-slate-950 shadow-sm ring-1 ring-brand-200/80"
                    : "text-slate-600 hover:bg-slate-200/55 hover:text-slate-950"
                }`}
              >
                <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? "text-brand-600" : "text-slate-500"}`} />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                {active && !sidebarCollapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
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
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label={t("openMenu")} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-brand-200 hover:bg-white/10 hover:text-white">
            <IconMenu className="w-5 h-5" />
          </button>
          <LogoFull dark tagline={false} />
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
                <LogoFull tagline={false} />
                <button type="button" onClick={() => setDrawerOpen(false)} aria-label={t("closeMenu")} className="icon-btn">
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
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                        active ? "bg-white text-slate-950 shadow-sm ring-1 ring-brand-200" : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-950"
                      }`}
                    >
                      <Icon className={`w-[18px] h-[18px] ${active ? "text-brand-600" : ""}`} />
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
                  {t("profile")}
                </Link>
                <button
                  onClick={() => logout()}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-950"
                >
                  <IconLogout className="w-[18px] h-[18px]" />
                  {t("logout")}
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-10 border-b border-slate-200/90 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-4 xl:px-10">
            <div className="min-w-0 max-w-full">
              <h1 className="page-title break-words">{title}</h1>
              {subtitle && <p className="mt-1 max-w-3xl break-words text-xs leading-5 text-slate-500">{subtitle}</p>}
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end overflow-x-auto">
              <InstallAppButton />
              {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
              <div className="hidden md:block">
                <UserMenu />
              </div>
            </div>
          </div>
        </header>

        <OfflineBanner />

        <main className="min-w-0 flex-1 overflow-x-hidden p-3 pb-20 sm:p-5 md:p-8 md:pb-8 xl:p-10 page-enter">
          <div className="mx-auto w-full max-w-[1500px]">{children}</div>
        </main>

        {/* Barra inferior móvel — só os módulos principais, ícone + rótulo curto, tocável. */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
          {bottomBarItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold ${
                  active ? "text-brand-700" : "text-slate-400"
                }`}
              >
                {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent" aria-hidden />}
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
