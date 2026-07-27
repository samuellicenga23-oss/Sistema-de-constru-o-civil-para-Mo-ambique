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
    <nav aria-label="Áreas do projecto" className="-mt-2 overflow-x-auto border-b border-slate-200">
      <div className="flex min-w-max items-center gap-6">
        {items.map((item) => {
          const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} className={`flex items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-sm font-medium transition-colors ${active ? "border-[#e86f25] text-slate-950" : "border-transparent text-slate-500 hover:text-slate-900"}`}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
