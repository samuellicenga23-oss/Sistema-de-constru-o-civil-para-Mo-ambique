import { Link } from "react-router-dom";
import type { ProjectWorkflowStatus } from "../api/boq";

const TONE: Record<string, string> = {
  info: "border-brand-200 bg-brand-50 text-ink",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  error: "border-red-200 bg-red-50 text-red-950",
};

export default function ProjectWorkflowBanner({
  status,
  projectId,
}: {
  status: ProjectWorkflowStatus | null;
  projectId: string;
}) {
  if (!status || status.guidance.length === 0) return null;

  return (
    <div className="space-y-2 xl:col-span-2">
      {status.guidance.map((item, index) => (
        <article key={`${item.id}-${index}`} className={`rounded-xl border px-4 py-3 text-sm ${TONE[item.severity]}`}>
          <p className="font-semibold">{item.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed opacity-90">{item.message}</p>
          {item.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.actions.map((action) => {
                if (action.path) {
                  return (
                    <Link key={action.label} to={action.path} className="btn btn-secondary btn-sm !text-xs">
                      {action.label}
                    </Link>
                  );
                }
                if (action.anchor) {
                  return (
                    <a key={action.label} href={`#${action.anchor}`} className="btn btn-secondary btn-sm !text-xs">
                      {action.label}
                    </a>
                  );
                }
                return null;
              })}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
