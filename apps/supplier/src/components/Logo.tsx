const BRAND_ALT = "SIGO — Sistema Integrado de Gestão de Obras";
const base = import.meta.env.BASE_URL;

/** Logos oficiais empacotados em apps/supplier/public/brand. */
export function Logo({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={className} style={{ height: size, display: "inline-flex" }}>
      <img
        src={`${base}brand/sigo-logo-compacto.png`}
        alt={BRAND_ALT}
        style={{ display: "block", height: "100%", width: "auto", maxWidth: "none", objectFit: "contain" }}
      />
    </span>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src={`${base}brand/sigo-simbolo.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
