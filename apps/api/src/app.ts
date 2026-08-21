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
import { countryMzRoutes } from "./routes/countryMz.js";
import { priceObservationRoutes } from "./routes/priceObservations.js";
import { quickCalcRoutes } from "./routes/quickCalc.js";
import { costCompositionRoutes } from "./routes/costCompositions.js";
import { projectRoutes } from "./routes/projects.js";
import { budgetDocumentRoutes } from "./routes/budgetDocuments.js";
import { exportRoutes } from "./routes/export.js";
import { measurementCertificateRoutes } from "./routes/measurementCertificates.js";
import { plantRoutes } from "./routes/plants.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { measurementLineRoutes } from "./routes/measurementLines.js";
import { certificateFieldMeasurementRoutes } from "./routes/certificateFieldMeasurements.js";
import { quickEstimateRoutes } from "./routes/quickEstimate.js";
import { materialsByPhaseRoutes } from "./routes/materialsByPhase.js";
import { financialRoutes } from "./routes/financial.js";
import { siteDiaryRoutes } from "./routes/siteDiary.js";
import { fieldQualityRoutes } from "./routes/fieldQuality.js";
import { supplierRoutes } from "./routes/suppliers.js";
import { purchasingRoutes } from "./routes/purchasing.js";
import { procurementWorkflowRoutes } from "./routes/procurementWorkflow.js";
import { procurementFulfillmentRoutes } from "./routes/procurementFulfillment.js";
import { procurementAccountsPayableRoutes } from "./routes/procurementAccountsPayable.js";
import { procurementFiscalControlRoutes } from "./routes/procurementFiscalControl.js";
import { procurementIntelligenceRoutes } from "./routes/procurementIntelligence.js";
import { fileRoutes } from "./routes/files.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { auditRoutes } from "./routes/audit.js";
import { projectControlRoutes } from "./routes/projectControl.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { contractRoutes } from "./routes/contracts.js";
import { workChapterRoutes } from "./routes/workChapters.js";
import { practiceRoutes } from "./routes/practice.js";
import { publicShareRoutes } from "./routes/publicShare.js";
import { clientPaymentRoutes } from "./routes/clientPayments.js";
import { leadRoutes } from "./routes/leads.js";
import { supplierAuthRoutes } from "./routes/supplierAuth.js";
import { supplierPortalRoutes } from "./routes/supplierPortal.js";
import { quoteRequestRoutes } from "./routes/quoteRequests.js";
import { adminSupplierRoutes } from "./routes/adminSuppliers.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { notificationRoutes } from "./routes/notifications.js";
import { documentReviewCommentRoutes } from "./routes/documentReviewComments.js";
import { projectTeamRoutes, workflowTaskRoutes } from "./routes/projectTeam.js";
import { mutationOriginAllowed, SECURITY_HEADERS, auditSecurityHeaders } from "./services/httpSecurity.js";
import { captureException } from "./services/monitoring.js";
import { normalizeSigoDecimals } from "@sigo/shared";
import { recordHttpResponse } from "./services/httpMetrics.js";

