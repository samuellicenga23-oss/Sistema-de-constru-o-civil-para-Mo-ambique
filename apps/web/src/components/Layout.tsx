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

  // Barra inferior móvel: só os módulos principais (máx. 5, para caberem sem apertar) — o resto
  // fica no menu recolhível (hamburger). Antes a "navegação móvel" era só uma tira horizontal
  // com scroll, sem hierarquia entre módulos principais e secundários.
  const bottomBarItems = navItems.slice(0, 5);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-[#172033] text-white relative overflow-hidden">
        <div className="relative px-5 py-6 border-b border-white/8">
          {logoUrl ? (
            <div className="bg-white rounded-lg p-2 inline-block mb-2">
              <img src={logoUrl} alt={companyName ?? "Logótipo"} className="h-8 object-contain" />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#e86f25] text-white font-black">S</span>
              <div>
                <p className="text-xl font-black tracking-[0.16em]">SIGA</p>
                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">Gestão de obras</p>
              </div>
            </div>
          )}
          {companyName && <p className="text-xs text-brand-300 mt-1 truncate">{companyName}</p>}
        </div>

        <nav className="relative flex-1 px-3 py-5 space-y-1.5">
          {navItems.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors border-l-2 ${
                  active ? "bg-white/10 text-white border-[#e86f25]" : "text-slate-300 hover:bg-white/6 hover:text-white border-transparent"
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative px-4 py-4 border-t border-white/8 bg-black/10">
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
        {/* Barra superior móvel (ecrãs pequenos, sem sidebar) */}
        <div className="md:hidden bg-[#172033] text-white px-4 py-3 flex items-center justify-between shadow-sm">
          <button onClick={() => setDrawerOpen(true)} aria-label="Abrir menu" className="text-brand-200 hover:text-white -ml-1 p-1">
            <IconMenu className="w-5 h-5" />
          </button>
          <p className="font-black tracking-[0.18em]">SIGA</p>
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
            <div className="relative w-72 max-w-[80vw] bg-gradient-to-b from-brand-950 to-brand-900 text-white flex flex-col">
              <div className="px-4 py-4 flex items-center justify-between border-b border-white/10">
                <p className="text-lg font-black tracking-[0.18em]">SIGA</p>
                <button onClick={() => setDrawerOpen(false)} aria-label="Fechar menu" className="text-brand-200 hover:text-white p-1">
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
                        active ? "bg-white/15 text-white" : "text-brand-200 hover:bg-white/8 hover:text-white"
                      }`}
                    >
                      <Icon className="w-[18px] h-[18px]" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="px-3 py-4 border-t border-white/10 space-y-1">
                <Link to="/perfil" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-200 hover:bg-white/8 hover:text-white">
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
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-200 hover:bg-white/8 hover:text-white"
                >
                  <IconLogout className="w-[18px] h-[18px]" />
                  Sair
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="bg-white border-b border-slate-200 px-5 md:px-8 py-4 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-black tracking-tight text-slate-900 truncate">{title}</h1>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3">
            <InstallAppButton />
            {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
            <div className="hidden md:block">
              <UserMenu />
            </div>
          </div>
        </header>

        <OfflineBanner />

        <main className="page-enter flex-1 p-5 md:p-8 xl:p-10 pb-20 md:pb-8">{children}</main>

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
