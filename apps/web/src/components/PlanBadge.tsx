import { getPlanDefinition } from "@sigo/shared";

export default function PlanBadge({ plan }: { plan: string }) {
  const def = getPlanDefinition(plan);
  if (!def) return null;
  return <span className="badge badge-brand">{def.label}</span>;
}
