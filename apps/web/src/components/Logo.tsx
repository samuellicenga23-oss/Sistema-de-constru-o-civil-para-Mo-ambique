// Marca SIGO: duas formas em S/relâmpago ponto-simétricas — mesma geometria usada em
// scripts/generate_icons.py para os ícones PWA/favicon, para a marca ser sempre igual em toda a
// aplicação.
type LogoProps = { className?: string; color?: string };

export function LogoMark({ className = "h-6 w-6", color = "#1AADB4" }: LogoProps) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true">
      <path d="M30 10 L90 10 L50 50 L10 50 L10 30 Z" fill={color} />
      <path d="M70 90 L10 90 L50 50 L90 50 L90 70 Z" fill={color} />
    </svg>
  );
}

export function LogoIcon({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <div className={`grid shrink-0 place-items-center rounded-lg bg-[#0E2033] p-1.5 ${className}`}>
      <LogoMark className="h-full w-full" />
    </div>
  );
}

export function LogoFull({ tagline = true, dark = false }: { tagline?: boolean; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoIcon className="h-9 w-9" />
      <div>
        <p className={`text-base font-black tracking-[0.14em] ${dark ? "text-white" : "text-slate-900"}`}>SIGO</p>
        {tagline && (
          <p className={`max-w-[150px] text-[8px] uppercase leading-3 tracking-[0.11em] ${dark ? "text-slate-400" : "text-slate-400"}`}>
            Sistema Integrado de Gestão de Obras
          </p>
        )}
      </div>
    </div>
  );
}
