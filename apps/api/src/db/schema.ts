import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  pgEnum,
  date,
  jsonb,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { COMPANY_MODULE_KEYS, type CompanyModuleKey, type DocumentAnalysis } from "@sigo/shared";

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin_empresa",
  "orcamentista",
  "engenheiro_fiscal",
  "visualizador",
]);
export const currencyEnum = pgEnum("currency", ["MZN", "USD"]);
export const unitEnum = pgEnum("unit", ["m", "m2", "m3", "ml", "kg", "un", "vg", "h"]);
export const lineItemKindEnum = pgEnum("line_item_kind", ["capitulo", "grupo", "item", "nota"]);
export const lineItemOriginEnum = pgEnum("line_item_origin", ["manual", "planta", "composicao", "estimativa"]);
export const lineItemQuantitySourceEnum = pgEnum("line_item_quantity_source", ["manual", "measurement", "plant", "import", "bim", "estimate"]);
export const measurementFormulaTypeEnum = pgEnum("measurement_formula_type", ["legacy_product", "direct", "count", "length", "area", "wall_area", "perimeter", "volume", "section_length", "weight", "reinforcement", "percentage"]);
export const measurementSourceEnum = pgEnum("measurement_source", ["manual", "plant", "import", "bim", "field"]);
export const documentStatusEnum = pgEnum("document_status", ["rascunho", "submetido", "aprovado"]);
export const scheduleTaskStatusEnum = pgEnum("schedule_task_status", ["nao_iniciado", "em_curso", "bloqueado", "concluido"]);
export const scheduleDependencyTypeEnum = pgEnum("schedule_dependency_type", ["FS", "SS", "FF", "SF"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trial", "activo", "suspenso"]);
export const plantDisciplineEnum = pgEnum("plant_discipline", ["arquitectura", "estrutura"]);
export const plantStatusEnum = pgEnum("plant_status", ["pendente", "processando", "concluido", "erro"]);

// ---------- Multi-tenant / Auth ----------

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  nuit: varchar("nuit", { length: 30 }),
  address: text("address"),
  logoUrl: text("logo_url"),
  defaultCurrency: currencyEnum("default_currency").notNull().default("MZN"),
  workingDaysPerMonth: integer("working_days_per_month").notNull().default(22),
  workingHoursPerDay: numeric("working_hours_per_day", { precision: 4, scale: 1 }).notNull().default("8"),
  // Perfil da empresa (Fase 1, Etapa 4) — todos opcionais, preenchidos pelo admin_empresa
  // quando quiser; nenhum é usado em cálculos, só em identificação/documentos.
  province: varchar("province", { length: 100 }),
  district: varchar("district", { length: 100 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 200 }),
  website: varchar("website", { length: 200 }),
  bankDetails: text("bank_details"),
  // Texto livre no rodapé dos documentos exportados (Excel/PDF) — aplicado via documentChrome.
  documentFooter: text("document_footer"),
  responsibleName: varchar("responsible_name", { length: 150 }),
  enabledModules: jsonb("enabled_modules").$type<CompanyModuleKey[]>().notNull().default([...COMPANY_MODULE_KEYS]),
  /** Templates de permissões por função — se vazio/null usa SYSTEM_ROLE_PERMISSIONS. */
  rolePermissions: jsonb("role_permissions").$type<Partial<Record<"admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador", string[]>>>(),
  brandName: varchar("brand_name", { length: 100 }),
  primaryColor: varchar("primary_color", { length: 7 }).notNull().default("#1AADB4"),
  accentColor: varchar("accent_color", { length: 7 }).notNull().default("#ED6C22"),
  defaultLanguage: varchar("default_language", { length: 10 }).notNull().default("pt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  plan: varchar("plan", { length: 50 }).notNull().default("standard"),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  activatedAt: timestamp("activated_at"),
  activatedByUserId: uuid("activated_by_user_id"),
  /** Fim do período pago ou do trial — null = sem data definida. */
  expiresAt: timestamp("expires_at"),
  /** monthly | annual | custom | trial */
  billingCycle: varchar("billing_cycle", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Pagamentos SaaS registados manualmente pelo super_admin (sem gateway). */
export const platformPayments = pgTable(
  "platform_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: currencyEnum("currency").notNull().default("MZN"),
    paidAt: timestamp("paid_at").notNull().defaultNow(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    plan: varchar("plan", { length: 50 }).notNull(),
    billingCycle: varchar("billing_cycle", { length: 20 }),
    method: varchar("method", { length: 40 }).notNull().default("transferencia"),
    reference: varchar("reference", { length: 120 }),
    notes: text("notes"),
    recordedByUserId: uuid("recorded_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("platform_payments_company_id_idx").on(table.companyId)]
);

/**
 * Comprovativos de pagamento submetidos pela própria empresa (transferência/M-Pesa/e-Mola sem
 * gateway automático). Ficam "pendente" até o super_admin rever o ficheiro e aprovar — a
 * aprovação cria o platform_payments correspondente e activa/estende a subscrição. Rejeitar
 * não apaga o pedido, só o marca, para a empresa perceber o que se passou.
 */
export const paymentProofStatusEnum = pgEnum("payment_proof_status", ["pendente", "aprovado", "rejeitado"]);

export const paymentProofs = pgTable(
  "payment_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    submittedByUserId: uuid("submitted_by_user_id").notNull(),
    plan: varchar("plan", { length: 50 }).notNull(),
    billingCycle: varchar("billing_cycle", { length: 20 }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: currencyEnum("currency").notNull().default("MZN"),
    method: varchar("method", { length: 40 }).notNull(),
    reference: varchar("reference", { length: 120 }),
    notes: text("notes"),
    filePath: text("file_path").notNull(),
    originalFileName: varchar("original_file_name", { length: 300 }),
    status: paymentProofStatusEnum("status").notNull().default("pendente"),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("payment_proofs_company_id_idx").on(table.companyId),
    index("payment_proofs_status_idx").on(table.status, table.createdAt),
  ],
);

/**
 * Pedidos comerciais (registo de interesse num plano, pack de créditos, ou upgrade) — chegam
 * directamente ao super_admin por email + aqui no painel. Nunca redirecciona ninguém para o
 * WhatsApp pessoal: quer venha do site público (companyId null) quer de dentro da app já
 * autenticada (companyId preenchido), fica registado e a equipa SIGO contacta a partir daqui.
 */
export const commercialLeadStatusEnum = pgEnum("commercial_lead_status", ["novo", "contactado", "resolvido"]);

export const commercialLeads = pgTable(
  "commercial_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    source: varchar("source", { length: 40 }).notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    company: varchar("company", { length: 200 }),
    email: varchar("email", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 60 }),
    nuit: varchar("nuit", { length: 50 }),
    city: varchar("city", { length: 150 }),
    teamSize: varchar("team_size", { length: 60 }),
    planOrPack: varchar("plan_or_pack", { length: 100 }),
    billingCycle: varchar("billing_cycle", { length: 20 }),
    notes: text("notes"),
    // Comprovativo anexado logo no pedido público (sem precisar de ter conta ainda) — opcional,
    // quem prefere só pedir contacto primeiro e pagar depois continua a poder.
    proofFilePath: text("proof_file_path"),
    proofOriginalFileName: varchar("proof_original_file_name", { length: 300 }),
    status: commercialLeadStatusEnum("status").notNull().default("novo"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("commercial_leads_status_idx").on(table.status, table.createdAt)],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 150 }).notNull(),
  email: varchar("email", { length: 200 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull(),
  // "sub" do Google para a conta associada — só preenchido depois do primeiro login com Google
  // bem-sucedido. Não permite criar conta por si só: o login com Google só funciona para um
  // email que já exista aqui (criado por um admin), nunca regista ninguém novo.
  googleId: varchar("google_id", { length: 255 }).unique(),
  avatarUrl: text("avatar_url"),
  lastLoginAt: timestamp("last_login_at"),
  // Contas desactivadas deixam imediatamente de autenticar, mas permanecem na base de dados
  // para conservar autoria, aprovações e restantes referências históricas da obra.
  isActive: boolean("is_active").notNull().default(true),
  // O administrador entrega uma credencial temporária; no primeiro acesso (ou após uma
  // reposição) o utilizador é conduzido ao Perfil para escolher a sua própria palavra-passe.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  // Guardado já para quando houver internacionalização real (Fase 1 do documento diz
  // "futuramente") — hoje não muda nada no comportamento da aplicação.
  preferredLanguage: varchar("preferred_language", { length: 10 }).notNull().default("pt"),
  /** Permissões efectivas deste utilizador (cópia do template da função na criação; ajuste fino próprio). */
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Contas criadas por um admin (fluxo antigo) ficam já verificadas — só o registo público
  // (self-service) exige confirmar o email antes do primeiro login.
  emailVerifiedAt: timestamp("email_verified_at"),
  emailVerificationToken: varchar("email_verification_token", { length: 64 }),
  emailVerificationExpiresAt: timestamp("email_verification_expires_at"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  // Para "terminar sessões de outros dispositivos" fazer sentido, o utilizador precisa de
  // conseguir distinguir as sessões — nenhum dos dois é fiável a 100% (IP muda, user-agent
  // pode ser forjado) mas já é o suficiente para reconhecer "o meu telemóvel" vs "outra coisa".
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 64 }),
  // Super-admin a "entrar" numa empresa sem ser membro — limpa ao sair ou ao apagar a empresa.
  actingCompanyId: uuid("acting_company_id").references(() => companies.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Catálogo de preços (companyId nullable = catálogo global partilhado) ----------

export const labourCategories = pgTable(
  "labour_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyKey: uuid("family_key").notNull().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 150 }).notNull(),
    monthlySalary: numeric("monthly_salary", { precision: 14, scale: 2 }).notNull(),
    productiveHoursPerMonth: numeric("productive_hours_per_month", { precision: 8, scale: 2 }),
    socialChargesPct: numeric("social_charges_pct", { precision: 7, scale: 3 }).notNull().default("0"),
    complementaryCostsPct: numeric("complementary_costs_pct", { precision: 7, scale: 3 }).notNull().default("0"),
    hourlyRate: numeric("hourly_rate", { precision: 14, scale: 4 }).notNull(),
    currency: currencyEnum("currency").notNull().default("MZN"),
    sourceName: varchar("source_name", { length: 180 }),
    sourceReference: text("source_reference"),
    effectiveDate: date("effective_date"),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdBySupplierAccountId: uuid("created_by_supplier_account_id").references((): AnyPgColumn => supplierAccounts.id, { onDelete: "set null" }),
  },
  // Impede duas clonagens em corrida (dois pedidos simultâneos a clonar a mesma categoria
  // partilhada para a mesma empresa) — companyId NULL nunca colide consigo próprio em Postgres
  // (semântica normal de UNIQUE com NULL), por isso isto só restringe cópias já pertencentes a
  // uma empresa, nunca a lista partilhada.
  (table) => [unique().on(table.companyId, table.name)]
);

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyKey: uuid("family_key").notNull().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 200 }).notNull(),
    category: varchar("category", { length: 100 }).notNull().default("Outros"),
    specification: text("specification"),
    unit: unitEnum("unit").notNull(),
    baseUnitCost: numeric("base_unit_cost", { precision: 14, scale: 4 }).notNull(),
    importFactor: numeric("import_factor", { precision: 6, scale: 4 }).notNull().default("1.0"),
    defaultWastePct: numeric("default_waste_pct", { precision: 7, scale: 3 }).notNull().default("0"),
    currency: currencyEnum("currency").notNull().default("MZN"),
    priceSourceName: varchar("price_source_name", { length: 180 }),
    sourceReference: text("source_reference"),
    priceDate: date("price_date"),
    includesVat: boolean("includes_vat").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Embalagem/unidade de compra de mercado, quando difere da unidade de medida usada nas
    // composições (ex: areia medida em m3 nas composições, mas vendida por camião de Xm3) — ambos
    // nullable: null = compra-se directamente na unidade de medida, sem conversão (ex: água, local;
    // pregos/arame, ao peso). `purchasePackageQty` é quantas unidades de medida cabem numa unidade
    // de compra (ex: 10 para um camião de 10m3).
    purchasePackageLabel: varchar("purchase_package_label", { length: 100 }),
    purchasePackageQty: numeric("purchase_package_qty", { precision: 14, scale: 4 }),
    createdBySupplierAccountId: uuid("created_by_supplier_account_id").references((): AnyPgColumn => supplierAccounts.id, { onDelete: "set null" }),
  },
  (table) => [unique().on(table.companyId, table.name)]
);

// Zonas de preço (ex: "Baixa", "Matola") — o custo de um material pode variar consoante a zona
// da obra (transporte, disponibilidade local); companyId nullable = lista partilhada (mesma
// convenção de clonagem transparente já usada em labour_categories/materials/equipment).
export const priceZones = pgTable("price_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  province: varchar("province", { length: 100 }),
  district: varchar("district", { length: 100 }),
  description: text("description"),
  materialAdjustmentPct: numeric("material_adjustment_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  labourAdjustmentPct: numeric("labour_adjustment_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  equipmentAdjustmentPct: numeric("equipment_adjustment_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  defaultTransportPct: numeric("default_transport_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  sourceName: varchar("source_name", { length: 180 }),
  sourceReference: text("source_reference"),
  effectiveDate: date("effective_date"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Preço de um material numa zona específica — substitui materials.baseUnitCost quando o
// projecto tem uma zona atribuída e existe uma linha aqui para esse (material, zona). Um
// material só pode ter preços por zona depois de ser clonado para a empresa (mesmo princípio de
// "nunca alterar o catálogo partilhado" já usado nas restantes edições do catálogo).
export const materialZonePrices = pgTable("material_zone_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull().references(() => materials.id, { onDelete: "cascade" }),
  zoneId: uuid("zone_id").notNull().references(() => priceZones.id, { onDelete: "cascade" }),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  sourceName: varchar("source_name", { length: 180 }),
  sourceReference: text("source_reference"),
  effectiveDate: date("effective_date"),
  includesVat: boolean("includes_vat").notNull().default(false),
  transportIncluded: boolean("transport_included").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyKey: uuid("family_key").notNull().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    unit: unitEnum("unit").notNull(),
    hourlyCost: numeric("hourly_cost", { precision: 14, scale: 4 }).notNull(),
    currency: currencyEnum("currency").notNull().default("MZN"),
    createdBySupplierAccountId: uuid("created_by_supplier_account_id").references((): AnyPgColumn => supplierAccounts.id, { onDelete: "set null" }),
  },
  (table) => [unique().on(table.companyId, table.name)]
);

export const costCompositions = pgTable("cost_compositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 50 }),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }).notNull().default("Outros"),
  description: text("description"),
  measurementCriteria: text("measurement_criteria"),
  executionNotes: text("execution_notes"),
  crewSize: integer("crew_size"),
  productiveHoursPerDay: numeric("productive_hours_per_day", { precision: 6, scale: 2 }),
  outputPerDay: numeric("output_per_day", { precision: 14, scale: 4 }),
  productivitySource: varchar("productivity_source", { length: 180 }),
  productivityNotes: text("productivity_notes"),
  defaultMeasurementFormula: measurementFormulaTypeEnum("default_measurement_formula"),
  outputUnit: unitEnum("output_unit").notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  auxiliaryCostPct: numeric("auxiliary_cost_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  indirectCostPct: numeric("indirect_cost_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  profitMarginPct: numeric("profit_margin_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  version: integer("version").notNull().default(1),
  sourceName: varchar("source_name", { length: 180 }),
  sourceReference: text("source_reference"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const compositionLabourLines = pgTable("composition_labour_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  labourCategoryId: uuid("labour_category_id").notNull().references(() => labourCategories.id),
  qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 6 }).notNull(),
  notes: text("notes"),
});

export const compositionMaterialLines = pgTable("composition_material_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 6 }).notNull(),
  wastePct: numeric("waste_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  notes: text("notes"),
});

export const compositionEquipmentLines = pgTable("composition_equipment_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
  qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 6 }).notNull(),
  notes: text("notes"),
});
export const compositionSubcompositionLines = pgTable("composition_subcomposition_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  subcompositionId: uuid("subcomposition_id").notNull().references(() => costCompositions.id, { onDelete: "restrict" }),
  qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 6 }).notNull(),
  notes: text("notes"),
}, (table) => [unique("composition_subcomposition_pair_unique").on(table.compositionId, table.subcompositionId)]);

