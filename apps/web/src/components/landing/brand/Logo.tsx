import React from "react";

const BRAND_ALT = "SIGO — Sistema Integrado de Gestão de Obras";
const BRAND_ASSETS = {
  full: "/brand/sigo-logo-oficial.png",
  compact: "/brand/sigo-logo-compacto.png",
  mark: "/brand/sigo-simbolo.png",
} as const;

type LogoMarkProps = {
  size?: number;
  className?: string;
};

export function LogoMark({ size = 40, className = "" }: LogoMarkProps) {
  return (
    <img
      src={BRAND_ASSETS.mark}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={`block shrink-0 object-contain ${className}`}
    />
  );
}

type WordmarkProps = {
  className?: string;
  tone?: "ink" | "light";
};

/** Mantido para compatibilidade; novas áreas devem preferir a assinatura oficial em `Logo`. */
export function Wordmark({ className = "", tone = "ink" }: WordmarkProps) {
  return <span className={`sr-only ${className} ${tone === "light" ? "text-white" : "text-ink"}`}>{BRAND_ALT}</span>;
}

type LogoProps = {
  size?: number;
  tone?: "ink" | "light";
  showTagline?: boolean;
  className?: string;
};

export function Logo({ size = 40, tone = "ink", showTagline = false, className = "" }: LogoProps) {
  const source = showTagline ? BRAND_ASSETS.full : BRAND_ASSETS.compact;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ height: size }}>
      <img
        src={source}
        alt={BRAND_ALT}
        className={`block h-full w-auto max-w-none object-contain ${tone === "light" ? "brightness-0 invert" : ""}`}
      />
      {tone === "light" && (
        <img src={BRAND_ASSETS.mark} alt="" aria-hidden="true" className="absolute inset-y-0 left-0 h-full w-auto" />
      )}
    </span>
  );
}
