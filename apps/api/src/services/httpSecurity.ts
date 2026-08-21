const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function mutationOriginAllowed(input: {
  production: boolean;
  method: string;
  origin?: string;
  host?: string;
  forwardedHost?: string;
  fetchSite?: string;
  allowedOrigins?: string[] | null;
}) {
  if (!input.production || SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.fetchSite === "cross-site") return false;
  if (!input.origin) return true;
  let originHost: string;
  try { originHost = new URL(input.origin).host.toLowerCase(); } catch { return false; }
  const requestHost = String(input.forwardedHost ?? input.host ?? "").split(",")[0].trim().toLowerCase();
  return originHost === requestHost || Boolean(input.allowedOrigins?.includes(input.origin));
}

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self'",
} as const;

const REQUIRED_API_HEADERS = ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy"] as const;

/** Verifica cabeçalhos de segurança aplicados numa resposta API. */
export function auditSecurityHeaders(headers: Record<string, string | string[] | undefined>): {
  ok: boolean;
  missing: string[];
  present: string[];
} {
  const present: string[] = [];
  const missing: string[] = [];
  for (const name of REQUIRED_API_HEADERS) {
    const value = headers[name.toLowerCase()] ?? headers[name];
    if (value && String(value).trim()) present.push(name);
    else missing.push(name);
  }
  return { ok: missing.length === 0, missing, present };
}
