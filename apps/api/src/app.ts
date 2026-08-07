import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { env } from "./env.js";
import { sql } from "./db/index.js";
import { authRoutes } from "./routes/auth.js";
import { companyRoutes } from "./routes/companies.js";
import { userRoutes } from "./routes/users.js";
import { catalogRoutes } from "./routes/catalog.js";
import { priceZoneRoutes } from "./routes/priceZones.js";
import { quickCalcRoutes } from "./routes/quickCalc.js";
import { costCompositionRoutes } from "./routes/costCompositions.js";
import { projectRoutes } from "./routes/projects.js";
import { budgetDocumentRoutes } from "./routes/budgetDocuments.js";
import { exportRoutes } from "./routes/export.js";
import { measurementCertificateRoutes } from "./routes/measurementCertificates.js";
import { plantRoutes } from "./routes/plants.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { measurementLineRoutes } from "./routes/measurementLines.js";
import { quickEstimateRoutes } from "./routes/quickEstimate.js";
import { materialsByPhaseRoutes } from "./routes/materialsByPhase.js";
import { financialRoutes } from "./routes/financial.js";
import { siteDiaryRoutes } from "./routes/siteDiary.js";
import { supplierRoutes } from "./routes/suppliers.js";
import { purchasingRoutes } from "./routes/purchasing.js";
import { fileRoutes } from "./routes/files.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { auditRoutes } from "./routes/audit.js";
import { projectControlRoutes } from "./routes/projectControl.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { contractRoutes } from "./routes/contracts.js";
import { workChapterRoutes } from "./routes/workChapters.js";
import { practiceRoutes } from "./routes/practice.js";
import { publicShareRoutes } from "./routes/publicShare.js";
import { leadRoutes } from "./routes/leads.js";
import { supplierAuthRoutes } from "./routes/supplierAuth.js";
import { supplierPortalRoutes } from "./routes/supplierPortal.js";
import { quoteRequestRoutes } from "./routes/quoteRequests.js";
import { adminSupplierRoutes } from "./routes/adminSuppliers.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { notificationRoutes } from "./routes/notifications.js";
import { mutationOriginAllowed, SECURITY_HEADERS } from "./services/httpSecurity.js";
import { captureException } from "./services/monitoring.js";
import { normalizeSigoDecimals } from "@sigo/shared";

