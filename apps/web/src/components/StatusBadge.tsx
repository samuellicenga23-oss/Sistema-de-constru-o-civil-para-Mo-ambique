type Tone = "green" | "yellow" | "red" | "gray" | "brand";

// Badge de estado genérico — as páginas já tinham cada uma o seu próprio
// Record&lt;string, string&gt; de "estado → classe de cor"; isto só formaliza o padrão.
export default function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
