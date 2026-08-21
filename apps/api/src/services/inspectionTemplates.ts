import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inspectionChecklistTemplates } from "../db/schema.js";

export const DEFAULT_INSPECTION_TEMPLATES: Array<{
  trade: "cofragem" | "armadura" | "betão" | "alvenaria" | "impermeabilizacao" | "instalacoes" | "acabamentos";
  name: string;
  items: Array<{ key: string; label: string; required?: boolean }>;
}> = [
  {
    trade: "cofragem",
    name: "Cofragem — verificação interna",
    items: [
      { key: "limpeza", label: "Limpeza e desengraxe do molde", required: true },
      { key: "fixacao", label: "Fixação e escoramento conforme desenho", required: true },
      { key: "vedacao", label: "Vedação de juntas e fendas", required: true },
    ],
  },
  {
    trade: "armadura",
    name: "Armadura — verificação interna",
    items: [
      { key: "diametro", label: "Diâmetro e espaçamento conforme projecto", required: true },
      { key: "cobrimento", label: "Cobrimento mínimo garantido", required: true },
      { key: "amarracao", label: "Amarração e estribos firmes", required: true },
    ],
  },
  {
    trade: "betão",
    name: "Betão — verificação interna",
    items: [
      { key: "classe", label: "Classe/resistência conforme especificação", required: true },
      { key: "lancamento", label: "Lançamento e vibração adequados", required: true },
      { key: "cura", label: "Plano de cura definido", required: true },
    ],
  },
  {
    trade: "alvenaria",
    name: "Alvenaria — verificação interna",
    items: [
      { key: "prumo", label: "Prumo e alinhamento", required: true },
      { key: "juntas", label: "Juntas horizontais e verticais", required: true },
      { key: "amarracao", label: "Amarração a pilares/vigas", required: true },
    ],
  },
  {
    trade: "impermeabilizacao",
    name: "Impermeabilização — verificação interna",
    items: [
      { key: "substrato", label: "Substrato seco e limpo", required: true },
      { key: "sobreposicao", label: "Sobreposição de mantas/fitas", required: true },
      { key: "proteccao", label: "Protecção mecânica prevista", required: true },
    ],
  },
  {
    trade: "instalacoes",
    name: "Instalações — verificação interna",
    items: [
      { key: "trajeto", label: "Trajeto conforme projecto", required: true },
      { key: "fixacao", label: "Fixação e suportes", required: true },
      { key: "ensaios", label: "Ensaios previstos registados", required: false },
    ],
  },
  {
    trade: "acabamentos",
    name: "Acabamentos — verificação interna",
    items: [
      { key: "preparacao", label: "Preparação de superfície", required: true },
      { key: "materiais", label: "Materiais conforme especificação", required: true },
      { key: "uniformidade", label: "Uniformidade e acabamento visual", required: true },
    ],
  },
];

export async function ensureInspectionTemplates(companyId: string) {
  const existing = await db
    .select({ trade: inspectionChecklistTemplates.trade })
    .from(inspectionChecklistTemplates)
    .where(eq(inspectionChecklistTemplates.companyId, companyId));
  const have = new Set(existing.map((row) => row.trade));
  const missing = DEFAULT_INSPECTION_TEMPLATES.filter((template) => !have.has(template.trade));
  if (!missing.length) {
    return db
      .select()
      .from(inspectionChecklistTemplates)
      .where(and(eq(inspectionChecklistTemplates.companyId, companyId), eq(inspectionChecklistTemplates.isActive, true)))
      .orderBy(asc(inspectionChecklistTemplates.trade));
  }
  await db.insert(inspectionChecklistTemplates).values(
    missing.map((template) => ({
      companyId,
      trade: template.trade,
      name: template.name,
      items: template.items,
    })),
  );
  return db
    .select()
    .from(inspectionChecklistTemplates)
    .where(and(eq(inspectionChecklistTemplates.companyId, companyId), eq(inspectionChecklistTemplates.isActive, true)))
    .orderBy(asc(inspectionChecklistTemplates.trade));
}
