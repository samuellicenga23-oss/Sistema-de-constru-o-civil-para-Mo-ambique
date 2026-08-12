import { describe, expect, it } from "vitest";
import { validateEnvironment } from "../src/envValidation.js";

describe("Guardas de produção", () => {
  const base = { DATABASE_URL: "postgres://x:x@localhost:5432/x", NODE_ENV: "production", PUBLIC_URL: "https://sigomz.com" };

  it("recusa produção sem SESSION_COOKIE_SECRET", () => {
    expect(() => validateEnvironment({ ...base, PLANT_SERVICE_TOKEN: "algo" })).toThrow("SESSION_COOKIE_SECRET");
  });

  it("recusa o segredo de desenvolvimento em produção", () => {
    expect(() => validateEnvironment({ ...base, SESSION_COOKIE_SECRET: "dev-secret-change-me", PLANT_SERVICE_TOKEN: "algo" })).toThrow("SESSION_COOKIE_SECRET");
  });

  it("recusa produção sem PLANT_SERVICE_TOKEN", () => {
    expect(() => validateEnvironment({ ...base, SESSION_COOKIE_SECRET: "algo-forte" })).toThrow("PLANT_SERVICE_TOKEN");
  });

  it("aceita produção com segredos e URL pública", () => {
    expect(() => validateEnvironment({ ...base, SESSION_COOKIE_SECRET: "algo-forte-aleatorio", PLANT_SERVICE_TOKEN: "token-forte" })).not.toThrow();
  });

  it("recusa produção sem qualquer URL pública", () => {
    expect(() => validateEnvironment({ NODE_ENV: "production", SESSION_COOKIE_SECRET: "algo-forte-aleatorio", PLANT_SERVICE_TOKEN: "token-forte" })).toThrow("PUBLIC_URL");
  });

  it("aceita desenvolvimento sem segredos", () => {
    expect(() => validateEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });
});
