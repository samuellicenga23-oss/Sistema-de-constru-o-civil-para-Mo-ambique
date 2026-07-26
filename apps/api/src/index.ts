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

const app = Fastify({ logger: true });

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
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await app.register(fastifyStatic, { root: path.resolve(env.uploadsDir), prefix: "/uploads/" });

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
await app.register(dashboardRoutes);
await app.register(measurementLineRoutes);
await app.register(quickEstimateRoutes);
await app.register(materialsByPhaseRoutes);
await app.register(financialRoutes);
await app.register(siteDiaryRoutes);
await app.register(supplierRoutes);
await app.register(purchasingRoutes);

// Em produção corremos um único processo Node (padrão CloudPanel: um domínio → um appPort) —
// a API também serve o build do frontend, em vez de depender de um Nginx separado a servir
// ficheiros estáticos. Em desenvolvimento o Vite serve o frontend à parte, por isso esta pasta
// normalmente não existe localmente e o bloco fica inactivo.
const webDistDir = path.resolve(process.cwd(), "../web/dist");
const webIndexHtml = path.join(webDistDir, "index.html");
if (existsSync(webIndexHtml)) {
  await app.register(fastifyStatic, { root: webDistDir, prefix: "/", decorateReply: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/") || request.raw.url?.startsWith("/uploads/")) {
      reply.code(404).send({ error: "Não encontrado" });
      return;
    }
    reply.type("text/html").send(readFileSync(webIndexHtml));
  });
}

app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
