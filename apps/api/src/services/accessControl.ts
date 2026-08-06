import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, budgetDocuments, budgetSections, lineItems, measurementCertificates, plants, costCompositions } from "../db/schema.js";

// Verifica que um recurso pertence (directa ou indirectamente, via project→document→section→item)
// à empresa do utilizador autenticado — usado em todas as rotas de projectos/orçamentos/itens
// para garantir isolamento multi-tenant.

export async function assertProjectOwned(projectId: string, companyId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId), isNull(projects.trashedAt)))
    .limit(1);
  return project ?? null;
}

export async function assertDocumentOwned(documentId: string, companyId: string) {
  const [row] = await db
    .select({ document: budgetDocuments })
    .from(budgetDocuments)
    .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
    .where(and(eq(budgetDocuments.id, documentId), eq(projects.companyId, companyId), isNull(projects.trashedAt)))
    .limit(1);
  return row?.document ?? null;
}

export async function assertSectionOwned(sectionId: string, companyId: string) {
  const [row] = await db
    .select({ section: budgetSections })
    .from(budgetSections)
    .innerJoin(budgetDocuments, eq(budgetSections.documentId, budgetDocuments.id))
    .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
    .where(and(eq(budgetSections.id, sectionId), eq(projects.companyId, companyId), isNull(projects.trashedAt)))
    .limit(1);
  return row?.section ?? null;
}

export async function assertCertificateOwned(certificateId: string, companyId: string) {
  const [row] = await db
    .select({ certificate: measurementCertificates })
    .from(measurementCertificates)
    .innerJoin(projects, eq(measurementCertificates.projectId, projects.id))
    .where(and(eq(measurementCertificates.id, certificateId), eq(projects.companyId, companyId), isNull(projects.trashedAt)))
    .limit(1);
  return row?.certificate ?? null;
}

export async function assertPlantOwned(plantId: string, companyId: string) {
  const [row] = await db
    .select({ plant: plants })
    .from(plants)
    .innerJoin(projects, eq(plants.projectId, projects.id))
    .where(and(eq(plants.id, plantId), eq(projects.companyId, companyId), isNull(projects.trashedAt)))
    .limit(1);
  return row?.plant ?? null;
}

// Resolve a zona de preço do projecto a que uma secção pertence (project → document → section) —
// usada para o cálculo do custo unitário de composições respeitar os preços de material por
// zona quando o item é criado/editado dentro dessa secção.
export async function getZoneIdForSection(sectionId: string): Promise<string | null> {
  const [row] = await db
    .select({ zoneId: projects.zoneId })
    .from(budgetSections)
    .innerJoin(budgetDocuments, eq(budgetSections.documentId, budgetDocuments.id))
    .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
    .where(eq(budgetSections.id, sectionId))
    .limit(1);
  return row?.zoneId ?? null;
}

// Verifica que uma composição de custo é VISÍVEL à empresa (partilhada, ou dela própria) antes de
// se confiar num compositionId vindo do cliente para calcular/gravar um preço — sem isto, um
// utilizador podia enviar o id de uma composição privada de OUTRA empresa e o servidor calculava
// o custo a partir dos rendimentos/preços confidenciais dessa empresa (achado da auditoria).
export async function assertCompositionVisible(compositionId: string, companyId: string) {
  const [row] = await db
    .select()
    .from(costCompositions)
    .where(and(eq(costCompositions.id, compositionId), or(isNull(costCompositions.companyId), eq(costCompositions.companyId, companyId))))
    .limit(1);
  return row ?? null;
}

export async function assertLineItemOwned(lineItemId: string, companyId: string) {
  const [row] = await db
    .select({ item: lineItems })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .innerJoin(budgetDocuments, eq(budgetSections.documentId, budgetDocuments.id))
    .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
    .where(and(eq(lineItems.id, lineItemId), eq(projects.companyId, companyId)))
    .limit(1);
  return row?.item ?? null;
}
