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
  // Texto livre acrescentado ao rodapé dos documentos exportados (Excel/PDF) desta empresa —
  // ainda não usado pelos serviços de exportação (services/excelExport.ts, pdfExport.ts); fica
  // gravado já para quando essa integração for feita.
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Catálogo de preços (companyId nullable = catálogo global partilhado) ----------

export const labourCategories = pgTable(
  "labour_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    unit: unitEnum("unit").notNull(),
    hourlyCost: numeric("hourly_cost", { precision: 14, scale: 4 }).notNull(),
    currency: currencyEnum("currency").notNull().default("MZN"),
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
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0.16"),
  contingenciasRate: numeric("contingencias_rate", { precision: 5, scale: 4 }).notNull().default("0.10"),
  siteCostsRate: numeric("site_costs_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  indirectCostsRate: numeric("indirect_costs_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  profitMarginRate: numeric("profit_margin_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  count: numeric("count", { precision: 10, scale: 2 }).notNull().default("1"),
  length: numeric("length", { precision: 12, scale: 3 }),
  width: numeric("width", { precision: 12, scale: 3 }),
  height: numeric("height", { precision: 12, scale: 3 }),
  sortOrder: integer("sort_order").notNull().default(0),
});

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

// ---------- Cronograma de obra ----------

// O cronograma usa a mesma WBS do orçamento. `budgetChapterCode` liga cada tarefa a um capítulo
// (e, por prefixo, aos respectivos itens), permitindo que autos e diário actualizem o progresso
// sem o utilizador voltar a lançar percentagens noutro módulo.
export const scheduleTasks = pgTable("schedule_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  budgetDocumentId: uuid("budget_document_id").references(() => budgetDocuments.id, { onDelete: "set null" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => scheduleTasks.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 240 }).notNull(),
  budgetChapterCode: varchar("budget_chapter_code", { length: 30 }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  baselineStartDate: date("baseline_start_date"),
  baselineEndDate: date("baseline_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  durationDays: integer("duration_days").notNull().default(1),
  manualProgress: numeric("manual_progress", { precision: 5, scale: 2 }),
  status: scheduleTaskStatusEnum("status").notNull().default("nao_iniciado"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  contact: varchar("contact", { length: 150 }),
  location: varchar("location", { length: 200 }),
  nuit: varchar("nuit", { length: 30 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  status: purchaseOrderStatusEnum("status").notNull().default("rascunho"),
  orderDate: date("order_date").notNull(),
  requiredByDate: date("required_by_date"),
  scheduleTaskId: uuid("schedule_task_id").references(() => scheduleTasks.id, { onDelete: "set null" }),
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
  diaryEntryId: uuid("diary_entry_id").references(() => siteDiaryEntries.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [unique("stock_purchase_material_unique").on(table.purchaseOrderId, table.materialId)]);

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
}));

export const plantsRelations = relations(plants, ({ one, many }) => ({
  project: one(projects, { fields: [plants.projectId], references: [projects.id] }),
  rooms: many(extractedRooms),
  rebarSchedules: many(extractedRebarSchedules),
}));
