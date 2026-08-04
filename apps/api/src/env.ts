import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const isProduction = process.env.NODE_ENV === "production";
const DEV_SESSION_SECRET = "dev-secret-change-me";

// Em produção, estes dois segredos nunca podem ficar por omissão — sem isto a aplicação
// arrancava "a funcionar" com um cookie de sessão previsível (qualquer atacante que leia o
// código-fonte consegue forjar sessões) ou com o plant-service acessível sem autenticação
// interna. Falhar cedo no arranque é preferível a descobrir isto depois de estar exposto.
if (isProduction) {
  const sessionSecret = process.env.SESSION_COOKIE_SECRET;
  if (!sessionSecret || sessionSecret === DEV_SESSION_SECRET) {
    throw new Error(
      "SESSION_COOKIE_SECRET tem de estar definido em produção (e diferente do valor de desenvolvimento)."
    );
  }
  if (!process.env.PLANT_SERVICE_TOKEN) {
    throw new Error("PLANT_SERVICE_TOKEN tem de estar definido em produção.");
  }
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 4000),
  sessionCookieSecret: process.env.SESSION_COOKIE_SECRET ?? DEV_SESSION_SECRET,
  plantServiceUrl: process.env.PLANT_SERVICE_URL ?? "http://127.0.0.1:8001",
  // Segredo partilhado enviado ao plant-service (ver PLANT_SERVICE_TOKEN aí) — undefined em dev
  // sem configuração, tal como o resto dos controlos "seguro em produção, permissivo em dev".
  // Obrigatório em produção (verificado acima, antes deste objecto ser construído).
  plantServiceToken: process.env.PLANT_SERVICE_TOKEN,
  uploadsDir: process.env.UPLOADS_DIR ?? "./uploads",
  isProduction,
  // Origem(ns) permitida(s) para CORS, separadas por vírgula (ex: "https://app.mediobra.co.mz").
  // Em produção sem isto definido, o CORS fica fechado por omissão (nenhuma origem externa) —
  // só o próprio domínio (via Nginx, mesma origem) funciona sem precisar de CORS. Em
  // desenvolvimento, sem isto definido, aceita qualquer origem (útil com portas locais variáveis).
  corsOrigin: process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()) ?? null,
  // Login com Google (OAuth 2.0 "Authorization Code", ver src/routes/auth.ts). Sem estas três
  // variáveis definidas, o botão "Entrar com Google" fica escondido no frontend (GET
  // /api/auth/config devolve googleEnabled:false) — não é um erro, só significa "não configurado".
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
  // Tem de ser IGUAL, byte a byte, ao URI registado no Google Cloud Console (ex:
  // https://sud30s.org/api/auth/google/callback). Nunca é derivado do pedido recebido — o Google
  // exige uma correspondência exacta com o que está registado, por isso é sempre explícito aqui.
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || null,
  // Para onde reencaminhar o browser depois do callback do Google. Em produção (frontend e API no
  // mesmo processo/domínio) fica vazio de propósito — um caminho relativo ("/") já aponta para o
  // sítio certo. Só é preciso definir em desenvolvimento, onde o Vite corre numa porta diferente
  // da API (ex: FRONTEND_URL=http://localhost:5273).
  frontendUrl: process.env.FRONTEND_URL ?? "",
};
