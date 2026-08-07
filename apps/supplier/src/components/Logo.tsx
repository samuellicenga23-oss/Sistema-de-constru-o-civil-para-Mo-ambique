const BRAND_ALT = "SIGO — Sistema Integrado de Gestão de Obras";

/** Logos oficiais servidos pelo painel principal em /brand/ (mesma origem em produção). */
export function Logo({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={className} style={{ height: size, display: "inline-flex" }}>
      <img
        src="/brand/sigo-logo-compacto.png"
        alt={BRAND_ALT}
        style={{ display: "block", height: "100%", width: "auto", maxWidth: "none", objectFit: "contain" }}
      />
    </span>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/brand/sigo-simbolo.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
