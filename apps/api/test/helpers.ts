import type { FastifyInstance } from "fastify";
import { db, sql } from "../src/db/index.js";
import { companies, users, subscriptions } from "../src/db/schema.js";
import { hashPassword } from "../src/auth/password.js";
import type { UserRole } from "@sigo/shared";

// Limpa todas as tabelas entre testes/ficheiros — CASCADE porque há muitas FKs em cadeia
// (ex: line_items → budget_sections → budget_documents → projects → companies). Corre sempre
// contra "sigo_test" (garantido pelo vitest.config.ts + .env.test), nunca a base de
// desenvolvimento.
export async function truncateAll() {
  await sql`TRUNCATE TABLE
    sessions, users, subscriptions, companies,
    materials, labour_categories, equipment, price_zones, material_zone_prices,
    cost_compositions, composition_shares, composition_labour_lines, composition_material_lines, composition_equipment_lines,
    work_item_templates,
    projects, budget_documents, budget_sections, line_items, measurement_lines,
    measurement_certificates, measurement_certificate_lines,
    invoice_credit_notes, invoice_receipts, project_invoices,
    contract_variations, project_contracts,
    supplier_compliance_documents,
    project_client_payment_installments, project_client_payment_plans, project_client_share_settings,
    plants, extracted_rooms, extracted_rebar_schedules,
    financial_entries, audit_events, site_diary_entries, payment_proofs,
    suppliers, supplier_material_prices, supplier_labour_prices, supplier_equipment_prices,
    supplier_accounts, supplier_sessions, quote_requests, quote_request_lines, supplier_price_feeds,
    purchase_orders, purchase_order_lines, stock_movements, fuel_logs, warehouses, notifications,
    price_observations, mz_districts, mz_provinces, mz_holidays, fiscal_rate_profiles, price_zone_districts, payment_method_catalog,
    project_schedule_calendars, procurement_payment_terms_catalog,
    inspection_checklist_templates, quality_inspections, hst_records
  CASCADE`;
}

export async function createCompany(name: string) {
  const [company] = await db.insert(companies).values({ name, defaultCurrency: "MZN" }).returning();
  await db.insert(subscriptions).values({ companyId: company.id, plan: "profissional", status: "activo" });
  return company;
}

export async function createUser(companyId: string | null, role: UserRole, email: string, password = "password123") {
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ companyId, name: "Utilizador de Teste", email, passwordHash, role, emailVerifiedAt: new Date() }).returning();
  return user;
}

// Faz login via a própria API (não escreve a sessão directamente na BD) — testa o fluxo real
// de autenticação ao mesmo tempo que prepara o cookie para os pedidos seguintes.
export async function loginCookie(app: FastifyInstance, email: string, password = "password123"): Promise<string> {
  // Cada actor de teste recebe um IP de origem próprio. Assim, o rate limit real de login
  // continua a ser exercitado sem uma empresa de teste bloquear acidentalmente as outras.
  const testIp = `198.18.0.${Array.from(email).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 200 + 1}`;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-forwarded-for": testIp }, payload: { email, password } });
  if (res.statusCode !== 200) {
    throw new Error(`Login de teste falhou para ${email}: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = raw?.split(";")[0];
  if (!cookie) throw new Error(`Login de teste não devolveu cookie de sessão para ${email}`);
  return cookie;
}