export const compositionDerivedCostLines = pgTable("composition_derived_cost_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  basis: varchar("basis", { length: 30 }).notNull(),
  percentage: numeric("percentage", { precision: 7, scale: 3 }).notNull(),
  notes: text("notes"),
});

export const workItemTemplates = pgTable("work_item_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  templateKey: varchar("template_key", { length: 180 }).unique(),
  chapterName: varchar("chapter_name", { length: 200 }).notNull(),
  chapterCode: varchar("chapter_code", { length: 10 }),
  itemCode: varchar("item_code", { length: 30 }),
  description: text("description").notNull(),
  unit: unitEnum("unit").notNull(),
  compositionId: uuid("composition_id").references(() => costCompositions.id),
  compositionName: varchar("composition_name", { length: 250 }),
  discipline: varchar("discipline", { length: 40 }).notNull().default("outro"),
  detectionTags: jsonb("detection_tags").$type<string[]>().notNull().default([]),
  requiresTagMatch: boolean("requires_tag_match").notNull().default(false),
  chapterSortOrder: integer("chapter_sort_order").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
});

/** Memória da empresa: código/descrição de mapa → composição escolhida em importações anteriores. */
export const importCompositionMappings = pgTable(
  "import_composition_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    matchKey: varchar("match_key", { length: 220 }).notNull(),
    sourceCode: varchar("source_code", { length: 30 }),
    sourceDescription: text("source_description"),
    compositionId: uuid("composition_id")
      .notNull()
      .references(() => costCompositions.id, { onDelete: "cascade" }),
    hitCount: integer("hit_count").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("import_composition_mappings_company_key").on(table.companyId, table.matchKey),
    index("import_composition_mappings_company_idx").on(table.companyId),
  ],
);

// ---------- Projecto e Mapa de Quantidades ----------

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  client: varchar("client", { length: 200 }),
  bairro: varchar("bairro", { length: 150 }),
  talhao: varchar("talhao", { length: 100 }),
  distrito: varchar("distrito", { length: 150 }),
  provincia: varchar("provincia", { length: 150 }),
  phase: varchar("phase", { length: 100 }),
  // Zona de preço do edifício/obra (ex: "Baixa", "Matola") — quando definida, os preços de
  // materiais com uma linha em material_zone_prices para esta zona substituem o preço base do
  // catálogo ao calcular o custo unitário de composições usadas neste projecto.
  zoneId: uuid("zone_id").references(() => priceZones.id),
  currency: currencyEnum("currency").notNull().default("MZN"),
  // Define onde o trabalho aparece na aplicação. "hibrido" significa que uma medição
  // técnica já foi submetida e passou também a alimentar um orçamento comercial.
  projectType: varchar("project_type", { length: 20 }).notNull().default("orcamento"),
  measurementMode: varchar("measurement_mode", { length: 20 }).notNull().default("plantas"),
  // Número de pisos da edificação — usado só pelo gerador de cronograma para sequenciar a
  // estrutura e as alvenarias piso a piso (térreo primeiro, depois cada piso seguinte).
  floors: integer("floors").notNull().default(1),
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0.16"),
  contingenciasRate: numeric("contingencias_rate", { precision: 5, scale: 4 }).notNull().default("0.10"),
  siteCostsRate: numeric("site_costs_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  indirectCostsRate: numeric("indirect_costs_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  profitMarginRate: numeric("profit_margin_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  /** Obra arquivada não conta para o limite de obras activas do plano. */
  archivedAt: timestamp("archived_at"),
  /**
   * Soft-delete / lixo da plataforma: metadados e características ficam;
   * ficheiros pesados (PDFs, fotos) são purgados. Só o super_admin restaura ou apaga de vez.
   */
  trashedAt: timestamp("trashed_at"),
  trashReason: varchar("trash_reason", { length: 120 }),
  trashedByUserId: uuid("trashed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  filesPurgedAt: timestamp("files_purged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /**
   * Token do link público para o dono da obra (progresso, valor certificado, diário) — sem
   * login. Nunca é o ID interno do projecto: gerar de novo invalida o link anterior sem afectar
   * mais nada. Null = partilha desligada.
   */
  publicShareToken: varchar("public_share_token", { length: 64 }).unique(),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    companyKindCreatedIdx: index("usage_events_company_kind_created_idx").on(
      table.companyId,
      table.kind,
      table.createdAt,
    ),
  }),
);

/** Saldo de créditos extra (importações / plantas) — não renova mensalmente; consome-se ao usar. */
export const subscriptionCreditBalances = pgTable("subscription_credit_balances", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  smartImportCredits: integer("smart_import_credits").notNull().default(0),
  plantAnalysisCredits: integer("plant_analysis_credits").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const subscriptionCreditLedger = pgTable(
  "subscription_credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    delta: integer("delta").notNull(),
    packId: varchar("pack_id", { length: 40 }),
    reason: varchar("reason", { length: 80 }).notNull(),
    note: text("note"),
    amountMzn: numeric("amount_mzn", { precision: 14, scale: 2 }),
    recordedByUserId: uuid("recorded_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("subscription_credit_ledger_company_created_idx").on(table.companyId, table.createdAt)],
);

export const projectMaterialSpecifications = pgTable(
  "project_material_specifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    specification: text("specification"),
    source: varchar("source", { length: 40 }).notNull().default("manual"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.materialId)]
);

export const budgetDocuments = pgTable("budget_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  // Uma medição contém quantidades e memória de cálculo, sem formação comercial do preço.
  // Um orçamento pode nascer dessa medição ou ser importado/criado directamente.
  documentType: varchar("document_type", { length: 20 }).notNull().default("orcamento"),
  sourceMeasurementDocumentId: uuid("source_measurement_document_id")
    .references((): AnyPgColumn => budgetDocuments.id, { onDelete: "set null" }),
  sourceMeasurementFingerprint: varchar("source_measurement_fingerprint", { length: 64 }),
  revision: varchar("revision", { length: 20 }),
  fileNumber: varchar("file_number", { length: 50 }),
  currency: currencyEnum("currency").notNull().default("MZN"),
  documentDate: date("document_date"),
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0.16"),
  contingenciasRate: numeric("contingencias_rate", { precision: 5, scale: 4 }).notNull().default("0.10"),
  siteCostsRate: numeric("site_costs_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  indirectCostsRate: numeric("indirect_costs_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  profitMarginRate: numeric("profit_margin_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  status: documentStatusEnum("status").notNull().default("rascunho"),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvalNote: text("approval_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Relatório da última estimativa aplicada pelo Assistente de Medições — uma linha por item
  // gerado, com a fórmula usada e se veio de dado real (planta), do que o utilizador indicou no
  // Assistente, ou de um rácio genérico. Fica gravado para poder ser consultado depois de fechar
  // o Assistente, não só durante a sessão do modal.
  lastEstimateReport: jsonb("last_estimate_report").$type<
    | {
        generatedAt: string;
        entries: {
          code: string;
          label: string;
          unit: string;
          value: number;
          source: "real" | "medido" | "estimativa";
          formula: string;
        }[];
      }
    | null
  >(),
});

/** Jobs persistentes de importação de mapas (sobrevivem a restart da API). */
export const measurementImportJobsTable = pgTable(
  "measurement_import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => budgetDocuments.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 300 }).notNull(),
    filePath: text("file_path").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pendente"),
    progress: integer("progress").notNull().default(0),
    stage: varchar("stage", { length: 200 }),
    errorMessage: text("error_message"),
    preview: jsonb("preview").$type<Record<string, unknown> | null>(),
    parsedRows: jsonb("parsed_rows").$type<unknown[] | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("measurement_import_jobs_doc_idx").on(table.documentId, table.updatedAt),
    index("measurement_import_jobs_status_idx").on(table.status, table.updatedAt),
  ],
);

export const budgetSections = pgTable("budget_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => budgetDocuments.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // Identifica estruturas geradas pelo SIGO sem confundir mapas importados que usem códigos
  // semelhantes. Também permite evoluir o modelo adaptativo sem alterar documentos existentes.
  templateKey: varchar("template_key", { length: 50 }),
});

