import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  timestamp,
  pgEnum,
  date,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Catálogo de preços (companyId nullable = catálogo global partilhado) ----------

export const labourCategories = pgTable("labour_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 150 }).notNull(),
  monthlySalary: numeric("monthly_salary", { precision: 14, scale: 2 }).notNull(),
  hourlyRate: numeric("hourly_rate", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
});

export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  unit: unitEnum("unit").notNull(),
  baseUnitCost: numeric("base_unit_cost", { precision: 14, scale: 4 }).notNull(),
  importFactor: numeric("import_factor", { precision: 6, scale: 4 }).notNull().default("1.0"),
  currency: currencyEnum("currency").notNull().default("MZN"),
  // Embalagem/unidade de compra de mercado, quando difere da unidade de medida usada nas
  // composições (ex: areia medida em m3 nas composições, mas vendida por camião de Xm3) — ambos
  // nullable: null = compra-se directamente na unidade de medida, sem conversão (ex: água, local;
  // pregos/arame, ao peso). `purchasePackageQty` é quantas unidades de medida cabem numa unidade
  // de compra (ex: 10 para um camião de 10m3).
  purchasePackageLabel: varchar("purchase_package_label", { length: 100 }),
  purchasePackageQty: numeric("purchase_package_qty", { precision: 14, scale: 4 }),
});

// Zonas de preço (ex: "Baixa", "Matola") — o custo de um material pode variar consoante a zona
// da obra (transporte, disponibilidade local); companyId nullable = lista partilhada (mesma
// convenção de clonagem transparente já usada em labour_categories/materials/equipment).
export const priceZones = pgTable("price_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
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
});

export const equipment = pgTable("equipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  unit: unitEnum("unit").notNull(),
  hourlyCost: numeric("hourly_cost", { precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
});

export const costCompositions = pgTable("cost_compositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }).notNull().default("Outros"),
  outputUnit: unitEnum("output_unit").notNull(),
  currency: currencyEnum("currency").notNull().default("MZN"),
});

export const compositionLabourLines = pgTable("composition_labour_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  labourCategoryId: uuid("labour_category_id").notNull().references(() => labourCategories.id),
  qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 6 }).notNull(),
});

export const compositionMaterialLines = pgTable("composition_material_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 6 }).notNull(),
});

export const compositionEquipmentLines = pgTable("composition_equipment_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  compositionId: uuid("composition_id").notNull().references(() => costCompositions.id, { onDelete: "cascade" }),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
  qtyPerUnit: numeric("qty_per_unit", { precision: 14, scale: 6 }).notNull(),
});

export const workItemTemplates = pgTable("work_item_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  chapterName: varchar("chapter_name", { length: 200 }).notNull(),
  chapterCode: varchar("chapter_code", { length: 10 }),
  description: text("description").notNull(),
  unit: unitEnum("unit").notNull(),
  compositionId: uuid("composition_id").references(() => costCompositions.id),
  sortOrder: integer("sort_order").notNull().default(0),
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
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0.17"),
  contingenciasRate: numeric("contingencias_rate", { precision: 5, scale: 4 }).notNull().default("0.10"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const budgetDocuments = pgTable("budget_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  revision: varchar("revision", { length: 20 }),
  fileNumber: varchar("file_number", { length: 50 }),
  currency: currencyEnum("currency").notNull().default("MZN"),
  documentDate: date("document_date"),
  ivaRate: numeric("iva_rate", { precision: 5, scale: 4 }).notNull().default("0.17"),
  contingenciasRate: numeric("contingencias_rate", { precision: 5, scale: 4 }).notNull().default("0.10"),
  status: documentStatusEnum("status").notNull().default("rascunho"),
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
});

export const lineItems = pgTable("line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id").notNull().references(() => budgetSections.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => lineItems.id, { onDelete: "cascade" }),
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
  periodDate: date("period_date").notNull(),
  status: documentStatusEnum("status").notNull().default("rascunho"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const measurementCertificateLines = pgTable("measurement_certificate_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificateId: uuid("certificate_id").notNull().references(() => measurementCertificates.id, { onDelete: "cascade" }),
  lineItemId: uuid("line_item_id").notNull().references(() => lineItems.id),
  cumulativeQty: numeric("cumulative_qty", { precision: 16, scale: 4 }).notNull().default("0"),
  periodQty: numeric("period_qty", { precision: 16, scale: 4 }).notNull().default("0"),
});

// ---------- Plantas ----------

export const plants = pgTable("plants", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  discipline: plantDisciplineEnum("discipline").notNull(),
  filePath: text("file_path").notNull(),
  originalFileName: varchar("original_file_name", { length: 300 }),
  processingStatus: plantStatusEnum("processing_status").notNull().default("pendente"),
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
    totalSteelWeightKg: number;
  } | null>(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

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
});

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
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
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
  notes: text("notes"),
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
});

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
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
