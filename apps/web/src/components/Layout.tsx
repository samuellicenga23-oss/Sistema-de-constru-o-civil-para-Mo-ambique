import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { companiesApi } from "../api/companies";
import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import PageBackButton from "./PageBackButton";
import InstallAppButton from "./InstallAppButton";
import OfflineBanner from "./OfflineBanner";
import PlantProcessingCenter from "./PlantProcessingCenter";
import ImportProcessingCenter from "./ImportProcessingCenter";
import ReadyForReviewBanner from "./ReadyForReviewBanner";
import SubscriptionBanner from "./SubscriptionBanner";
import { IconHome, IconFolder, IconTag, IconBuilding, IconLogout, IconSettings, IconRuler, IconMenu, IconClose, IconClipboard } from "./icons";
import { LogoFull, LogoIcon } from "./Logo";
import { useLanguage } from "../i18n";
import type { CompanyModuleKey } from "../api/companies";
import { can, canSeeEscritorio, canSeeGestao, isSiteManagementModuleEnabled } from "../permissions";
import OnboardingTour from "./OnboardingTour";

type NavItem = {
  to: string;
  label: string;
  shortLabel?: string;
  icon: (p: { className?: string }) => ReactNode;
  exact?: boolean;
  module?: CompanyModuleKey;
  siteModules?: boolean;
  permission?: string | string[];
  section?: "fases" | "ferramentas" | "admin";
  tourId?: string;
};

function tourIdForPath(path: string): string | undefined {
  if (path === "/painel") return "nav-painel";
  if (path === "/medicoes") return "nav-medicoes";
  if (path === "/orcamentos") return "nav-orcamentos";
  if (path === "/gestao") return "nav-gestao";
  if (path === "/perfil") return "nav-perfil";
  return undefined;
}