export const lineItems = pgTable("line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id").notNull().references(() => budgetSections.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => lineItems.id, { onDelete: "cascade" }),
  sourceMeasurementItemId: uuid("source_measurement_item_id").references((): AnyPgColumn => lineItems.id, { onDelete: "set null" }),
  kind: lineItemKindEnum("kind").notNull(),
  code: varchar("code", { length: 30 }),
  description: text("description").notNull(),
  unit: unitEnum("unit"),
  quantity: numeric("quantity", { precision: 16, scale: 4 }),
  quantitySource: lineItemQuantitySourceEnum("quantity_source").notNull().default("manual"),
  unitPrice: numeric("unit_price", { precision: 16, scale: 4 }),
  compositionId: uuid("composition_id").references(() => costCompositions.id),
  origin: lineItemOriginEnum("origin").notNull().default("manual"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------- Medições dimensionais (mapa de medições por item do orçamento) ----------
// Cada linha é uma medição concreta: nº de vezes × comprimento × largura × altura = parcial.
// A quantidade do line_item é a soma dos parciais (recalculada e gravada a cada alteração).

export const measurementLines = pgTable("measurement_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  lineItemId: uuid("line_item_id").notNull().references(() => lineItems.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 300 }).notNull().default(""),
  formulaType: measurementFormulaTypeEnum("formula_type").notNull().default("legacy_product"),
  sign: integer("sign").notNull().default(1),
  count: numeric("count", { precision: 10, scale: 2 }).notNull().default("1"),
  length: numeric("length", { precision: 12, scale: 3 }),
  width: numeric("width", { precision: 12, scale: 3 }),
  height: numeric("height", { precision: 12, scale: 3 }),
  directQuantity: numeric("direct_quantity", { precision: 16, scale: 6 }),
  coefficient: numeric("coefficient", { precision: 16, scale: 6 }).notNull().default("1"),
  unitWeight: numeric("unit_weight", { precision: 16, scale: 6 }),
  diameterMm: numeric("diameter_mm", { precision: 10, scale: 3 }),
  baseQuantity: numeric("base_quantity", { precision: 16, scale: 6 }),
  percentage: numeric("percentage", { precision: 10, scale: 4 }),
  block: varchar("block", { length: 100 }),
  floor: varchar("floor", { length: 100 }),
  zone: varchar("zone", { length: 120 }),
  room: varchar("room", { length: 160 }),
  axis: varchar("axis", { length: 120 }),
  element: varchar("element", { length: 160 }),
  source: measurementSourceEnum("source").notNull().default("manual"),
  sourceRef: varchar("source_ref", { length: 300 }),
  revisionNo: integer("revision_no").notNull().default(1),
  supersedesLineId: uuid("supersedes_line_id").references((): AnyPgColumn => measurementLines.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("measurement_lines_active_item_idx").on(table.lineItemId, table.isActive, table.sortOrder),
  index("measurement_lines_location_idx").on(table.block, table.floor, table.zone),
]);

export const lineItemCostSnapshots = pgTable("line_item_cost_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  lineItemId: uuid("line_item_id").notNull().references(() => lineItems.id, { onDelete: "cascade" }),
  compositionId: uuid("composition_id").references(() => costCompositions.id, { onDelete: "set null" }),
  compositionVersion: integer("composition_version"),
  zoneId: uuid("zone_id").references(() => priceZones.id, { onDelete: "set null" }),
  currency: currencyEnum("currency").notNull(),
  unitCost: numeric("unit_cost", { precision: 16, scale: 4 }).notNull(),
  labourCost: numeric("labour_cost", { precision: 16, scale: 4 }).notNull().default("0"),
  materialCost: numeric("material_cost", { precision: 16, scale: 4 }).notNull().default("0"),
  equipmentCost: numeric("equipment_cost", { precision: 16, scale: 4 }).notNull().default("0"),
  subcompositionCost: numeric("subcomposition_cost", { precision: 16, scale: 4 }).notNull().default("0"),
  derivedCost: numeric("derived_cost", { precision: 16, scale: 4 }).notNull().default("0"),
  resourceSnapshot: jsonb("resource_snapshot").$type<Record<string, unknown> | null>(),
  reason: varchar("reason", { length: 30 }).notNull().default("attached"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("line_item_cost_snapshot_item_idx").on(table.lineItemId, table.createdAt)]);

// ---------- Autos de Medição ----------

export const measurementCertificates = pgTable("measurement_certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  budgetDocumentId: uuid("budget_document_id").notNull().references(() => budgetDocuments.id),
  number: integer("number").notNull(),
  periodStartDate: date("period_start_date"),
  periodDate: date("period_date").notNull(),
  status: documentStatusEnum("status").notNull().default("rascunho"),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvalNote: text("approval_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const measurementCertificateLines = pgTable("measurement_certificate_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificateId: uuid("certificate_id").notNull().references(() => measurementCertificates.id, { onDelete: "cascade" }),
  lineItemId: uuid("line_item_id").notNull().references(() => lineItems.id),
  cumulativeQty: numeric("cumulative_qty", { precision: 16, scale: 4 }).notNull().default("0"),
  periodQty: numeric("period_qty", { precision: 16, scale: 4 }).notNull().default("0"),
  notes: text("notes"),
  overrunReason: text("overrun_reason"),
});
export const measurementCertificateFieldLines = pgTable("measurement_certificate_field_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificateLineId: uuid("certificate_line_id").notNull().references(() => measurementCertificateLines.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 300 }).notNull().default(""),
  formulaType: measurementFormulaTypeEnum("formula_type").notNull(),
  sign: integer("sign").notNull().default(1),
  count: numeric("count", { precision: 10, scale: 2 }).notNull().default("1"),
  length: numeric("length", { precision: 12, scale: 3 }), width: numeric("width", { precision: 12, scale: 3 }), height: numeric("height", { precision: 12, scale: 3 }),
  directQuantity: numeric("direct_quantity", { precision: 16, scale: 6 }), coefficient: numeric("coefficient", { precision: 16, scale: 6 }).notNull().default("1"),
  unitWeight: numeric("unit_weight", { precision: 16, scale: 6 }), diameterMm: numeric("diameter_mm", { precision: 10, scale: 3 }),
  baseQuantity: numeric("base_quantity", { precision: 16, scale: 6 }), percentage: numeric("percentage", { precision: 10, scale: 4 }),
  block: varchar("block", { length: 100 }), floor: varchar("floor", { length: 100 }), zone: varchar("zone", { length: 120 }), room: varchar("room", { length: 160 }), axis: varchar("axis", { length: 120 }), element: varchar("element", { length: 160 }),
  evidenceUrls: jsonb("evidence_urls").$type<string[]>().notNull().default([]), notes: text("notes"),
  revisionNo: integer("revision_no").notNull().default(1),
  supersedesLineId: uuid("supersedes_line_id").references((): AnyPgColumn => measurementCertificateFieldLines.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true), sortOrder: integer("sort_order").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [index("measurement_certificate_field_active_idx").on(table.certificateLineId, table.isActive, table.sortOrder)]);


// ---------- Cronograma de obra ----------

// Perfil persistente do Assistente de Planeamento. É guardado por projecto + versão do BOQ para
// que uma revisão futura do orçamento não reutilize silenciosamente respostas de outra versão.
// O fingerprint fecha o circuito "perfil guardado → preview validado → geração".
export const projectSchedulePlanningProfiles = pgTable("project_schedule_planning_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  budgetDocumentId: uuid("budget_document_id").notNull().references(() => budgetDocuments.id, { onDelete: "cascade" }),
  schemaVersion: integer("schema_version").notNull().default(1),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull(),
  profileFingerprint: varchar("profile_fingerprint", { length: 64 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  lastPreviewFingerprint: varchar("last_preview_fingerprint", { length: 64 }),
  lastPreviewStartDate: date("last_preview_start_date"),
  previewedAt: timestamp("previewed_at"),
  generatedAt: timestamp("generated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("project_schedule_planning_profile_unique").on(table.projectId, table.budgetDocumentId),
  index("project_schedule_planning_profile_document_idx").on(table.budgetDocumentId),
]);

// O cronograma usa a mesma WBS do orçamento. `budgetLineItemId` é a ligação auditável exacta;
// `budgetChapterCode` mantém códigos WBS/prefixos e compatibilidade com linhas de base antigas.
// `valueShare` reparte uma linha agregada sem duplicar valor/progresso.
export const scheduleTasks = pgTable("schedule_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  budgetDocumentId: uuid("budget_document_id").references(() => budgetDocuments.id, { onDelete: "set null" }),
  // Ligação exacta à linha do BOQ. `budgetChapterCode` continua disponível para WBS/prefixos e
  // compatibilidade com cronogramas antigos, mas o ID evita ambiguidades em mapas importados com
  // códigos repetidos ou nulos.
  budgetLineItemId: uuid("budget_line_item_id").references(() => lineItems.id, { onDelete: "set null" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => scheduleTasks.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 240 }).notNull(),
  budgetChapterCode: varchar("budget_chapter_code", { length: 30 }),
  // Fracção (0-1) do valor orçamentado de budgetChapterCode que esta tarefa representa —
  // só < 1 quando o gerador do cronograma divide um único item do mapa (ex: "Pilares") em
  // várias tarefas por piso; as fracções de todas as tarefas com o mesmo código somam 1, para
  // que o valor planeado/executado agregado nunca duplique nem perca o valor real do orçamento.
  valueShare: numeric("value_share", { precision: 6, scale: 4 }).notNull().default("1"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  baselineStartDate: date("baseline_start_date"),
  baselineEndDate: date("baseline_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  durationDays: integer("duration_days").notNull().default(1),
  // Base auditável da duração: horas da composição, fallback por valor, mínimo, soma (resumo) ou
  // manual. Permite reconstruir `weightBasis` também depois de recarregar a página.
  durationBasis: varchar("duration_basis", { length: 16 }).notNull().default("manual"),
  manualProgress: numeric("manual_progress", { precision: 5, scale: 2 }),
  status: scheduleTaskStatusEnum("status").notNull().default("nao_iniciado"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [index("schedule_tasks_budget_line_item_idx").on(table.budgetLineItemId)]);

export const scheduleDependencies = pgTable("schedule_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  predecessorTaskId: uuid("predecessor_task_id").notNull().references(() => scheduleTasks.id, { onDelete: "cascade" }),
  successorTaskId: uuid("successor_task_id").notNull().references(() => scheduleTasks.id, { onDelete: "cascade" }),
  type: scheduleDependencyTypeEnum("type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
}, (table) => [unique("schedule_dependency_unique").on(table.predecessorTaskId, table.successorTaskId)]);

// ---------- Plantas ----------

export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  discipline: plantDisciplineEnum("discipline").notNull(),
  filePath: text("file_path").notNull(),
  originalFileName: varchar("original_file_name", { length: 300 }),
  fileHash: varchar("file_hash", { length: 64 }),
  parserVersion: varchar("parser_version", { length: 40 }),
  processingStatus: plantStatusEnum("processing_status").notNull().default("pendente"),
  processingProgress: integer("processing_progress").notNull().default(0),
  processingStage: varchar("processing_stage", { length: 200 }),
  processingCurrentPage: integer("processing_current_page"),
  processingTotalPages: integer("processing_total_pages"),
  processingStartedAt: timestamp("processing_started_at"),
  processingUpdatedAt: timestamp("processing_updated_at").notNull().defaultNow(),
  errorMessage: text("error_message"),
  // Resumo agregado de sapatas/pilares/vigas (projecto estrutural) — usado para pré-preencher
  // o Assistente de Medições sem repetir perguntas já respondidas pela planta importada.
  structuralSummary: jsonb("structural_summary").$type<{
    footingsCount: number;
    footingsAvgWidthCm: number;
    footingsAvgLengthCm: number;
    footingsAvgDepthCm: number;
    columnsCount: number;
    beamsCount: number;
    beamsTotalLengthM: number;
    beamsAvgWidthCm: number;
    beamsAvgHeightCm: number;
    beamsConcreteVolumeM3: number;
    staircasesCount: number;
    slabsCount: number;
    slabsAvgThicknessCm: number;
    slabs?: Array<{
      name?: string;
      floor: string | null;
      areaM2?: number;
      thicknessCm: number;
      layers: Array<"inferior" | "superior" | "geral">;
      pages: number[];
      concreteClass?: string | null;
      steelGrade?: string | null;
      coverCm?: number | null;
      topRebar?: { xDiameterMm: number; xSpacingCm: number; yDiameterMm: number; ySpacingCm: number } | null;
      bottomRebar?: { xDiameterMm: number; xSpacingCm: number; yDiameterMm: number; ySpacingCm: number } | null;
      topSteelWeightKg?: number;
      bottomSteelWeightKg?: number;
      steelByDiameter?: Record<string, number>;
      notes?: string | null;
    }>;
    totalSteelWeightKg: number;
  } | null>(),
  // Organização virtual de PDFs completos: mantém o original intacto e regista os intervalos
  // de páginas reconhecidos como arquitectura, estrutura, hidrossanitário, electricidade, etc.
  documentAnalysis: jsonb("document_analysis").$type<DocumentAnalysis | null>(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, (table) => [index("plants_file_hash_idx").on(table.fileHash, table.parserVersion)]);

export const extractedRooms = pgTable("extracted_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  plantId: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  number: varchar("number", { length: 20 }),
  areaM2: numeric("area_m2", { precision: 12, scale: 4 }).notNull(),
  page: integer("page").notNull(),
  // Piso detectado automaticamente (ex: "Piso Térreo", "Anexo") — editável pelo utilizador no
  // ecrã de confirmação antes de entrar no Assistente de Medições (a detecção automática nem
  // sempre acerta em casos ambíguos, ex: uma casa de banho partilhada entre a casa e um anexo).
  floor: varchar("floor", { length: 100 }),
  perimeterM: numeric("perimeter_m", { precision: 12, scale: 4 }),
});

export const extractedOpenings = pgTable("extracted_openings", {
  id: uuid("id").primaryKey().defaultRandom(),
  plantId: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 10 }).notNull(),
  code: varchar("code", { length: 40 }),
  designation: varchar("designation", { length: 160 }),
  widthM: numeric("width_m", { precision: 8, scale: 3 }),
  heightM: numeric("height_m", { precision: 8, scale: 3 }),
  sillHeightM: numeric("sill_height_m", { precision: 8, scale: 3 }),
  quantity: integer("quantity").notNull().default(1),
  floor: varchar("floor", { length: 100 }),
  location: varchar("location", { length: 20 }).notNull().default("desconhecida"),
  material: varchar("material", { length: 120 }),
  materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
  technicalSpecification: text("technical_specification"),
  page: integer("page").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull().default("0"),
  source: varchar("source", { length: 20 }).notNull(),
  needsConfirmation: boolean("needs_confirmation").notNull().default(true),
}, (table) => [index("extracted_openings_plant_idx").on(table.plantId)]);

export const extractedRebarSchedules = pgTable("extracted_rebar_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  plantId: uuid("plant_id").notNull().references(() => plants.id, { onDelete: "cascade" }),
  element: varchar("element", { length: 100 }).notNull(),
  diameterMm: numeric("diameter_mm", { precision: 6, scale: 2 }).notNull(),
  weightKg: numeric("weight_kg", { precision: 12, scale: 3 }).notNull(),
  page: integer("page").notNull(),
});

// ---------- Financeiro por obra ----------

export const financialEntryTypeEnum = pgEnum("financial_entry_type", ["receita", "despesa"]);
export const financialEntryStatusEnum = pgEnum("financial_entry_status", ["pendente", "pago"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["rascunho", "emitida", "parcial", "paga", "cancelada"]);
export const contractStatusEnum = pgEnum("contract_status", ["rascunho", "activo", "concluido", "cancelado"]);
export const contractVariationStatusEnum = pgEnum("contract_variation_status", ["rascunho", "submetida", "aprovada", "rejeitada"]);
export const creditNoteStatusEnum = pgEnum("credit_note_status", ["rascunho", "emitida", "cancelada"]);
export const clientPaymentPlanModeEnum = pgEnum("client_payment_plan_mode", ["total", "parcelado"]);
export const clientPaymentInstallmentStatusEnum = pgEnum("client_payment_installment_status", ["prevista", "parcial", "paga"]);

/** O que o dono da obra pode ver no link público — definido pelo gestor. */
export const projectClientShareSettings = pgTable("project_client_share_settings", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  showProgress: boolean("show_progress").notNull().default(true),
  showCertifiedValue: boolean("show_certified_value").notNull().default(true),
  showContractValue: boolean("show_contract_value").notNull().default(true),
  showSchedule: boolean("show_schedule").notNull().default(true),
  showCurrentPhase: boolean("show_current_phase").notNull().default(true),
  showDiaryEvidences: boolean("show_diary_evidences").notNull().default(true),
  showPaymentSchedule: boolean("show_payment_schedule").notNull().default(true),
  showNextPayment: boolean("show_next_payment").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Plano de pagamentos do cliente à obra (total ou parcelado). */
export const projectClientPaymentPlans = pgTable("project_client_payment_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" })
    .unique(),
  mode: clientPaymentPlanModeEnum("mode").notNull().default("parcelado"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Lançamento financeiro (receita ou despesa) ligado a um projecto — "contas a pagar"/"a receber"
// são apenas lançamentos com status "pendente" e dueDate preenchida; "pago" com paidDate é o que
// entra no fluxo de caixa e na margem realizada. Não há aqui um "custo interno" separado do
// "preço de venda" do orçamento (o Mapa de Quantidades só guarda um preço por item) — por isso a
// margem que este módulo calcula é sempre a margem operacional REAL (recebido − pago), nunca uma
// margem "prevista" inventada a partir de dois valores que o sistema não distingue.
export const financialEntries = pgTable("financial_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: financialEntryTypeEnum("type").notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  dueDate: date("due_date"),
  paidDate: date("paid_date"),
  status: financialEntryStatusEnum("status").notNull().default("pendente"),
  // Ligações idempotentes aos documentos operacionais: uma OC aprovada cria uma despesa e um
  // auto aprovado cria uma receita. Linhas manuais mantêm ambos os campos nulos.
  sourceType: varchar("source_type", { length: 40 }),
  sourceId: uuid("source_id"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [unique("financial_entry_source_unique").on(table.projectId, table.sourceType, table.sourceId)]);

// Factura comercial emitida a partir de um Auto aprovado. O valor do Auto fica imutável na
// factura; recebimentos parciais vivem numa tabela própria em vez de deformar um lançamento
// financeiro binário (pendente/pago).
export const projectInvoices = pgTable("project_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  measurementCertificateId: uuid("measurement_certificate_id").notNull().references(() => measurementCertificates.id),
  invoiceNumber: varchar("invoice_number", { length: 80 }),
  clientName: varchar("client_name", { length: 200 }),
  issueDate: date("issue_date"),
  dueDate: date("due_date"),
  status: invoiceStatusEnum("status").notNull().default("rascunho"),
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull(),
  retentionRate: numeric("retention_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  retentionAmount: numeric("retention_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("project_invoice_certificate_unique").on(table.measurementCertificateId),
  unique("project_invoice_number_unique").on(table.projectId, table.invoiceNumber),
]);

export const projectClientPaymentInstallments = pgTable("project_client_payment_installments", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => projectClientPaymentPlans.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull().default(1),
  title: varchar("title", { length: 200 }).notNull(),
  dueDate: date("due_date").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  status: clientPaymentInstallmentStatusEnum("status").notNull().default("prevista"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAt: date("paid_at"),
  invoiceId: uuid("invoice_id").references(() => projectInvoices.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invoiceReceipts = pgTable("invoice_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => projectInvoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  receivedDate: date("received_date").notNull(),
  reference: varchar("reference", { length: 150 }),
  notes: text("notes"),
  proofFilePath: text("proof_file_path"),
  proofOriginalName: varchar("proof_original_name", { length: 300 }),
  idempotencyKey: varchar("idempotency_key", { length: 100 }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [unique("invoice_receipt_idempotency_unique").on(table.invoiceId, table.idempotencyKey)]);

export const invoiceCreditNotes = pgTable("invoice_credit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => projectInvoices.id, { onDelete: "cascade" }),
  creditNumber: varchar("credit_number", { length: 80 }).notNull(),
  issueDate: date("issue_date").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: creditNoteStatusEnum("status").notNull().default("rascunho"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [unique("invoice_credit_note_number_unique").on(table.invoiceId, table.creditNumber)]);

// ---------- Escritório (arquitectos / engenheiros autónomos) ----------
// Ciclo comercial próprio, independente do financeiro de obra (Autos → facturas de medição):
// cotação ao cliente → aprovação → factura de honorários → recibos em parcelas com destinos
// (caixa do escritório vs pagamento a terceiros).

export const practiceQuoteStatusEnum = pgEnum("practice_quote_status", [
  "rascunho",
  "enviada",
  "aprovada",
  "rejeitada",
  "cancelada",
]);
export const practiceInvoiceStatusEnum = pgEnum("practice_invoice_status", [
  "rascunho",
  "emitida",
  "parcial",
  "paga",
  "cancelada",
]);
export const practiceDestinationKindEnum = pgEnum("practice_destination_kind", ["caixa", "terceiro"]);

export const practiceEngagementStatusEnum = pgEnum("practice_engagement_status", [
  "rascunho",
  "activo",
  "concluido",
  "cancelado",
]);
export const practiceMilestoneStatusEnum = pgEnum("practice_milestone_status", [
  "pendente",
  "facturado",
  "pago",
]);
export const practiceDocumentSeriesKindEnum = pgEnum("practice_document_series_kind", ["PRO", "FT", "RC"]);

export const practiceClients = pgTable("practice_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  contact: varchar("contact", { length: 200 }),
  email: varchar("email", { length: 200 }),
  phone: varchar("phone", { length: 80 }),
  address: text("address"),
  nuit: varchar("nuit", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const practiceDocumentSeries = pgTable("practice_document_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: practiceDocumentSeriesKindEnum("kind").notNull(),
  year: integer("year").notNull(),
  nextNumber: integer("next_number").notNull().default(1),
}, (table) => [unique("practice_document_series_unique").on(table.companyId, table.kind, table.year)]);

export type PracticeQuoteConditions = {
  intro?: string;
  objectText?: string;
  paymentTerms?: string;
  exclusions?: string;
  revisionsIncluded?: number;
  taxNote?: string;
  reimbursablesNote?: string;
  validityText?: string;
  deadlineText?: string;
  additionalNotes?: string;
  acceptanceText?: string;
};

export const practiceQuotes = pgTable("practice_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => practiceClients.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  /** Documento de orçamento/medição origem (obrigatório para execução de obra). */
  sourceBudgetDocumentId: uuid("source_budget_document_id"),
  title: varchar("title", { length: 240 }).notNull(),
  clientName: varchar("client_name", { length: 200 }).notNull(),
  status: practiceQuoteStatusEnum("status").notNull().default("rascunho"),
  quoteNumber: varchar("quote_number", { length: 80 }),
  issueDate: date("issue_date"),
  validUntil: date("valid_until"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  notes: text("notes"),
  /** project | technical | construction */
  serviceCategory: varchar("service_category", { length: 40 }),
  /** ex.: arquitectura, estrutural, fiscalizacao, execucao_obra */
  serviceType: varchar("service_type", { length: 80 }),
  pricingMode: varchar("pricing_mode", { length: 40 }).default("por_fase"),
  projectDesignation: varchar("project_designation", { length: 240 }),
  workType: varchar("work_type", { length: 120 }),
  location: varchar("location", { length: 240 }),
  ownerName: varchar("owner_name", { length: 200 }),
  estimatedArea: varchar("estimated_area", { length: 80 }),
  floors: varchar("floors", { length: 40 }),
  projectDescription: text("project_description"),
  observations: text("observations"),
  plannedStartDate: date("planned_start_date"),
  clientDeadline: varchar("client_deadline", { length: 120 }),
  conditions: jsonb("conditions").$type<PracticeQuoteConditions>().default({}),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Valor efectivamente aceite pelo cliente (pode ser inferior à proposta — desconto). */
  acceptedAmount: numeric("accepted_amount", { precision: 14, scale: 2 }),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
  acceptanceNotes: text("acceptance_notes"),
  sentAt: timestamp("sent_at"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const practiceQuoteLines = pgTable("practice_quote_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id").notNull().references(() => practiceQuotes.id, { onDelete: "cascade" }),
  phase: varchar("phase", { length: 120 }),
  specialty: varchar("specialty", { length: 120 }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: varchar("unit", { length: 20 }).notNull().default("un"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
  included: boolean("included").notNull().default(true),
  optional: boolean("optional").notNull().default(false),
  durationDays: integer("duration_days"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const practiceTeamPayModeEnum = pgEnum("practice_team_pay_mode", [
  "fixo",
  "percentagem",
  "hora",
  "dia",
  "entregavel",
  "fase",
]);
export const practiceTeamPayStatusEnum = pgEnum("practice_team_pay_status", [
  "pendente",
  "parcial",
  "pago",
]);
export const practiceExpenseKindEnum = pgEnum("practice_expense_kind", [
  "interno",
  "reembolsavel",
]);

export const practiceEngagements = pgTable("practice_engagements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => practiceClients.id, { onDelete: "set null" }),
  quoteId: uuid("quote_id").references(() => practiceQuotes.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: varchar("title", { length: 240 }).notNull(),
  clientName: varchar("client_name", { length: 200 }).notNull(),
  status: practiceEngagementStatusEnum("status").notNull().default("activo"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  /** Tipo de projecto de serviços (não confundir com obra de execução). */
  serviceProjectType: varchar("service_project_type", { length: 80 }),
  serviceType: varchar("service_type", { length: 80 }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Membro da equipa / honorários a pagar num contrato de serviços. */
export const practiceTeamMembers = pgTable("practice_team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => practiceEngagements.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  role: varchar("role", { length: 120 }).notNull(),
  specialty: varchar("specialty", { length: 120 }),
  contact: varchar("contact", { length: 200 }),
  isExternal: boolean("is_external").notNull().default(false),
  payMode: practiceTeamPayModeEnum("pay_mode").notNull().default("fixo"),
  agreedAmount: numeric("agreed_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  percent: numeric("percent", { precision: 5, scale: 2 }),
  hourlyRate: numeric("hourly_rate", { precision: 14, scale: 2 }),
  hours: numeric("hours", { precision: 10, scale: 2 }),
  dailyRate: numeric("daily_rate", { precision: 14, scale: 2 }),
  days: numeric("days", { precision: 10, scale: 2 }),
  deliverableLabel: varchar("deliverable_label", { length: 200 }),
  phaseLabel: varchar("phase_label", { length: 120 }),
  plannedPayDate: date("planned_pay_date"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  payStatus: practiceTeamPayStatusEnum("pay_status").notNull().default("pendente"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Custos / despesas do contrato (internos ou reembolsáveis). */
export const practiceExpenses = pgTable("practice_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => practiceEngagements.id, { onDelete: "cascade" }),
  kind: practiceExpenseKindEnum("kind").notNull().default("interno"),
  category: varchar("category", { length: 80 }).notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  incurredDate: date("incurred_date"),
  paidAt: date("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const practicePhaseStatusEnum = pgEnum("practice_phase_status", [
  "nao_iniciado",
  "em_preparacao",
  "em_curso",
  "aguardando_cliente",
  "aguardando_terceiro",
  "em_revisao",
  "concluido",
  "suspenso",
  "atrasado",
]);

export const practiceDeliverableStatusEnum = pgEnum("practice_deliverable_status", [
  "pendente",
  "em_curso",
  "entregue",
  "em_revisao",
  "aprovado",
  "rejeitado",
]);

export const practiceAddendumKindEnum = pgEnum("practice_addendum_kind", [
  "trabalho_adicional",
  "alteracao_escopo",
  "nova_especialidade",
  "revisao_extraordinaria",
  "extensao_fiscalizacao",
  "consultoria_adicional",
]);

export const practiceAddendumStatusEnum = pgEnum("practice_addendum_status", [
  "rascunho",
  "enviada",
  "aprovada",
  "rejeitada",
  "cancelada",
]);

/** Fase do cronograma de serviço (não confundir com parcelas de facturação). */
export const practiceSchedulePhases = pgTable("practice_schedule_phases", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => practiceEngagements.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  assigneeName: varchar("assignee_name", { length: 200 }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  durationDays: integer("duration_days"),
  status: practicePhaseStatusEnum("status").notNull().default("nao_iniciado"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const practiceDeliverables = pgTable("practice_deliverables", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => practiceEngagements.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => practiceSchedulePhases.id, { onDelete: "set null" }),
  title: varchar("title", { length: 240 }).notNull(),
  assigneeName: varchar("assignee_name", { length: 200 }),
  dueDate: date("due_date"),
  status: practiceDeliverableStatusEnum("status").notNull().default("pendente"),
  deliveredAt: date("delivered_at"),
  revisionNumber: integer("revision_number").notNull().default(0),
  version: varchar("version", { length: 40 }),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const practiceClientRevisions = pgTable("practice_client_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => practiceEngagements.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => practiceSchedulePhases.id, { onDelete: "set null" }),
  deliverableId: uuid("deliverable_id").references(() => practiceDeliverables.id, { onDelete: "set null" }),
  revisionDate: date("revision_date").notNull(),
  description: text("description").notNull(),
  assigneeName: varchar("assignee_name", { length: 200 }),
  impactDays: integer("impact_days").notNull().default(0),
  impactAmount: numeric("impact_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  includedInContract: boolean("included_in_contract").notNull().default(true),
  isAdditionalWork: boolean("is_additional_work").notNull().default(false),
  addendumId: uuid("addendum_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const practiceAddenda = pgTable("practice_addenda", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => practiceEngagements.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id").references(() => practiceClientRevisions.id, { onDelete: "set null" }),
  quoteId: uuid("quote_id").references(() => practiceQuotes.id, { onDelete: "set null" }),
  addendumNumber: varchar("addendum_number", { length: 80 }),
  kind: practiceAddendumKindEnum("kind").notNull().default("trabalho_adicional"),
  title: varchar("title", { length: 240 }).notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  impactDays: integer("impact_days").notNull().default(0),
  status: practiceAddendumStatusEnum("status").notNull().default("rascunho"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const practiceInvoices = pgTable("practice_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  quoteId: uuid("quote_id").references(() => practiceQuotes.id, { onDelete: "set null" }),
  engagementId: uuid("engagement_id").references(() => practiceEngagements.id, { onDelete: "set null" }),
  clientId: uuid("client_id").references(() => practiceClients.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceNumber: varchar("invoice_number", { length: 80 }),
  clientName: varchar("client_name", { length: 200 }).notNull(),
  status: practiceInvoiceStatusEnum("status").notNull().default("rascunho"),
  issueDate: date("issue_date"),
  dueDate: date("due_date"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [unique("practice_invoice_number_unique").on(table.companyId, table.invoiceNumber)]);

export const practiceMilestones = pgTable("practice_milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => practiceEngagements.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  percent: numeric("percent", { precision: 5, scale: 2 }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  dueDate: date("due_date"),
  status: practiceMilestoneStatusEnum("status").notNull().default("pendente"),
  invoiceId: uuid("invoice_id").references(() => practiceInvoices.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const practiceInvoiceLines = pgTable("practice_invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => practiceInvoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: varchar("unit", { length: 20 }).notNull().default("un"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const practiceReceipts = pgTable("practice_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => practiceInvoices.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  receiptNumber: varchar("receipt_number", { length: 80 }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  receivedDate: date("received_date").notNull(),
  reference: varchar("reference", { length: 150 }),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Destino de cada parcela recebida: fica em caixa ou vai para serviço de terceiro. */
export const practiceReceiptDestinations = pgTable("practice_receipt_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull().references(() => practiceReceipts.id, { onDelete: "cascade" }),
  kind: practiceDestinationKindEnum("kind").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  partyName: varchar("party_name", { length: 200 }),
  description: text("description"),
  /** Quando kind=terceiro: null = ainda a desembolsar; preenchido = já pago ao terceiro. */
  paidAt: date("paid_at"),
});

// O contrato é a referência comercial da obra. Adendas nunca reescrevem o valor original:
// cada uma guarda a sua decisão e só as aprovadas entram no valor contratual revisto.
export const projectContracts = pgTable("project_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }).unique(),
  contractNumber: varchar("contract_number", { length: 100 }).notNull(),
  clientName: varchar("client_name", { length: 200 }).notNull(),
  awardDate: date("award_date"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  originalAmount: numeric("original_amount", { precision: 14, scale: 2 }).notNull(),
  advanceAmount: numeric("advance_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  retentionRate: numeric("retention_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  status: contractStatusEnum("status").notNull().default("rascunho"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contractVariations = pgTable("contract_variations", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull().references(() => projectContracts.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  reason: text("reason").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  status: contractVariationStatusEnum("status").notNull().default("rascunho"),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Auditoria ----------
//
// Diário de eventos exclusivamente acrescentável. Não tem FKs deliberadamente: um registo de
// auditoria precisa de sobreviver à eliminação administrativa de um documento ou utilizador e
// nunca deve ser alterado para "corrigir" o passado. As rotas da aplicação só inserem/lêem estes
// eventos; não existe operação de update/delete.
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  projectId: uuid("project_id"),
  actorUserId: uuid("actor_user_id"),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: uuid("entity_id"),
  action: varchar("action", { length: 80 }).notNull(),
  beforeData: jsonb("before_data"),
  afterData: jsonb("after_data"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Diário de Obra ----------

// Registo diário de obra — um por dia (normalmente), preenchido pelo responsável em obra.
// Campos que dependem de hardware/serviço externo (GPS, vídeo, nota de voz transcrita
// automaticamente, assinatura digital) ainda não estão implementados — ver nota no documento de
// funcionalidades; aqui cobre-se tudo o que é só texto/foto, que é a maior parte do valor real de
// um diário de obra no dia-a-dia.
export const siteDiaryEntries = pgTable("site_diary_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  weather: varchar("weather", { length: 50 }),
  workersPresent: integer("workers_present"),
  equipmentPresent: text("equipment_present"),
  workDone: text("work_done").notNull(),
  materialsReceived: text("materials_received"),
  materialsConsumed: text("materials_consumed"),
  visitors: text("visitors"),
  inspectorInstructions: text("inspector_instructions"),
  incidents: text("incidents"),
  decisions: text("decisions"),
  entryTime: varchar("entry_time", { length: 5 }),
  exitTime: varchar("exit_time", { length: 5 }),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const siteDiaryTaskProgress = pgTable("site_diary_task_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  diaryEntryId: uuid("diary_entry_id").notNull().references(() => siteDiaryEntries.id, { onDelete: "cascade" }),
  scheduleTaskId: uuid("schedule_task_id").notNull().references(() => scheduleTasks.id, { onDelete: "cascade" }),
  progressPercent: numeric("progress_percent", { precision: 5, scale: 2 }).notNull(),
  notes: text("notes"),
}, (table) => [unique("site_diary_task_progress_unique").on(table.diaryEntryId, table.scheduleTaskId)]);

// ---------- Compras, Fornecedores e Armazém ----------

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", ["rascunho", "aprovado", "recebido", "cancelado"]);
export const stockMovementTypeEnum = pgEnum("stock_movement_type", ["entrada", "saida"]);
export const purchaseRequisitionStatusEnum = pgEnum("purchase_requisition_status", [
  "rascunho", "submetida", "aprovada", "em_cotacao", "adjudicada", "comprada", "fechada", "cancelada",
]);
export const procurementRfqStatusEnum = pgEnum("procurement_rfq_status", [
  "rascunho", "aberta", "em_avaliacao", "adjudicada", "cancelada", "expirada",
]);
export const procurementInvitationStatusEnum = pgEnum("procurement_invitation_status", [
  "convidado", "visualizado", "respondido", "recusado", "expirado",
]);
export const procurementSupplierQuoteStatusEnum = pgEnum("procurement_supplier_quote_status", [
  "rascunho", "submetida", "substituida", "retirada",
]);
export const purchaseOrderSupplierConfirmationStatusEnum = pgEnum("purchase_order_supplier_confirmation_status", [
  "pendente", "confirmado", "alteracao_solicitada", "recusado",
]);
export const purchaseOrderFulfillmentStatusEnum = pgEnum("purchase_order_fulfillment_status", [
  "aguarda_confirmacao", "confirmado", "em_preparacao", "pronto_expedir", "em_transito", "parcialmente_recebido", "recebido", "fechado",
]);
export const purchaseOrderShipmentStatusEnum = pgEnum("purchase_order_shipment_status", [
  "rascunho", "pronto", "expedido", "entregue", "cancelado",
]);
export const goodsReceiptStatusEnum = pgEnum("goods_receipt_status", ["rascunho", "confirmado", "cancelado"]);
export const supplierInvoiceStatusEnum = pgEnum("supplier_invoice_status", [
  "rascunho", "submetida", "em_revisao", "divergente", "aprovada", "rejeitada", "parcialmente_paga", "paga", "cancelada",
]);
export const supplierInvoiceFiscalDocumentStatusEnum = pgEnum("supplier_invoice_fiscal_document_status", [
  "carregado", "extraido", "requer_revisao", "validado", "rejeitado",
]);
export const procurementPaymentRequestStatusEnum = pgEnum("procurement_payment_request_status", [
  "rascunho", "submetido", "aprovado", "rejeitado", "executado", "cancelado",
]);
export const procurementBankTransactionStatusEnum = pgEnum("procurement_bank_transaction_status", [
  "importado", "sugerido", "reconciliado", "ignorado",
]);
export const supplierInvoiceCreditNoteStatusEnum = pgEnum("supplier_invoice_credit_note_status", [
  "submetida", "aceite", "rejeitada", "cancelada",
]);
export const procurementNonconformityStatusEnum = pgEnum("procurement_nonconformity_status", [
  "aberta", "aguarda_fornecedor", "solucao_proposta", "aguarda_substituicao", "aguarda_credito", "devolucao_pendente", "resolvida", "cancelada",
]);
export const procurementNonconformityResolutionEnum = pgEnum("procurement_nonconformity_resolution", [
  "substituicao", "nota_credito", "devolucao", "aceite_com_desconto", "outro",
]);
export const procurementGoodsReturnStatusEnum = pgEnum("procurement_goods_return_status", [
  "rascunho", "expedida", "recebida_fornecedor", "cancelada",
]);

// Duas naturezas de linha nesta tabela, distinguidas por `companyId`:
// 1) `companyId` preenchido — a ficha «SIGO Preços» de referência dessa empresa (gerida pelo
//    sistema, ver services/sigoPrices.ts). É a única forma de "fornecedor" que uma empresa ainda
//    tem dentro do seu próprio painel.
// 2) `companyId` NULL — um fornecedor real, registado publicamente no SIGO Fornecedores (site à
//    parte, apps/supplier), visível por TODAS as empresas (sujeito ao plano — ver
//    services/subscriptionEntitlements.ts:assertSupplierMarketplaceAccess). Uma única linha
//    global por fornecedor, nunca duplicada por empresa — o mesmo preço de mercado serve todos.
//    A empresa deixou de poder criar/editar/eliminar fornecedores próprios.
export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  contact: varchar("contact", { length: 150 }),
  location: varchar("location", { length: 200 }),
  nuit: varchar("nuit", { length: 30 }),
  notes: text("notes"),
  // Zona onde este fornecedor opera (indicada por ele próprio no registo) — só preenchida em
  // fornecedores do marketplace (companyId null). Substitui a antiga gestão de zonas por
  // empresa: a zona passou a ser uma característica do fornecedor, não do catálogo da empresa.
  zoneId: uuid("zone_id").references(() => priceZones.id, { onDelete: "set null" }),
  // Conta do Portal do Fornecedor dona desta ficha. Para a ficha «SIGO Preços» de cada empresa,
  // aponta sempre à mesma conta global (ver sigoPrices.ts); para um fornecedor do marketplace, é
  // a conta que ele próprio criou ao registar-se — sempre preenchida nesse caso.
  supplierAccountId: uuid("supplier_account_id").references((): AnyPgColumn => supplierAccounts.id, { onDelete: "set null" }),
  // Marketplace: o fornecedor escolhe o que vende — o painel «Meus preços» só mostra estes tipos.
  offersMaterials: boolean("offers_materials").notNull().default(false),
  offersLabour: boolean("offers_labour").notNull().default(false),
  offersEquipment: boolean("offers_equipment").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Produtos do catálogo nacional (ou criados pelo próprio fornecedor) que esta ficha marketplace
// seleccionou para vender — sem isto, «Meus preços» não lista o catálogo inteiro.
export const supplierCatalogItems = pgTable(
  "supplier_catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(), // material | labour | equipment
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "cascade" }),
    labourCategoryId: uuid("labour_category_id").references(() => labourCategories.id, { onDelete: "cascade" }),
    equipmentId: uuid("equipment_id").references(() => equipment.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

export const procurementDocumentSequences = pgTable("procurement_document_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 10 }).notNull(),
  year: integer("year").notNull(),
  nextNumber: integer("next_number").notNull().default(1),
}, (table) => [unique("procurement_document_sequence_unique").on(table.companyId, table.kind, table.year)]);

// ---------- Procurement integrado ----------
// Requisição interna != cotação != ordem de compra. Estas tabelas fecham a cadeia auditável
// necessidade -> requisição -> RFQ multi-fornecedor -> proposta -> adjudicação -> OC.
export const purchaseRequisitions = pgTable("purchase_requisitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reference: varchar("reference", { length: 50 }).notNull(),
  status: purchaseRequisitionStatusEnum("status").notNull().default("rascunho"),
  source: varchar("source", { length: 30 }).notNull().default("manual"),
  priority: varchar("priority", { length: 20 }).notNull().default("normal"),
  requiredByDate: date("required_by_date"),
  scheduleTaskId: uuid("schedule_task_id").references(() => scheduleTasks.id, { onDelete: "set null" }),
  justification: text("justification"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("purchase_requisition_reference_unique").on(table.companyId, table.reference),
  index("purchase_requisition_project_status_idx").on(table.projectId, table.status),
]);

export const purchaseRequisitionLines = pgTable("purchase_requisition_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id").notNull().references(() => purchaseRequisitions.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  requestedQty: numeric("requested_qty", { precision: 14, scale: 3 }).notNull(),
  specification: text("specification"),
  notes: text("notes"),
  sourceScheduleTaskId: uuid("source_schedule_task_id").references(() => scheduleTasks.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [unique("purchase_requisition_material_unique").on(table.requisitionId, table.materialId)]);

export const procurementRfqs = pgTable("procurement_rfqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  requisitionId: uuid("requisition_id").references(() => purchaseRequisitions.id, { onDelete: "set null" }),
  reference: varchar("reference", { length: 50 }).notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  message: text("message"),
  status: procurementRfqStatusEnum("status").notNull().default("rascunho"),
  deadlineDate: date("deadline_date"),
  deliveryLocation: text("delivery_location"),
  requiredByDate: date("required_by_date"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  allowPartialQuotes: boolean("allow_partial_quotes").notNull().default(false),
  allowPartialAward: boolean("allow_partial_award").notNull().default(false),
  paymentRequirements: text("payment_requirements"),
  commercialTerms: text("commercial_terms"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  openedAt: timestamp("opened_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_rfq_reference_unique").on(table.companyId, table.reference),
  index("procurement_rfq_project_status_idx").on(table.projectId, table.status),
]);

export const procurementRfqLines = pgTable("procurement_rfq_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => procurementRfqs.id, { onDelete: "cascade" }),
  requisitionLineId: uuid("requisition_line_id").references(() => purchaseRequisitionLines.id, { onDelete: "set null" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  description: varchar("description", { length: 300 }).notNull(),
  unit: varchar("unit", { length: 20 }),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  specification: text("specification"),
  requiredByDate: date("required_by_date"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const procurementRfqInvitations = pgTable("procurement_rfq_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => procurementRfqs.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  status: procurementInvitationStatusEnum("status").notNull().default("convidado"),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),
  declinedAt: timestamp("declined_at"),
}, (table) => [unique("procurement_rfq_supplier_unique").on(table.rfqId, table.supplierId)]);

export const procurementSupplierQuotes = pgTable("procurement_supplier_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => procurementRfqs.id, { onDelete: "cascade" }),
  invitationId: uuid("invitation_id").notNull().references(() => procurementRfqInvitations.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: procurementSupplierQuoteStatusEnum("status").notNull().default("rascunho"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  validUntil: date("valid_until"),
  leadTimeDays: integer("lead_time_days"),
  paymentTerms: text("payment_terms"),
  transportIncluded: boolean("transport_included").notNull().default(true),
  transportCost: numeric("transport_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  supplierNotes: text("supplier_notes"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_supplier_quote_version_unique").on(table.rfqId, table.supplierId, table.version),
  index("procurement_supplier_quote_rfq_status_idx").on(table.rfqId, table.status),
]);

export const procurementSupplierQuoteLines = pgTable("procurement_supplier_quote_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id").notNull().references(() => procurementSupplierQuotes.id, { onDelete: "cascade" }),
  rfqLineId: uuid("rfq_line_id").notNull().references(() => procurementRfqLines.id, { onDelete: "cascade" }),
  available: boolean("available").notNull().default(true),
  quantityOffered: numeric("quantity_offered", { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 7, scale: 3 }).notNull().default("0"),
  brand: varchar("brand", { length: 160 }),
  leadTimeDays: integer("lead_time_days"),
  notes: text("notes"),
}, (table) => [unique("procurement_supplier_quote_line_unique").on(table.quoteId, table.rfqLineId)]);

export const procurementAwards = pgTable("procurement_awards", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().references(() => procurementRfqs.id, { onDelete: "cascade" }),
  supplierQuoteId: uuid("supplier_quote_id").notNull().references(() => procurementSupplierQuotes.id),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  decisionReason: text("decision_reason").notNull(),
  awardedByUserId: uuid("awarded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  awardedAt: timestamp("awarded_at").notNull().defaultNow(),
}, (table) => [unique("procurement_award_quote_unique").on(table.rfqId, table.supplierQuoteId)]);

export const procurementAwardLines = pgTable("procurement_award_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  awardId: uuid("award_id").notNull().references(() => procurementAwards.id, { onDelete: "cascade" }),
  rfqLineId: uuid("rfq_line_id").notNull().references(() => procurementRfqLines.id),
  quoteLineId: uuid("quote_line_id").notNull().references(() => procurementSupplierQuoteLines.id),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  quantityAwarded: numeric("quantity_awarded", { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: purchaseOrderStatusEnum("status").notNull().default("rascunho"),
  orderDate: date("order_date").notNull(),
  requiredByDate: date("required_by_date"),
  scheduleTaskId: uuid("schedule_task_id").references(() => scheduleTasks.id, { onDelete: "set null" }),
  procurementAwardId: uuid("procurement_award_id").references(() => procurementAwards.id, { onDelete: "set null" }),
  purchaseRequisitionId: uuid("purchase_requisition_id").references(() => purchaseRequisitions.id, { onDelete: "set null" }),
  // Transporte adjudicado fora dos preços unitários. Mantê-lo separado preserva a proposta
  // original e garante que OC/Financeiro não perdem este custo. Valor sem IVA.
  transportCost: numeric("transport_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  // A aprovação comercial continua em `status`; estes campos descrevem a execução logística.
  // Isto preserva compatibilidade com Financeiro/OCs antigas sem confundir "aprovado" com
  // "confirmado pelo fornecedor" ou "material fisicamente recebido".
  supplierConfirmationStatus: purchaseOrderSupplierConfirmationStatusEnum("supplier_confirmation_status").notNull().default("pendente"),
  fulfillmentStatus: purchaseOrderFulfillmentStatusEnum("fulfillment_status").notNull().default("aguarda_confirmacao"),
  approvedAt: timestamp("approved_at"),
  supplierConfirmedAt: timestamp("supplier_confirmed_at"),
  promisedDeliveryDate: date("promised_delivery_date"),
  supplierResponseNotes: text("supplier_response_notes"),
  lastSupplierUpdateAt: timestamp("last_supplier_update_at"),
  notes: text("notes"),
  // Snapshot fiscal da ordem. O total aprovado no Financeiro usa esta taxa, mesmo que a taxa
  // padrão da empresa venha a mudar depois.
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0.16"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Linhas de ordem de compra ligadas a um material real do Catálogo (não texto livre) — a mesma
// entidade `materials` usada nas composições de custo. Isto é o que liga Compras ao resto do
// sistema: comprar "Cimento (saco 50kg)" aqui é o mesmo material que entra nas composições de
// Betão. O preço/unidade de medida vem do material; `unitCost` fica na linha porque o preço de
// compra real varia por encomenda (não é o preço base do catálogo).
export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
}, (table) => [unique("purchase_order_material_unique").on(table.purchaseOrderId, table.materialId)]);

// Histórico append-only das acções do fornecedor sobre uma OC. Não substitui auditoria da
// empresa; regista o lado do portal, que usa autenticação própria (`supplier_accounts`).
export const purchaseOrderSupplierEvents = pgTable("purchase_order_supplier_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  supplierAccountId: uuid("supplier_account_id").notNull().references((): AnyPgColumn => supplierAccounts.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  message: text("message"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("purchase_order_supplier_event_order_idx").on(table.purchaseOrderId, table.createdAt)]);

// Uma OC pode sair em várias cargas. Cada expedição declara exactamente as quantidades que o
// fornecedor preparou/expediu por linha, permitindo comparar "a expedir", "em trânsito" e
// "aceite em obra" sem usar textos livres.
export const purchaseOrderShipments = pgTable("purchase_order_shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  reference: varchar("reference", { length: 50 }).notNull(),
  status: purchaseOrderShipmentStatusEnum("status").notNull().default("rascunho"),
  expectedDeliveryDate: date("expected_delivery_date"),
  carrier: varchar("carrier", { length: 200 }),
  vehiclePlate: varchar("vehicle_plate", { length: 80 }),
  driverName: varchar("driver_name", { length: 160 }),
  driverPhone: varchar("driver_phone", { length: 80 }),
  trackingReference: varchar("tracking_reference", { length: 160 }),
  supplierNotes: text("supplier_notes"),
  createdBySupplierAccountId: uuid("created_by_supplier_account_id").references((): AnyPgColumn => supplierAccounts.id, { onDelete: "set null" }),
  readyAt: timestamp("ready_at"),
  dispatchedAt: timestamp("dispatched_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("purchase_order_shipment_reference_idx").on(table.reference),
  index("purchase_order_shipment_order_status_idx").on(table.purchaseOrderId, table.status),
]);

export const purchaseOrderShipmentLines = pgTable("purchase_order_shipment_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => purchaseOrderShipments.id, { onDelete: "cascade" }),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id, { onDelete: "cascade" }),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
}, (table) => [unique("purchase_order_shipment_line_unique").on(table.shipmentId, table.purchaseOrderLineId)]);

// Documento de recepção/inspecção em obra. `deliveredQty` é o que chegou fisicamente;
// `acceptedQty` é o único que entra em stock; `rejectedQty` continua pendente para substituição.
export const goodsReceipts = pgTable("goods_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  shipmentId: uuid("shipment_id").references(() => purchaseOrderShipments.id, { onDelete: "set null" }),
  reference: varchar("reference", { length: 50 }).notNull(),
  status: goodsReceiptStatusEnum("status").notNull().default("rascunho"),
  receiptDate: date("receipt_date").notNull(),
  deliveryNoteNumber: varchar("delivery_note_number", { length: 160 }),
  inspectionNotes: text("inspection_notes"),
  receivedByUserId: uuid("received_by_user_id").references(() => users.id, { onDelete: "set null" }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("goods_receipt_reference_idx").on(table.reference),
  // Não é UNIQUE: uma recepção anulada pode ser refeita para a mesma expedição. A API
  // serializa por OC/expedição e garante apenas uma recepção activa.
  index("goods_receipt_shipment_idx").on(table.shipmentId),
  index("goods_receipt_order_date_idx").on(table.purchaseOrderId, table.receiptDate),
]);

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  goodsReceiptId: uuid("goods_receipt_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  deliveredQty: numeric("delivered_qty", { precision: 14, scale: 3 }).notNull(),
  acceptedQty: numeric("accepted_qty", { precision: 14, scale: 3 }).notNull(),
  rejectedQty: numeric("rejected_qty", { precision: 14, scale: 3 }).notNull().default("0"),
  rejectionReason: text("rejection_reason"),
  conditionNotes: text("condition_notes"),
  // Snapshot do custo adjudicado para métricas de qualidade por valor e entrada de stock.
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
}, (table) => [unique("goods_receipt_order_line_unique").on(table.goodsReceiptId, table.purchaseOrderLineId)]);

// Não-conformidade formal criada quando a inspecção rejeita material. A quantidade rejeitada
// nunca entra no stock, mas permanece fisicamente/rastreavelmente ligada à recepção e à OC.
export const procurementNonconformities = pgTable("procurement_nonconformities", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  goodsReceiptLineId: uuid("goods_receipt_line_id").notNull().references(() => goodsReceiptLines.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  reference: varchar("reference", { length: 50 }).notNull(),
  rejectedQty: numeric("rejected_qty", { precision: 14, scale: 3 }).notNull(),
  status: procurementNonconformityStatusEnum("status").notNull().default("aguarda_fornecedor"),
  description: text("description").notNull(),
  resolutionType: procurementNonconformityResolutionEnum("resolution_type"),
  proposedReplacementQty: numeric("proposed_replacement_qty", { precision: 14, scale: 3 }),
  proposedCreditAmount: numeric("proposed_credit_amount", { precision: 14, scale: 2 }),
  supplierResponse: text("supplier_response"),
  buyerResolutionNotes: text("buyer_resolution_notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  respondedBySupplierAccountId: uuid("responded_by_supplier_account_id").references(() => supplierAccounts.id, { onDelete: "set null" }),
  respondedAt: timestamp("responded_at"),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_nonconformity_receipt_line_unique").on(table.goodsReceiptLineId),
  unique("procurement_nonconformity_reference_unique").on(table.companyId, table.reference),
  index("procurement_nonconformity_project_status_idx").on(table.projectId, table.status),
  index("procurement_nonconformity_supplier_order_idx").on(table.purchaseOrderId, table.status),
]);

// Devolução física de material rejeitado na recepção. Não cria saída de stock porque a
// quantidade rejeitada nunca entrou no armazém; serve para cadeia de custódia e confirmação do fornecedor.
export const procurementGoodsReturns = pgTable("procurement_goods_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  nonconformityId: uuid("nonconformity_id").notNull().references(() => procurementNonconformities.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  goodsReceiptLineId: uuid("goods_receipt_line_id").notNull().references(() => goodsReceiptLines.id),
  reference: varchar("reference", { length: 50 }).notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  status: procurementGoodsReturnStatusEnum("status").notNull().default("rascunho"),
  returnDate: date("return_date"),
  reason: text("reason"),
  trackingReference: varchar("tracking_reference", { length: 160 }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  confirmedBySupplierAccountId: uuid("confirmed_by_supplier_account_id").references(() => supplierAccounts.id, { onDelete: "set null" }),
  supplierConfirmedAt: timestamp("supplier_confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_goods_return_reference_unique").on(table.companyId, table.reference),
  index("procurement_goods_return_ncr_status_idx").on(table.nonconformityId, table.status),
]);

// Factura do fornecedor: obrigação financeira distinta do compromisso da OC. A aprovação só
// acontece depois de refazer o three-way match OC × recepção aceite × factura sob lock.
export const supplierInvoices = pgTable("supplier_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  invoiceNumber: varchar("invoice_number", { length: 120 }).notNull(),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date"),
  status: supplierInvoiceStatusEnum("status").notNull().default("rascunho"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull(),
  transportCost: numeric("transport_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  supplierNotes: text("supplier_notes"),
  buyerNotes: text("buyer_notes"),
  matchStatus: varchar("match_status", { length: 30 }).notNull().default("pendente"),
  matchSnapshot: jsonb("match_snapshot").$type<Record<string, unknown> | null>(),
  matchedAt: timestamp("matched_at"),
  varianceReason: text("variance_reason"),
  varianceApprovedByUserId: uuid("variance_approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  varianceApprovedAt: timestamp("variance_approved_at"),
  submittedBySupplierAccountId: uuid("submitted_by_supplier_account_id").references(() => supplierAccounts.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("supplier_invoice_supplier_number_unique").on(table.supplierId, table.invoiceNumber),
  index("supplier_invoice_project_status_idx").on(table.projectId, table.status),
  index("supplier_invoice_order_status_idx").on(table.purchaseOrderId, table.status),
]);

export const supplierInvoiceLines = pgTable("supplier_invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierInvoiceId: uuid("supplier_invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  description: varchar("description", { length: 300 }).notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
}, (table) => [unique("supplier_invoice_order_line_unique").on(table.supplierInvoiceId, table.purchaseOrderLineId)]);

export const supplierInvoicePayments = pgTable("supplier_invoice_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierInvoiceId: uuid("supplier_invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  method: varchar("method", { length: 50 }).notNull().default("transferencia"),
  reference: varchar("reference", { length: 160 }),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("supplier_invoice_payment_invoice_date_idx").on(table.supplierInvoiceId, table.paymentDate)]);

// Fase 4 — documento fiscal original. O ficheiro é append-only/versionado e hashado; dados
// extraídos por OCR/IA são apenas proposta de leitura. `reviewedData` é a versão conferida
// manualmente e `validationSnapshot` guarda o resultado comparado com factura/fornecedor/empresa.
export const supplierInvoiceFiscalDocuments = pgTable("supplier_invoice_fiscal_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  supplierInvoiceId: uuid("supplier_invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: supplierInvoiceFiscalDocumentStatusEnum("status").notNull().default("carregado"),
  filePath: text("file_path").notNull(),
  originalName: varchar("original_name", { length: 300 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  extractionProvider: varchar("extraction_provider", { length: 120 }),
  extractionConfidence: numeric("extraction_confidence", { precision: 6, scale: 5 }),
  extractedData: jsonb("extracted_data").$type<Record<string, unknown>>(),
  reviewedData: jsonb("reviewed_data").$type<Record<string, unknown>>(),
  extractionMessage: text("extraction_message"),
  extractedAt: timestamp("extracted_at"),
  validationSnapshot: jsonb("validation_snapshot").$type<Record<string, unknown>>(),
  validatedByUserId: uuid("validated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  validatedAt: timestamp("validated_at"),
  rejectionReason: text("rejection_reason"),
  uploadedBySupplierAccountId: uuid("uploaded_by_supplier_account_id").references((): AnyPgColumn => supplierAccounts.id, { onDelete: "set null" }),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("supplier_invoice_fiscal_document_version_unique").on(table.supplierInvoiceId, table.version),
  unique("supplier_invoice_fiscal_document_hash_unique").on(table.companyId, table.sha256),
  index("supplier_invoice_fiscal_document_invoice_idx").on(table.supplierInvoiceId, table.createdAt),
]);

// Pedido de pagamento separado do pagamento executado. A aprovação reserva saldo mas não cria
// caixa; `supplier_invoice_payments` só é criado na execução/reconciliação bancária.
export const procurementPaymentRequests = pgTable("procurement_payment_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierInvoiceId: uuid("supplier_invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
  reference: varchar("reference", { length: 50 }).notNull(),
  status: procurementPaymentRequestStatusEnum("status").notNull().default("rascunho"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  requestedPaymentDate: date("requested_payment_date"),
  method: varchar("method", { length: 50 }).notNull().default("transferencia"),
  payeeBankName: varchar("payee_bank_name", { length: 160 }),
  payeeAccountName: varchar("payee_account_name", { length: 200 }),
  payeeAccountNumber: varchar("payee_account_number", { length: 120 }),
  reason: text("reason"),
  notes: text("notes"),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  approvalOverrideReason: text("approval_override_reason"),
  rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  executedByUserId: uuid("executed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  executedAt: timestamp("executed_at"),
  executionDate: date("execution_date"),
  executionReference: varchar("execution_reference", { length: 160 }),
  executionOverrideReason: text("execution_override_reason"),
  supplierInvoicePaymentId: uuid("supplier_invoice_payment_id").references(() => supplierInvoicePayments.id, { onDelete: "set null" }),
  executionProofFilePath: text("execution_proof_file_path"),
  executionProofOriginalName: varchar("execution_proof_original_name", { length: 300 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_payment_request_reference_unique").on(table.companyId, table.reference),
  index("procurement_payment_request_invoice_status_idx").on(table.supplierInvoiceId, table.status),
  index("procurement_payment_request_project_idx").on(table.projectId, table.createdAt),
]);

export const procurementBankStatementImports = pgTable("procurement_bank_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  bankName: varchar("bank_name", { length: 160 }).notNull(),
  accountLabel: varchar("account_label", { length: 160 }),
  currency: currencyEnum("currency").notNull().default("MZN"),
  originalName: varchar("original_name", { length: 300 }).notNull(),
  filePath: text("file_path").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  rowCount: integer("row_count").notNull().default(0),
  importedByUserId: uuid("imported_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_bank_statement_hash_unique").on(table.companyId, table.sha256),
  index("procurement_bank_statement_project_idx").on(table.projectId, table.createdAt),
]);

export const procurementBankTransactions = pgTable("procurement_bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  statementImportId: uuid("statement_import_id").notNull().references(() => procurementBankStatementImports.id, { onDelete: "cascade" }),
  status: procurementBankTransactionStatusEnum("status").notNull().default("importado"),
  transactionDate: date("transaction_date").notNull(),
  valueDate: date("value_date"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  description: text("description"),
  reference: varchar("reference", { length: 240 }),
  counterparty: varchar("counterparty", { length: 240 }),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_bank_transaction_fingerprint_unique").on(table.companyId, table.fingerprint),
  index("procurement_bank_transaction_project_status_idx").on(table.projectId, table.status, table.transactionDate),
]);

export const procurementBankReconciliations = pgTable("procurement_bank_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  bankTransactionId: uuid("bank_transaction_id").notNull().references(() => procurementBankTransactions.id, { onDelete: "cascade" }),
  paymentRequestId: uuid("payment_request_id").notNull().references(() => procurementPaymentRequests.id, { onDelete: "cascade" }),
  matchMethod: varchar("match_method", { length: 30 }).notNull().default("manual"),
  matchScore: integer("match_score"),
  notes: text("notes"),
  reconciledByUserId: uuid("reconciled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reconciledAt: timestamp("reconciled_at").notNull().defaultNow(),
}, (table) => [
  unique("procurement_bank_reconciliation_transaction_unique").on(table.bankTransactionId),
  unique("procurement_bank_reconciliation_payment_unique").on(table.paymentRequestId),
]);

export const supplierInvoiceCreditNotes = pgTable("supplier_invoice_credit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierInvoiceId: uuid("supplier_invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
  nonconformityId: uuid("nonconformity_id").references(() => procurementNonconformities.id, { onDelete: "set null" }),
  creditNumber: varchar("credit_number", { length: 120 }).notNull(),
  issueDate: date("issue_date").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: supplierInvoiceCreditNoteStatusEnum("status").notNull().default("submetida"),
  submittedBySupplierAccountId: uuid("submitted_by_supplier_account_id").references(() => supplierAccounts.id, { onDelete: "set null" }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("supplier_invoice_credit_number_unique").on(table.supplierInvoiceId, table.creditNumber),
  index("supplier_invoice_credit_invoice_status_idx").on(table.supplierInvoiceId, table.status),
]);

// Movimento de stock por projecto (um "armazém" simples por obra, não multi-armazém ainda) —
// "entrada" acontece automaticamente quando uma ordem de compra passa a "recebido" (ver
// purchasing.ts), ou pode ser lançada manualmente; "saída" regista consumo em obra. O stock
// actual de cada material é sempre calculado on-the-fly (soma de entradas − saídas), nunca
// guardado como um número à parte que possa dessincronizar. Também ligado ao material real do
// Catálogo, pela mesma razão das linhas de compra.
export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  type: stockMovementTypeEnum("type").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }),
  currency: currencyEnum("currency").default("MZN"),
  notes: text("notes"),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "cascade" }),
  goodsReceiptLineId: uuid("goods_receipt_line_id").references(() => goodsReceiptLines.id, { onDelete: "cascade" }),
  diaryEntryId: uuid("diary_entry_id").references(() => siteDiaryEntries.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // Recepção parcial exige várias entradas para o mesmo material/OC. Idempotência passa a ser
  // por linha de recepção, que representa um evento físico único e confirmado.
  unique("stock_goods_receipt_line_unique").on(table.goodsReceiptLineId),
]);

// Preço de um material específico por fornecedor, opcionalmente por zona (transporte varia por
// zona tal como material_zone_prices) — é isto que faz aparecer "materiais" dentro de um
// fornecedor e "fornecedores" dentro de um material, os dois lados do mesmo dado. `zoneId` nulo =
// preço geral do fornecedor, válido em qualquer zona sem preço específico definido.
export const supplierMaterialPrices = pgTable("supplier_material_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id, { onDelete: "cascade" }),
  zoneId: uuid("zone_id").references(() => priceZones.id, { onDelete: "cascade" }),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Mesma ideia que supplier_material_prices, mas para mão-de-obra subcontratada (equipas/
// empreiteiros que um fornecedor disponibiliza, cotados por hora para bater certo com o
// rendimento h/unidade das composições) e máquinas/equipamento alugado (cotado por hora, como
// equipment.hourlyCost). Nenhuma das duas substitui o custo do catálogo usado no cálculo — são
// só referência de mercado para a ordem de compra/contratação.
export const supplierLabourPrices = pgTable("supplier_labour_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  labourCategoryId: uuid("labour_category_id").notNull().references(() => labourCategories.id, { onDelete: "cascade" }),
  zoneId: uuid("zone_id").references(() => priceZones.id, { onDelete: "cascade" }),
  hourlyCost: numeric("hourly_cost", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supplierEquipmentPrices = pgTable("supplier_equipment_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  zoneId: uuid("zone_id").references(() => priceZones.id, { onDelete: "cascade" }),
  hourlyCost: numeric("hourly_cost", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Portal do Fornecedor ----------
// Identidade global do fornecedor, independente de qualquer empresa — permite que a MESMA pessoa/
// empresa fornecedora tenha uma única conta e veja, num só login, todos os pedidos de cotação de
// todas as empresas SIGO com quem trabalha (cada uma mantém a sua própria ficha em `suppliers`,
// ligada aqui via `suppliers.supplierAccountId`). Deliberadamente um sistema de autenticação à
// parte de `users`/`sessions` — nunca reutiliza userRoleEnum — para impedir qualquer fuga de
// privilégios entre o painel da empresa e o portal do fornecedor.
export const quoteRequestStatusEnum = pgEnum("quote_request_status", [
  "enviado",
  "respondido",
  "aceite",
  "recusado",
  "expirado",
  "cancelado",
]);

export const quoteRequestLineKindEnum = pgEnum("quote_request_line_kind", ["material", "labour", "equipment"]);

export const supplierAccounts = pgTable("supplier_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 150 }).notNull(),
  email: varchar("email", { length: 200 }).notNull().unique(),
  passwordHash: text("password_hash"), // fica null até o fornecedor aceitar o convite e definir password
  phone: varchar("phone", { length: 60 }),
  emailVerifiedAt: timestamp("email_verified_at"),
  inviteToken: varchar("invite_token", { length: 64 }),
  inviteTokenExpiresAt: timestamp("invite_token_expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supplierSessions = pgTable("supplier_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierAccountId: uuid("supplier_account_id")
    .notNull()
    .references(() => supplierAccounts.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const quoteRequests = pgTable("quote_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  message: text("message"),
  deadlineDate: date("deadline_date"),
  status: quoteRequestStatusEnum("status").notNull().default("enviado"),
  supplierNotes: text("supplier_notes"),
  respondedAt: timestamp("responded_at"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const quoteRequestLines = pgTable("quote_request_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteRequestId: uuid("quote_request_id")
    .notNull()
    .references(() => quoteRequests.id, { onDelete: "cascade" }),
  kind: quoteRequestLineKindEnum("kind").notNull(),
  materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
  labourCategoryId: uuid("labour_category_id").references(() => labourCategories.id, { onDelete: "set null" }),
  equipmentId: uuid("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
  description: varchar("description", { length: 300 }).notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }),
  unit: varchar("unit", { length: 20 }),
  // Preenchidos pelo fornecedor quando responde ao pedido.
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }),
  currency: currencyEnum("currency").notNull().default("MZN"),
  supplierLineNotes: text("supplier_line_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const supplierPriceFeedSyncStatusEnum = pgEnum("supplier_price_feed_sync_status", ["sucesso", "erro"]);

// Ligação automática a um sistema externo do fornecedor (o próprio site/ERP dele) para puxar
// preços periodicamente, sem depender de o fornecedor entrar manualmente no Portal do Fornecedor
// para responder a cada pedido de cotação — um "GET periódico" em vez de um formulário por item.
// Por ficha `suppliers` (por empresa), não por conta global: cada empresa pode ter um acordo/feed
// diferente com o mesmo fornecedor real.
export const supplierPriceFeeds = pgTable("supplier_price_feeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id")
    .notNull()
    .unique()
    .references(() => suppliers.id, { onDelete: "cascade" }),
  feedUrl: text("feed_url").notNull(),
  // Enviado como "Authorization: Bearer <apiKey>" se preenchido — nunca devolvido pela API depois
  // de gravado (só um indicador "está definido"/"não está definido" no GET).
  apiKey: text("api_key"),
  isActive: boolean("is_active").notNull().default(true),
  intervalHours: integer("interval_hours").notNull().default(24),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncStatus: supplierPriceFeedSyncStatusEnum("last_sync_status"),
  lastSyncError: text("last_sync_error"),
  lastSyncMatched: integer("last_sync_matched"),
  lastSyncUnmatched: integer("last_sync_unmatched"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Sino de notificações in-app — fallback para quando o email falha/está desligado, e sinal
// imediato dentro da própria aplicação sem precisar de sair para o email. Exactamente um dos
// dois destinatários está preenchido: `userId` (painel SIGO) ou `supplierAccountId` (Portal do
// Fornecedor) — são sistemas de sessão separados de propósito, por isso a notificação também.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    supplierAccountId: uuid("supplier_account_id").references(() => supplierAccounts.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    // Caminho relativo dentro da respectiva app (painel SIGO ou Portal do Fornecedor) — nunca uma
    // URL absoluta, para nunca ficar desactualizado se o domínio mudar.
    link: text("link"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("notifications_user_unread_idx").on(table.userId, table.readAt),
    index("notifications_supplier_account_unread_idx").on(table.supplierAccountId, table.readAt),
  ],
);

// ---------- Relations ----------

export const companiesRelations = relations(companies, ({ many }) => ({
  users: many(users),
  projects: many(projects),
  subscriptions: many(subscriptions),
}));

export const usersRelations = relations(users, ({ one }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  company: one(companies, { fields: [projects.companyId], references: [companies.id] }),
  budgetDocuments: many(budgetDocuments),
  plants: many(plants),
  materialSpecifications: many(projectMaterialSpecifications),
}));

export const projectMaterialSpecificationsRelations = relations(projectMaterialSpecifications, ({ one }) => ({
  project: one(projects, { fields: [projectMaterialSpecifications.projectId], references: [projects.id] }),
  material: one(materials, { fields: [projectMaterialSpecifications.materialId], references: [materials.id] }),
}));

export const budgetDocumentsRelations = relations(budgetDocuments, ({ one, many }) => ({
  project: one(projects, { fields: [budgetDocuments.projectId], references: [projects.id] }),
  sections: many(budgetSections),
}));

export const budgetSectionsRelations = relations(budgetSections, ({ one, many }) => ({
  document: one(budgetDocuments, { fields: [budgetSections.documentId], references: [budgetDocuments.id] }),
  lineItems: many(lineItems),
}));

export const lineItemsRelations = relations(lineItems, ({ one, many }) => ({
  section: one(budgetSections, { fields: [lineItems.sectionId], references: [budgetSections.id] }),
  composition: one(costCompositions, { fields: [lineItems.compositionId], references: [costCompositions.id] }),
}));

export const costCompositionsRelations = relations(costCompositions, ({ many }) => ({
  labourLines: many(compositionLabourLines),
  materialLines: many(compositionMaterialLines),
  equipmentLines: many(compositionEquipmentLines),
  subcompositionLines: many(compositionSubcompositionLines),
  derivedCostLines: many(compositionDerivedCostLines),
}));

export const plantsRelations = relations(plants, ({ one, many }) => ({
  project: one(projects, { fields: [plants.projectId], references: [projects.id] }),
  rooms: many(extractedRooms),
  rebarSchedules: many(extractedRebarSchedules),
}));
