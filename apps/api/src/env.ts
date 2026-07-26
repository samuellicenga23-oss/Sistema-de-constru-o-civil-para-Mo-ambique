import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 4000),
  sessionCookieSecret: process.env.SESSION_COOKIE_SECRET ?? "dev-secret-change-me",
  plantServiceUrl: process.env.PLANT_SERVICE_URL ?? "http://localhost:8001",
  // Segredo partilhado enviado ao plant-service (ver PLANT_SERVICE_TOKEN aí) — undefined em dev
  // sem configuração, tal como o resto dos controlos "seguro em produção, permissivo em dev".
  plantServiceToken: process.env.PLANT_SERVICE_TOKEN,
  uploadsDir: process.env.UPLOADS_DIR ?? "./uploads",
  isProduction: process.env.NODE_ENV === "production",
  // Origem(ns) permitida(s) para CORS, separadas por vírgula (ex: "https://app.mediobra.co.mz").
  // Em produção sem isto definido, o CORS fica fechado por omissão (nenhuma origem externa) —
  // só o próprio domínio (via Nginx, mesma origem) funciona sem precisar de CORS. Em
  // desenvolvimento, sem isto definido, aceita qualquer origem (útil com portas locais variáveis).
  corsOrigin: process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()) ?? null,
};
