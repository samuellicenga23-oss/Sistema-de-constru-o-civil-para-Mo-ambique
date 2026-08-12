#!/usr/bin/env node

const args = process.argv.slice(2);
const baseUrl = String(args.find((arg) => !arg.startsWith("--")) ?? process.env.SIGO_PUBLIC_URL ?? "").replace(/\/$/, "");
const expectedRelease = args.find((arg) => arg.startsWith("--expected-release="))?.split("=", 2)[1]?.slice(0, 12) ?? "";
if (!/^https?:\/\//.test(baseUrl)) {
  console.error("Uso: node scripts/production-smoke.mjs https://dominio [--expected-release=<sha>]");
  process.exit(2);
}

const failures = [];
const checks = [];
const request = (pathname, options = {}) => fetch(`${baseUrl}${pathname}`, { redirect: "manual", signal: AbortSignal.timeout(10_000), ...options });
function check(condition, label, detail = "") {
  checks.push({ ok: Boolean(condition), label, detail });
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}
function securityHeaders(response, label) {
  check(response.headers.get("x-content-type-options") === "nosniff", `${label}: X-Content-Type-Options`);
  check(response.headers.get("x-frame-options") === "DENY", `${label}: X-Frame-Options`);
  check(Boolean(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'")), `${label}: CSP`);
}

try {
  const health = await request("/api/health");
  const healthBody = await health.json().catch(() => null);
  check(health.ok && healthBody?.status === "ok", "API viva", `HTTP ${health.status}`);
  check(Boolean(healthBody?.release), "API identifica a release");
  check(health.headers.get("cache-control") === "no-store", "Health sem cache");
  securityHeaders(health, "API");
  if (expectedRelease) {
    check(String(healthBody?.release ?? "").startsWith(expectedRelease), "Release publicada corresponde ao Git", `${healthBody?.release ?? "sem release"} != ${expectedRelease}`);
    check(String(health.headers.get("x-sigo-release") ?? "").startsWith(expectedRelease), "Header da release corresponde ao Git");
  }

  const ready = await request("/api/ready");
  const readyBody = await ready.json().catch(() => null);
  check(ready.ok && readyBody?.status === "ready", "Dependências prontas", `HTTP ${ready.status}, estado ${readyBody?.status ?? "inválido"}`);
  check(readyBody?.services?.database?.status === "ok", "PostgreSQL e migrations prontos");
  check(readyBody?.services?.plantService?.status === "ok", "Leitor de plantas pronto");

  const protectedResponse = await request("/api/dashboard");
  check(protectedResponse.status === 401, "Rota privada exige autenticação", `HTTP ${protectedResponse.status}`);
  const adminResponse = await request("/api/admin/operational-health");
  check(adminResponse.status === 401 || adminResponse.status === 403, "Diagnóstico administrativo está protegido", `HTTP ${adminResponse.status}`);

  const website = await request("/");
  const websiteHtml = await website.text();
  check(website.ok && website.headers.get("content-type")?.includes("text/html"), "Website disponível", `HTTP ${website.status}`);
  check(/<div[^>]+id=["']root["']/.test(websiteHtml), "Website contém a aplicação React");
  check(website.headers.get("cache-control")?.includes("no-cache"), "HTML principal não fica preso em cache");
  securityHeaders(website, "Website");

  const assetPath = websiteHtml.match(/(?:src|href)=["'](\/assets\/[^"']+)["']/)?.[1];
  check(Boolean(assetPath), "Website referencia um asset versionado");
  if (assetPath) {
    const asset = await request(assetPath);
    const mime = asset.headers.get("content-type") ?? "";
    check(asset.ok, "Asset principal disponível", `HTTP ${asset.status}`);
    check(!mime.includes("text/html"), "Asset principal tem MIME válido", mime || "sem Content-Type");
    check(asset.headers.get("cache-control")?.includes("immutable"), "Asset versionado tem cache imutável");
  }

  const supplier = await request("/fornecedor/");
  check(supplier.ok && supplier.headers.get("content-type")?.includes("text/html"), "Portal do fornecedor disponível", `HTTP ${supplier.status}`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

for (const item of checks) console.log(`${item.ok ? "✓" : "✗"} ${item.label}${item.detail && !item.ok ? ` — ${item.detail}` : ""}`);
if (failures.length) {
  console.error(`\nSIGO smoke test: ${failures.length} falha(s).`);
  process.exit(1);
}
console.log(`\nSIGO smoke test aprovado (${checks.length} controlos).`);
