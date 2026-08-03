const BRAND_ALT = "SIGO — Sistema Integrado de Gestão de Obras";
const BRAND_ASSETS = {
  full: "/brand/sigo-logo-oficial.png",
  compact: "/brand/sigo-logo-compacto.png",
  mark: "/brand/sigo-simbolo.png",
} as const;

type LogoMarkProps = { className?: string; color?: string };

/** Símbolo oficial, sem placa, moldura ou cor de fundo. */
export function LogoMark({ className = "h-6 w-6" }: LogoMarkProps) {
  return <img src={BRAND_ASSETS.mark} alt="" aria-hidden="true" className={`block object-contain ${className}`} />;
}

export function LogoIcon({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${className}`} aria-label={BRAND_ALT} role="img">
      <LogoMark className="h-full w-full" />
    </span>
  );
}

type LogoFullProps = {
  tagline?: boolean;
  dark?: boolean;
  className?: string;
  height?: number;
};

/**
 * Assinatura oficial. Em fundos escuros, o azul é invertido para branco e o símbolo laranja
 * original é reposto por cima; nenhuma variante adiciona uma caixa de fundo à marca.
 */
export function LogoFull({ tagline = true, dark = false, className = "", height }: LogoFullProps) {
  const source = tagline ? BRAND_ASSETS.full : BRAND_ASSETS.compact;
  const defaultHeight = tagline ? "h-14" : "h-9";

  return (
    <span
      className={`relative inline-flex shrink-0 ${height ? "" : defaultHeight} ${className}`}
      style={height ? { height } : undefined}
    >
      <img
        src={source}
        alt={BRAND_ALT}
        className={`block h-full w-auto max-w-none object-contain ${dark ? "brightness-0 invert" : ""}`}
      />
      {dark && <img src={BRAND_ASSETS.mark} alt="" aria-hidden="true" className="absolute inset-y-0 left-0 h-full w-auto" />}
    </span>
  );
}

/** Compatibilidade com os usos que passam `variant`. */
export function Logo({ className, variant, dark }: { className?: string; variant?: "dark" | "light"; dark?: boolean }) {
  const onDark = dark ?? variant === "light";
  return <LogoFull dark={onDark} tagline={false} className={className} />;
}
