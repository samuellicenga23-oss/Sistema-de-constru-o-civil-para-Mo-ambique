import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "./Logo";
import { IconGrid, IconTag, IconLogout, IconUser, IconPackage, IconClipboard } from "./icons";
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
  const pedidosActive = path.includes("/oportunidades") || path.includes("/pedidos/");
  const catalogActive = path.endsWith("/precos") || path.endsWith("/oferta");
  const moneyActive = path.includes("/facturas") || path.includes("/nao-conformidades");

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
            <Link to="/painel" className={`app-nav-link ${path.endsWith("/painel") ? "active" : ""}`}>
              <IconGrid size={15} /> Painel
            </Link>
            <Link to="/oportunidades" className={`app-nav-link ${pedidosActive ? "active" : ""}`}>
              <IconPackage size={15} /> Pedidos
              {pendingCount > 0 && <span className="app-nav-dot" aria-label={`${pendingCount} pedido(s) por responder`} />}
            </Link>
            <Link to="/ordens" className={`app-nav-link ${path.includes("/ordens") ? "active" : ""}`}>
              <IconClipboard size={15} /> Ordens
            </Link>
            <Link to="/facturas" className={`app-nav-link ${moneyActive ? "active" : ""}`}>
              <IconTag size={15} /> Facturas
            </Link>
            <Link to="/precos" className={`app-nav-link ${catalogActive ? "active" : ""}`}>
              <IconTag size={15} /> Catálogo
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
