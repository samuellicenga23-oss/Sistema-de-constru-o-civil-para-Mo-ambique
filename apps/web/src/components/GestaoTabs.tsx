import { Link, useLocation } from "react-router-dom";

const TABS = [
  { to: "/gestao", label: "Obras", end: true },
  { to: "/gestao/cotacoes", label: "Cotações", end: false },
] as const;

/** Separadores partilhados da área «Gestão da obra». */
export default function GestaoTabs() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Gestão da obra"
      className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
    >
      {TABS.map((tab) => {
        const active = tab.end ? pathname === tab.to : pathname === tab.to || pathname.startsWith(`${tab.to}/`);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors ${
              active ? "bg-brand-50 text-brand-800 ring-1 ring-brand-200" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      <a
        href="/fornecedor/login"
        target="_blank"
        rel="noreferrer"
        className="ml-auto rounded-lg px-3.5 py-2 text-[13px] font-semibold text-teal-700 hover:bg-teal-50"
      >
        Portal do Fornecedor ↗
      </a>
    </nav>
  );
}