// Separado de index.ts (que só chama isto e depois app.listen()) para os testes poderem
// construir a mesma app real e usar app.inject() — pedidos HTTP simulados em memória, sem abrir
// nenhuma porta nem precisar de um processo servidor a correr à parte.
export async function buildApp(opts: { logger?: boolean } = {}) {
  // trustProxy: a aplicação corre sempre atrás de um proxy (Nginx/CloudPanel em produção, o
  // proxy do Vite em dev) — sem isto, request.ip via o IP interno do proxy, não o do cliente
  // real, o que quebra o rate-limit por IP do login (todos os pedidos pareciam vir do mesmo
  // sítio) e torna os logs inúteis para investigar abuso.
  // `opts.logger`: só usado pelos testes, para silenciar o pino durante a suite — sem isto
  // fica `true` tal como sempre esteve (dev e produção).
  const app = Fastify({
    logger: opts.logger ?? true,
    // Em produção existe exactamente um proxy CloudPanel/Nginx à frente da API. Limitar a um
    // salto impede um cliente directo de forjar cadeias X-Forwarded-For arbitrárias.
    trustProxy: env.isProduction ? 1 : true,
    bodyLimit: 5 * 1024 * 1024,
    requestIdHeader: "x-request-id",
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!mutationOriginAllowed({ production: env.isProduction, method: request.method, origin: request.headers.origin, host: request.headers.host, forwardedHost: typeof request.headers["x-forwarded-host"] === "string" ? request.headers["x-forwarded-host"] : undefined, fetchSite: typeof request.headers["sec-fetch-site"] === "string" ? request.headers["sec-fetch-site"] : undefined, allowedOrigins: env.corsOrigin })) return reply.code(403).send({ error: "Origem do pedido não autorizada" });
  });

  // Uma única regra de precisão desde a entrada: toda carga JSON chega aos
  // serviços com no máximo duas casas decimais. Contagens inteiras mantêm-se
  // inteiras; cálculos internos continuam a usar Number sem cortes intermédios.
  app.addHook("preValidation", async (request) => {
    if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
      request.body = normalizeSigoDecimals(request.body);
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    const requestUrl = request.raw.url ?? "";
    if (requestUrl.startsWith("/api/") && !requestUrl.startsWith("/api/health")) {
      reply.header("Cache-Control", "no-store");
    } else if (requestUrl.startsWith("/assets/")) {
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
    } else if (
      requestUrl === "/" ||
      requestUrl.startsWith("/index.html") ||
      requestUrl.startsWith("/sw.js") ||
      requestUrl.startsWith("/registerSW.js") ||
      requestUrl.startsWith("/manifest.webmanifest")
    ) {
      reply.header("Cache-Control", "no-cache, must-revalidate");
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : null;
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({ error: error instanceof Error ? error.message : "Pedido inválido", requestId: request.id });
    }
    captureException(error, { requestId: request.id, url: request.url, method: request.method });
    return reply.code(500).send({ error: "Erro interno. Tente novamente.", requestId: request.id });
  });

  // Em produção, só as origens listadas em CORS_ORIGIN podem fazer pedidos com credenciais
  // (cookies) — "origin: true" (reflectir qualquer origem) combinado com credentials:true era
  // sinalizado como má prática mesmo estando o cookie de sessão protegido por sameSite=lax
  // (achado da auditoria). Em dev, sem CORS_ORIGIN definido, mantém-se permissivo (portas locais
  // variáveis do Vite).
  await app.register(cors, {
    origin: env.corsOrigin ?? (env.isProduction ? false : true),
    credentials: true,
  });
  await app.register(cookie, { secret: env.sessionCookieSecret });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 5, fields: 20, parts: 25 } });
  // Só o logótipo da empresa e o avatar de perfil são públicos de propósito (mostrados em
  // contextos sem sessão própria — ex: branding no login, ou o avatar de outro utilizador da
  // mesma equipa). Plantas e fotografias do diário de obra são dados privados de cada empresa —
  // deixaram de ser servidos aqui, ver routes/files.ts (rotas autenticadas com verificação de posse).
  await app.register(fastifyStatic, { root: path.resolve(env.uploadsDir, "logos"), prefix: "/uploads/logos/" });
  await app.register(fastifyStatic, { root: path.resolve(env.uploadsDir, "avatars"), prefix: "/uploads/avatars/", decorateReply: false });

  app.get("/api/health", async () => {
    const [{ now }] = await sql<{ now: Date }[]>`select now()`;
    return { status: "ok", dbTime: now };
  });

  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(userRoutes);
  await app.register(catalogRoutes);
  await app.register(priceZoneRoutes);
  await app.register(quickCalcRoutes);
  await app.register(costCompositionRoutes);
  await app.register(projectRoutes);
  await app.register(budgetDocumentRoutes);
  await app.register(exportRoutes);
  await app.register(measurementCertificateRoutes);
  await app.register(plantRoutes);
  await app.register(fileRoutes);
  await app.register(dashboardRoutes);
  await app.register(measurementLineRoutes);
  await app.register(quickEstimateRoutes);
  await app.register(materialsByPhaseRoutes);
  await app.register(financialRoutes);
  await app.register(siteDiaryRoutes);
  await app.register(supplierRoutes);
  await app.register(purchasingRoutes);
  await app.register(scheduleRoutes);
  await app.register(auditRoutes);
  await app.register(projectControlRoutes);
  await app.register(invoiceRoutes);
  await app.register(contractRoutes);
  await app.register(workChapterRoutes);
  await app.register(practiceRoutes);
  await app.register(publicShareRoutes);
  await app.register(leadRoutes);
  await app.register(supplierAuthRoutes);
  await app.register(supplierPortalRoutes);
  await app.register(quoteRequestRoutes);
  await app.register(adminSupplierRoutes);
  await app.register(marketplaceRoutes);
  await app.register(notificationRoutes);

  // Em produção corremos um único processo Node (padrão CloudPanel: um domínio → um appPort) —
  // a API também serve os builds do frontend, em vez de depender de um Nginx separado a servir
  // ficheiros estáticos. Em desenvolvimento o Vite serve cada frontend à parte, por isso estas
  // pastas normalmente não existem localmente e este bloco fica inactivo.
  //
  // São dois sites distintos, de propósito: o painel SIGO (utilizadores do sistema) e o Portal
  // do Fornecedor (apps/supplier) NUNCA partilham bundle, rotas, layout ou navegação entre si —
  // só a base de dados e a API é que são comuns. "/fornecedor" está isolado como prefixo próprio
  // com o seu próprio index.html; nada dentro dele cai de volta no SPA principal, e o SPA
  // principal nunca serve nada sob esse prefixo. Se um subdomínio próprio (ex:
  // fornecedor.sigomz.com) vier a ser configurado no Nginx/CloudPanel, este bloco deixa de ser
  // necessário para o Portal do Fornecedor sem precisar de mudar código nenhum — só configurar
  // SUPPLIER_PUBLIC_URL e apontar esse subdomínio para o mesmo processo ou para outro.
  const webDistDir = path.resolve(process.cwd(), "../web/dist");
  const webIndexHtml = path.join(webDistDir, "index.html");
  const supplierDistDir = path.resolve(process.cwd(), "../supplier/dist");
  const supplierIndexHtml = path.join(supplierDistDir, "index.html");

  if (existsSync(supplierIndexHtml)) {
    await app.register(fastifyStatic, { root: supplierDistDir, prefix: "/fornecedor/", decorateReply: false });
  }

  if (existsSync(webIndexHtml)) {
    await app.register(fastifyStatic, { root: webDistDir, prefix: "/", decorateReply: false });
    app.setNotFoundHandler((request, reply) => {
      const requestPath = (request.raw.url ?? "/").split("?", 1)[0];

      if (requestPath.startsWith("/fornecedor")) {
        if (!existsSync(supplierIndexHtml)) {
          reply.code(404).send({ error: "Não encontrado" });
          return;
        }
        reply.header("Cache-Control", "no-cache, must-revalidate").type("text/html").send(readFileSync(supplierIndexHtml));
        return;
      }

      const isStaticAsset = requestPath.startsWith("/assets/")
        || requestPath.startsWith("/fonts/")
        || /^\/(?:favicon|icon-|apple-touch-icon|manifest\.webmanifest|sw\.js|registerSW\.js)/.test(requestPath);
      if (requestPath.startsWith("/api/") || requestPath.startsWith("/uploads/") || isStaticAsset) {
        reply.code(404).send({ error: "Não encontrado" });
        return;
      }
      reply.header("Cache-Control", "no-cache, must-revalidate").type("text/html").send(readFileSync(webIndexHtml));
    });
  }

  return app;
}
