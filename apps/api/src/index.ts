import { initMonitoring, captureException } from "./services/monitoring.js";

initMonitoring();

import { buildApp } from "./app.js";
import { sql } from "./db/index.js";
import { env } from "./env.js";
import { resumePlantProcessingJobs } from "./routes/plants.js";
import { resumeMeasurementImportJobs } from "./services/measurementImportJobs.js";
import { startWeeklyProjectTrashScheduler } from "./services/projectStorage.js";
import { startSubscriptionReminderScheduler } from "./services/subscriptionReminders.js";
import { startSupplierPriceFeedScheduler } from "./services/supplierPriceFeed.js";
import { startQuoteRequestExpiryScheduler } from "./services/quoteRequestExpiry.js";

const app = await buildApp();
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Graceful shutdown started");
  const forcedExit = setTimeout(() => {
    app.log.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forcedExit.unref();
  try {
    await app.close();
    await sql.end({ timeout: 5 });
    clearTimeout(forcedExit);
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.on("unhandledRejection", (reason) => {
  app.log.error({ reason }, "Unhandled promise rejection");
  captureException(reason);
});
process.on("uncaughtException", (error) => {
  app.log.fatal(error, "Uncaught exception");
  captureException(error);
  void shutdown("uncaughtException");
});

try {
  await app.listen({ port: env.port, host: "0.0.0.0" });
  const resumedPlantJobs = await resumePlantProcessingJobs();
  if (resumedPlantJobs > 0) app.log.info({ count: resumedPlantJobs }, "Resumed plant jobs");
  const resumedImportJobs = await resumeMeasurementImportJobs();
  if (resumedImportJobs > 0) app.log.info({ count: resumedImportJobs }, "Resumed measurement import jobs");
  startWeeklyProjectTrashScheduler(app.log);
  startSubscriptionReminderScheduler(app.log);
  startSupplierPriceFeedScheduler(app.log);
  startQuoteRequestExpiryScheduler(app.log);
} catch (error) {
  app.log.fatal(error, "API failed to start");
  captureException(error);
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
}
