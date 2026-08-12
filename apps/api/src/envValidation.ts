export const DEV_SESSION_SECRET = "dev-secret-change-me";

export function validateEnvironment(values: NodeJS.ProcessEnv) {
  if (values.NODE_ENV !== "production") return;
  const sessionSecret = values.SESSION_COOKIE_SECRET;
  if (!sessionSecret || sessionSecret === DEV_SESSION_SECRET) {
    throw new Error("SESSION_COOKIE_SECRET tem de estar definido em produção (e diferente do valor de desenvolvimento).");
  }
  if (!values.PLANT_SERVICE_TOKEN) throw new Error("PLANT_SERVICE_TOKEN tem de estar definido em produção.");
  if (!values.PUBLIC_URL && !values.FRONTEND_URL && !values.SUPPLIER_PUBLIC_URL) {
    throw new Error("PUBLIC_URL (ou FRONTEND_URL / SUPPLIER_PUBLIC_URL) tem de estar definido em produção para links em emails.");
  }
}
