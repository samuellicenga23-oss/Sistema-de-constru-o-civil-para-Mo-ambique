import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "./Logo";
import { IconGrid, IconTag, IconLogout, IconUser, IconPackage } from "./icons";
import { supplierPortalAuthApi } from "../api/supplierPortal";
import NotificationBell from "./NotificationBell";

export function AppShell({ accountName, pendingCount = 0, children }: { accountName: string; pendingCount?: number; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await supplierPortalAuthApi.logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  const initials = accountName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "SF";

  const path = location.pathname;

  return (
    <div className="portal-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/painel" className="app-brand">
            <LogoMark size={30} />
            <div className="app-brand-text">
              <p>SIGO Fornecedores</p>
              <strong>{accountName}</strong>
            </div>
          </Link>

          <nav className="app-nav" aria-label="Navegação principal">
            <Link to="/painel" className={`app-nav-link ${path.endsWith("/painel") || path.includes("/pedidos/") ? "active" : ""}`}>
              <IconGrid size={15} /> Painel
              {pendingCount > 0 && <span className="app-nav-dot" aria-label={`${pendingCount} pedido(s) por responder`} />}
            </Link>
            <Link to="/precos" className={`app-nav-link ${path.endsWith("/precos") ? "active" : ""}`}>
              <IconTag size={15} /> Meus preços
            </Link>
            <Link to="/oferta" className={`app-nav-link ${path.endsWith("/oferta") ? "active" : ""}`}>
              <IconPackage size={15} /> O que vendo
            </Link>
            <Link to="/perfil" className={`app-nav-link ${path.endsWith("/perfil") ? "active" : ""}`}>
              <IconUser size={15} /> Perfil
            </Link>
          </nav>

          <NotificationBell />
          <Link to="/perfil" className="rich-row-avatar" style={{ width: "2.1rem", height: "2.1rem", fontSize: "0.75rem", textDecoration: "none" }} title="Ver perfil">
            {initials}
          </Link>
          <button type="button" onClick={handleLogout} className="icon-btn-ghost" title="Sair" aria-label="Sair">
            <IconLogout size={16} />
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
