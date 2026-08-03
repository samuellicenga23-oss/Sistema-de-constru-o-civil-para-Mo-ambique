import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { mutationOriginAllowed } from "../src/services/httpSecurity.js";

describe("Segurança HTTP", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ logger: false }); });
  afterAll(async () => { await app.close(); });

  it("envia cabeçalhos defensivos e evita cache de dados da API", async () => {
    const response = await app.inject({ method: "GET", url: "/api/auth/config" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("bloqueia mutações de origem cruzada em produção", () => {
    expect(mutationOriginAllowed({ production: true, method: "POST", host: "sud30s.org", origin: "https://evil.example", fetchSite: "cross-site" })).toBe(false);
    expect(mutationOriginAllowed({ production: true, method: "POST", host: "sud30s.org", origin: "https://evil.example" })).toBe(false);
  });

  it("aceita mesma origem, origens explicitamente permitidas e pedidos não-browser", () => {
    expect(mutationOriginAllowed({ production: true, method: "POST", host: "sud30s.org", origin: "https://sud30s.org", fetchSite: "same-origin" })).toBe(true);
    expect(mutationOriginAllowed({ production: true, method: "POST", host: "api.sud30s.org", origin: "https://app.sud30s.org", allowedOrigins: ["https://app.sud30s.org"] })).toBe(true);
    expect(mutationOriginAllowed({ production: true, method: "POST", host: "sud30s.org" })).toBe(true);
  });
});