function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default function Layout({
  title,
  subtitle,
  actions,
  back,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Voltar inteligente: histórico, senão fallback. */
  back?: { label?: string; fallbackTo: string };
  children: ReactNode;
}) {
  const { user, logout, setUser } = useAuth();
  const { t, language } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [exitingImpersonation, setExitingImpersonation] = useState(false);

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
      ? [{ to: "/admin", label: t("platformPanel"), icon: IconSettings, section: "admin" as const }]
      : ([
          { to: "/painel", label: t("dashboard"), shortLabel: "Painel", icon: IconHome, exact: true, module: "dashboard" as const, section: "fases" as const },
          { to: "/medicoes", label: t("measurements"), shortLabel: "Levantamentos", icon: IconRuler, module: "measurements" as const, permission: "medicoes.ver", section: "fases" as const },
          { to: "/orcamentos", label: t("budgets"), shortLabel: "Orçamentos", icon: IconFolder, module: "budgets" as const, permission: "orcamentos.ver", section: "fases" as const },
          {
            to: "/gestao",
            label: "Gestão da obra",
            shortLabel: "Gestão",
            icon: IconClipboard,
            siteModules: true,
            section: "fases" as const,
          },
          { to: "/escritorio", label: "Comercial", shortLabel: "Comercial", icon: IconBuilding, module: "practice" as const, section: "fases" as const },
          { to: "/catalogo", label: t("catalog"), shortLabel: "Catálogo", icon: IconTag, module: "catalog" as const, permission: "catalogo.ver", section: "ferramentas" as const },
          { to: "/calculos-rapidos", label: t("quickCalculations"), shortLabel: "Cálculos", icon: IconRuler, module: "quick_calculations" as const, permission: "calculos.usar", section: "ferramentas" as const },
          ...(user?.role === "admin_empresa"
            ? [{ to: "/empresa", label: t("companySettings"), shortLabel: "Empresa", icon: IconBuilding, section: "admin" as const }]
            : []),
          ...(user?.companyId
            ? [{ to: "/creditos", label: "Créditos e planos", shortLabel: "Créditos", icon: IconTag, section: "admin" as const }]
            : []),
          ...(user?.platformRole === "super_admin"
            ? [{ to: "/admin", label: t("platformPanel"), shortLabel: "Plataforma", icon: IconSettings, section: "admin" as const }]
            : []),
        ] as NavItem[]).filter((item) => {
          if (item.module && !user?.enabledModules.includes(item.module)) return false;
          if (item.siteModules) {
            if (!user || !isSiteManagementModuleEnabled(user.enabledModules)) return false;
            if (!canSeeGestao(user)) return false;
          }
          if (item.to === "/escritorio") {
            if (!canSeeEscritorio(user)) return false;
          }
          if (item.permission) {
            const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
            if (!needed.some((id) => can(user, id))) return false;
          }
          return true;
        });

  async function exitImpersonation() {
    if (exitingImpersonation) return;
    setExitingImpersonation(true);
    try {
      const next = await companiesApi.exitImpersonation();
      setUser(next);
      navigate("/admin");
    } catch {
      // Mantém o banner; o utilizador pode tentar de novo.
    } finally {
      setExitingImpersonation(false);
    }
  }
  function isActive(item: NavItem) {
    if (item.exact) return location.pathname === item.to;
    return location.pathname === item.to || location.pathname.startsWith(item.to + "/");
  }

  const phaseItems = navItems.filter((item) => item.section === "fases" || !item.section);
  const toolItems = navItems.filter((item) => item.section === "ferramentas");
  const adminItems = navItems.filter((item) => item.section === "admin");
  // Barra inferior: fases principais (sem apertar rótulos longos)
  const bottomBarItems = phaseItems.slice(0, 5);

  function renderNavGroup(items: NavItem[], title: string) {
    if (!items.length) return null;
    return (
      <div className="mb-5">
        {!sidebarCollapsed && (
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</p>
        )}
        <div className="space-y-1">
          {items.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                data-tour={item.tourId ?? tourIdForPath(item.to)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`flex items-center rounded-xl text-[13px] font-medium transition-colors ${
                  sidebarCollapsed ? "h-11 justify-center px-2" : "gap-3 px-3 py-2.5"
                } ${
                  active
                    ? "bg-white text-slate-950 shadow-sm ring-1 ring-brand-200/80"
                    : "text-slate-600 hover:bg-slate-200/55 hover:text-slate-950"
                }`}
              >
                <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-brand-600" : "text-slate-500"}`} />
                {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate leading-snug">{item.label}</span>}
                {active && !sidebarCollapsed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-surface">
      <aside
        className={`hidden h-full min-h-0 shrink-0 flex-col border-r border-slate-200 bg-surface-sidebar text-slate-700 transition-[width] duration-200 md:flex ${
          sidebarCollapsed ? "w-[4.75rem]" : "w-72"
        }`}
      >
        <div className={`flex h-[4.25rem] items-center border-b border-slate-200 ${sidebarCollapsed ? "justify-center px-2" : "justify-between gap-2 px-4"}`}>
          {logoUrl ? (
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white p-1.5">
                <img src={logoUrl} alt={companyName ?? "Logótipo"} className="max-h-full object-contain" />
              </div>
              {!sidebarCollapsed && <span className="truncate text-sm font-semibold text-slate-900">{companyName}</span>}
            </div>
          ) : (
            <div className="flex min-w-0 items-center">
              {sidebarCollapsed ? <LogoIcon className="h-9 w-9" /> : <LogoFull tagline={false} />}
            </div>
          )}
          {!sidebarCollapsed && (
            <button type="button" onClick={() => setSidebarCollapsed(true)} className="icon-btn shrink-0 border-0 bg-transparent shadow-none" title={t("collapseMenu")}>
              <IconClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {sidebarCollapsed && (
          <button type="button" onClick={() => setSidebarCollapsed(false)} className="icon-btn mx-auto mt-3" title={t("expandMenu")}>
            <IconMenu className="h-4 w-4" />
          </button>
        )}

        <nav className={`flex-1 overflow-y-auto py-4 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          {renderNavGroup(phaseItems, "Fases")}
          {renderNavGroup(toolItems, "Ferramentas")}
          {renderNavGroup(adminItems, t("administration"))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {user?.actingCompanyId && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 md:px-8">
            <p>
              {language === "en" ? "Viewing as" : "A ver como"}{" "}
              <strong>{user.actingCompanyName ?? companyName ?? "…"}</strong>
              {" — "}
              {language === "en" ? "platform support mode" : "modo de suporte da plataforma"}
            </p>
            <button
              type="button"
              onClick={() => void exitImpersonation()}
              disabled={exitingImpersonation}
              className="btn btn-secondary btn-sm shrink-0 border-amber-400 bg-white"
            >
              {exitingImpersonation
                ? language === "en"
                  ? "Leaving…"
                  : "A sair…"
                : language === "en"
                  ? "Exit company"
                  : "Sair da empresa"}
            </button>
          </div>
        )}
        <div className="flex items-center justify-between bg-[#172033] px-3 py-2.5 text-white shadow-sm md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("openMenu")}
            className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-brand-200 hover:bg-white/10 hover:text-white"
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <LogoFull dark tagline={false} />
          <div className="flex items-center gap-1.5 text-white [&_.icon-btn]:border-white/10 [&_.icon-btn]:bg-transparent [&_.icon-btn]:text-brand-200 [&_.icon-btn]:hover:bg-white/10 [&_.icon-btn]:hover:text-white">
            <NotificationBell />
            <UserMenu compact />
          </div>
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="absolute inset-0 bg-gray-900/50" onClick={() => setDrawerOpen(false)} />
            <div className="relative flex w-80 max-w-[85vw] flex-col bg-[#f8f8f9] text-slate-700 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
                <LogoFull tagline={false} />
                <button type="button" onClick={() => setDrawerOpen(false)} aria-label={t("closeMenu")} className="icon-btn">
                  <IconClose className="h-5 w-5" />
                </button>
              </div>

              <div className="border-b border-slate-200 p-3">
                <Link to="/perfil" data-tour="nav-perfil" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                      {initials(user?.name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{user?.name}</p>
                    <p className="text-xs text-slate-500">{t("profile")}</p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  <IconLogout className="h-4 w-4" />
                  {t("logout")}
                </button>
              </div>

              <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
                {navItems.map((item) => {
                  const active = isActive(item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      data-tour={item.tourId ?? tourIdForPath(item.to)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${
                        active ? "bg-white text-slate-950 shadow-sm ring-1 ring-brand-200" : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-950"
                      }`}
                    >
                      <Icon className={`h-[18px] w-[18px] ${active ? "text-brand-600" : ""}`} />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        <header className="z-10 shrink-0 border-b border-slate-200/90 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-4 xl:px-10">
            <div className="flex min-w-0 max-w-full items-start gap-3">
              {back && (
                <div className="mt-0.5 shrink-0">
                  <PageBackButton label={back.label ?? "Voltar"} fallbackTo={back.fallbackTo} />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="page-title break-words">{title}</h1>
                {subtitle && <p className="mt-1 max-w-3xl break-words text-xs leading-5 text-slate-500">{subtitle}</p>}
              </div>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2.5 sm:justify-end">
              <InstallAppButton />
              {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
              <NotificationBell />
              <div className="hidden md:block">
                <UserMenu />
              </div>
            </div>
          </div>
        </header>

        <SubscriptionBanner />
        <ReadyForReviewBanner />
        <OfflineBanner />
        <PlantProcessingCenter />
        <ImportProcessingCenter />

        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 pb-24 sm:p-5 md:p-8 md:pb-8 xl:p-10 page-enter">
          <div className="mx-auto w-full max-w-[1500px]">{children}</div>
        </main>

        <OnboardingTour />

        <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
          {bottomBarItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                data-tour={item.tourId ?? tourIdForPath(item.to)}
                className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[10px] font-semibold leading-tight ${
                  active ? "text-brand-700" : "text-slate-400"
                }`}
              >
                {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" aria-hidden />}
                <Icon className="h-5 w-5 shrink-0" />
                <span className="max-w-full truncate">{item.shortLabel ?? item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
