import { Link, useLocation } from "react-router-dom";
import { IconHome, IconClipboard, IconUpload, IconChart } from "./icons";

export default function ProjectWorkspaceNav({ projectId }: { projectId: string }) {
  const location = useLocation();
  const items = [
    { to: `/projectos/${projectId}`, label: "Visão geral", icon: IconHome, exact: true },
    { to: `/projectos/${projectId}/diario`, label: "Diário de obra", icon: IconClipboard },
    { to: `/projectos/${projectId}/cronograma`, label: "Cronograma", icon: IconChart },
    { to: `/projectos/${projectId}/compras`, label: "Compras e stock", icon: IconUpload },
    { to: `/projectos/${projectId}/financeiro`, label: "Financeiro", icon: IconChart },
  ];

  return (
    <nav aria-label="Áreas do projecto" className="-mt-1 max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
      <div className="flex min-w-max items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
        {items.map((item) => {
          const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} className={`flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70 hover:text-slate-950"}`}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