function expectedMigrationAt(): number {
  try {
    const journalPath = path.resolve(process.cwd(), "drizzle/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries?: Array<{ when?: unknown }> };
    return Math.max(0, ...(journal.entries ?? []).map((entry) => Number(entry.when ?? 0)).filter(Number.isFinite));
  } catch {
    return 0;
  }
}
const EXPECTED_MIGRATION_AT = expectedMigrationAt();

type ServiceCheck = { status: "ok" | "error"; latencyMs: number; detail?: string; version?: string };

async function databaseReadiness(): Promise<ServiceCheck & { migrationCurrent?: number; migrationExpected: number }> {
  const startedAt = Date.now();
  const migrationExpected = EXPECTED_MIGRATION_AT;
  try {
    await sql`select 1`;
    const rows = await sql<{ createdAt: string | null }[]>`
      select max(created_at)::text as "createdAt" from drizzle.__drizzle_migrations
    `;
    const migrationCurrent = Number(rows[0]?.createdAt ?? 0);
    if (migrationExpected === 0) {
      return { status: "error", latencyMs: Date.now() - startedAt, detail: "migration_manifest_unavailable", migrationCurrent, migrationExpected };
    }
    if (migrationCurrent < migrationExpected) {
      return { status: "error", latencyMs: Date.now() - startedAt, detail: "pending_migrations", migrationCurrent, migrationExpected };
    }
    return { status: "ok", latencyMs: Date.now() - startedAt, migrationCurrent, migrationExpected };
  } catch {
    return { status: "error", latencyMs: Date.now() - startedAt, detail: "database_unavailable", migrationExpected };
  }
}

async function plantServiceReadiness(): Promise<ServiceCheck> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${env.plantServiceUrl}/health`, {
      headers: env.plantServiceToken ? { "x-internal-token": env.plantServiceToken } : undefined,
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return { status: "error", latencyMs: Date.now() - startedAt, detail: `http_${response.status}` };
    const body = await response.json() as { status?: unknown; parserVersion?: unknown };
    if (body.status !== "ok") return { status: "error", latencyMs: Date.now() - startedAt, detail: "invalid_response" };
    return { status: "ok", latencyMs: Date.now() - startedAt, version: typeof body.parserVersion === "string" ? body.parserVersion : undefined };
  } catch {
    return { status: "error", latencyMs: Date.now() - startedAt, detail: "plant_service_unavailable" };
  }
}

async function mailReadiness(): Promise<ServiceCheck & { stub?: boolean }> {
  const startedAt = Date.now();
  try {
    const { isMailEnabled } = await import("./services/mailer.js");
    const enabled = isMailEnabled();
    return {
      status: "ok",
      latencyMs: Date.now() - startedAt,
      detail: enabled ? "smtp_configured" : "stub_log_only",
      stub: !enabled,
    };
  } catch {
    return { status: "error", latencyMs: Date.now() - startedAt, detail: "mail_check_failed", stub: true };
  }
}

async function storageReadiness(): Promise<ServiceCheck> {
  const startedAt = Date.now();
  try {
    const { access, constants } = await import("node:fs/promises");
    await access(env.uploadsDir, constants.R_OK | constants.W_OK);
    return { status: "ok", latencyMs: Date.now() - startedAt, detail: "uploads_rw" };
  } catch {
    return { status: "error", latencyMs: Date.now() - startedAt, detail: "uploads_unavailable" };
  }
}

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
    reply.header("X-SIGO-Release", env.release);
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

  app.addHook("onResponse", async (request, reply) => {
    // A rota declarada (ex.: /api/projects/:id) evita guardar IDs, tokens ou query strings e
    // permite descobrir gargalos reais sem cardinalidade ilimitada.
    recordHttpResponse(reply.statusCode, reply.elapsedTime, request.routeOptions.url);
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

  // Liveness não depende da base: distingue processo caído de dependência indisponível.
  app.get("/api/health", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { status: "ok", release: env.release, uptimeSeconds: Math.round(process.uptime()) };
  });

  // Readiness verifica em paralelo a base, migrações e o leitor de plantas.
  app.get("/api/ready", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const [database, plantService, mail, storage] = await Promise.all([
      databaseReadiness(),
      plantServiceReadiness(),
      mailReadiness(),
      storageReadiness(),
    ]);
    const coreReady = database.status === "ok";
    const fullyOperational = coreReady && plantService.status === "ok" && storage.status === "ok";
    const security = auditSecurityHeaders(Object.fromEntries(
      Object.entries(SECURITY_HEADERS).map(([k, v]) => [k.toLowerCase(), v]),
    ));
    return reply.code(coreReady ? 200 : 503).send({
      status: fullyOperational ? "ready" : "degraded",
      release: env.release,
      services: { database, plantService, mail, storage },
      securityHeaders: security,
      notes: [
        mail.stub ? "Mail em modo stub (SMTP não configurado) — notificações ficam só in-app." : "Mail SMTP configurado.",
        storage.status === "ok" ? "Storage de uploads acessível." : "Storage indisponível — uploads falham.",
        plantService.status !== "ok" ? "Plant-service degradado — novos PDFs aguardam." : null,
      ].filter(Boolean),
    });
  });

  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(userRoutes);
  await app.register(catalogRoutes);
  await app.register(priceZoneRoutes);
  await app.register(countryMzRoutes);
  await app.register(priceObservationRoutes);
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
  await app.register(certificateFieldMeasurementRoutes);
  await app.register(quickEstimateRoutes);
  await app.register(materialsByPhaseRoutes);
  await app.register(financialRoutes);
  await app.register(siteDiaryRoutes);
  await app.register(fieldQualityRoutes);
  await app.register(supplierRoutes);
  await app.register(purchasingRoutes);
  await app.register(procurementWorkflowRoutes);
  await app.register(procurementFulfillmentRoutes);
  await app.register(procurementAccountsPayableRoutes);
  await app.register(procurementFiscalControlRoutes);
  await app.register(procurementIntelligenceRoutes);
  await app.register(scheduleRoutes);
  await app.register(auditRoutes);
  await app.register(projectControlRoutes);
  await app.register(invoiceRoutes);
  await app.register(contractRoutes);
  await app.register(workChapterRoutes);
  await app.register(practiceRoutes);
  await app.register(publicShareRoutes);
  await app.register(clientPaymentRoutes);
  await app.register(leadRoutes);
  await app.register(supplierAuthRoutes);
  await app.register(supplierPortalRoutes);
  await app.register(quoteRequestRoutes);
  await app.register(adminSupplierRoutes);
  await app.register(marketplaceRoutes);
  await app.register(notificationRoutes);
  await app.register(documentReviewCommentRoutes);
  await app.register(projectTeamRoutes);
  await app.register(workflowTaskRoutes);

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
