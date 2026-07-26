import { eq } from "drizzle-orm";
import { db, sql } from "./index.js";
import { companies, users, subscriptions } from "./schema.js";
import { hashPassword } from "../auth/password.js";
import { seedCatalog } from "./seedCatalog.js";
import { seedNationalZonePrices } from "./seedNationalZones.js";

async function ensureSuperAdmin() {
  const email = "super@sigo.local";
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log("super_admin já existe:", email);
    return;
  }
  const passwordHash = await hashPassword("admin123");
  await db.insert(users).values({
    companyId: null,
    name: "Super Admin",
    email,
    passwordHash,
    role: "super_admin",
  });
  console.log("super_admin criado:", email, "/ admin123");
}

async function ensureDemoCompany() {
  const email = "demo@empresa.local";
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log("empresa de demonstração já existe:", email);
    return;
  }
  const [company] = await db
    .insert(companies)
    .values({ name: "Empresa Demo Lda", nuit: "400000000", defaultCurrency: "MZN" })
    .returning();

  const passwordHash = await hashPassword("demo123");
  await db.insert(users).values({
    companyId: company.id,
    name: "Admin Demo",
    email,
    passwordHash,
    role: "admin_empresa",
  });

  await db.insert(subscriptions).values({ companyId: company.id, plan: "standard", status: "activo" });
  console.log("empresa de demonstração criada:", email, "/ demo123");
}

async function main() {
  await ensureSuperAdmin();
  await ensureDemoCompany();
  await seedCatalog();
  await seedNationalZonePrices();
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
