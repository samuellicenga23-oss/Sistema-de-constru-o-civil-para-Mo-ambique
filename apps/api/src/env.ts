import "dotenv/config";
import { execFileSync } from "node:child_process";
import { DEV_SESSION_SECRET, validateEnvironment } from "./envValidation.js";

function detectedRelease(): string {
  if (process.env.SIGO_RELEASE) return process.env.SIGO_RELEASE;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "dev";
  } catch {
    return "dev";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const isProduction = process.env.NODE_ENV === "production";

// Em produção, estes dois segredos nunca podem ficar por omissão — sem isto a aplicação
// arrancava "a funcionar" com um cookie de sessão previsível (qualquer atacante que leia o
// código-fonte consegue forjar sessões) ou com o plant-service acessível sem autenticação
// interna. Falhar cedo no arranque é preferível a descobrir isto depois de estar exposto.
validateEnvironment(process.env);

export const env = {
  // Identificador comum ao frontend e à API (idealmente o SHA curto do commit).
  release: detectedRelease(),
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 4000),
  sessionCookieSecret: process.env.SESSION_COOKIE_SECRET ?? DEV_SESSION_SECRET,
  plantServiceUrl: process.env.PLANT_SERVICE_URL ?? "http://127.0.0.1:8001",
  // Segredo partilhado enviado ao plant-service (ver PLANT_SERVICE_TOKEN aí) — undefined em dev
  // sem configuração, tal como o resto dos controlos "seguro em produção, permissivo em dev".
  // Obrigatório em produção (verificado acima, antes deste objecto ser construído).
  plantServiceToken: process.env.PLANT_SERVICE_TOKEN,
  uploadsDir: process.env.UPLOADS_DIR ?? "./uploads",
  backupDir: process.env.SIGO_BACKUP_DIR ?? (isProduction ? "/home/sigo/backups" : "./backups"),
  operationalCheckIntervalMs: Number(process.env.OPERATIONAL_CHECK_INTERVAL_MS ?? 300_000),
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
  // URL pública e absoluta do site — para links dentro de emails, que (ao contrário de um
  // redirect no browser) não têm uma página "actual" para resolver um caminho relativo contra.
  // `frontendUrl` fica vazio de propósito em produção (mesma origem); este NUNCA pode ficar
  // vazio em produção, ou os links nos emails saem partidos. Defina como "https://sigomz.com".
  publicUrl: process.env.PUBLIC_URL || process.env.FRONTEND_URL || "http://localhost:5273",
  // Portal do Fornecedor é um SITE À PARTE (apps/supplier), nunca uma rota do SPA principal —
  // nem os utilizadores do sistema o alcançam a partir do painel, nem um fornecedor consegue
  // navegar para o painel a partir daqui. Em produção fica por omissão sob "/fornecedor" no
  // mesmo domínio (ver o mapeamento estático em app.ts); definir SUPPLIER_PUBLIC_URL para um
  // subdomínio próprio (ex: "https://fornecedor.sigomz.com") quando isso for configurado no
  // Nginx/CloudPanel, sem precisar de mudar nenhum código. Em dev aponta para o servidor Vite
  // próprio deste site (porta 5174, nunca a 5273 do painel principal).
  supplierPublicUrl: (() => {
    if (process.env.SUPPLIER_PUBLIC_URL) return process.env.SUPPLIER_PUBLIC_URL.replace(/\/$/, "");
    if (!isProduction) return "http://localhost:5174/fornecedor";
    const base = (process.env.PUBLIC_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
    return base ? `${base}/fornecedor` : "http://localhost:5174/fornecedor";
  })(),
  // Envio de email transaccional (notificações, comprovativos, subscrição a expirar). Sem estas
  // três variáveis definidas, o mailer fica "desligado" — regista no log em vez de enviar, para
  // nunca rebentar um pedido só porque o email falhou. Gmail SMTP com "App Password" é o caminho
  // mais simples sem custos (myaccount.google.com/apppasswords, exige verificação em 2 passos).
  smtpHost: process.env.SMTP_HOST || null,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER || null,
  smtpPass: process.env.SMTP_PASS || null,
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_USER || null,
  // Monitorização de erros (Sentry, tier grátis até 5k eventos/mês). Sem isto definido, os erros
  // continuam só no log do servidor — não deixa de funcionar, só não avisa proactivamente.
  sentryDsn: process.env.SENTRY_DSN || null,
  // Extractor fiscal opcional (OCR/IA). Sem configuração o fluxo mantém conferência manual;
  // o resultado deste serviço nunca aprova uma factura automaticamente.
  fiscalExtractorUrl: process.env.FISCAL_EXTRACTOR_URL || null,
  fiscalExtractorToken: process.env.FISCAL_EXTRACTOR_TOKEN || null,
};
