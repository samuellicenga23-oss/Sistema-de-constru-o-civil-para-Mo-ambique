import { IconSearch } from "./icons";

export default function PageSearch({
  value,
  onChange,
  placeholder = "Pesquisar nesta página…",
  resultLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  resultLabel?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">{placeholder}</span>
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="input pl-10"
        />
      </label>
      {resultLabel && <span className="shrink-0 text-xs font-medium text-slate-500">{resultLabel}</span>}
    </div>
  );
}
