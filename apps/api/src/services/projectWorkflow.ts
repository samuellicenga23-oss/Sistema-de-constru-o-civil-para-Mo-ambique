import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  projects,
  plants,
  extractedRooms,
  budgetDocuments,
  budgetSections,
  lineItems,
} from "../db/schema.js";
import { getStandardSectionId } from "./quickEstimate.js";

export type WorkflowCycleId =
  | "preparar_obra"
  | "sem_plantas"
  | "planta_servico_indisponivel"
  | "planta_erro_total"
  | "planta_parcial"
  | "planta_em_processamento"
  | "planta_sem_compartimentos"
  | "medicoes_vazias"
  | "medicoes_sem_assistente"
  | "import_excel_pendente"
  | "pronto_para_orcamento"
  | "orcamento_sem_preco"
  | "orcamento_nao_aprovado"
  | "certificacao_disponivel"
  | "mapa_nao_padrao";

export type WorkflowAction = {
  label: string;
  path?: string;
  anchor?: string;
  hint?: string;
};

export type WorkflowGuidanceItem = {
  id: WorkflowCycleId;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  actions: WorkflowAction[];
};

export type ProjectWorkflowStatus = {
  projectId: string;
  measurementMode: string;
  projectType: string;
  guidance: WorkflowGuidanceItem[];
};

async function countLeafItemsWithoutPrice(documentId: string): Promise<number> {
  const rows = await db
    .select({ id: lineItems.id, unitPrice: lineItems.unitPrice, compositionId: lineItems.compositionId })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(and(eq(budgetSections.documentId, documentId), eq(lineItems.kind, "item")));
  return rows.filter((r) => r.unitPrice === null && r.compositionId === null).length;
}

async function countLeafItemsWithoutQuantity(documentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(
      and(
        eq(budgetSections.documentId, documentId),
        eq(lineItems.kind, "item"),
        sql`(${lineItems.quantity} IS NULL OR ${lineItems.quantity} = 0)`,
      ),
    );
  return row?.count ?? 0;
}

export async function getProjectWorkflowStatus(projectId: string): Promise<ProjectWorkflowStatus | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const guidance: WorkflowGuidanceItem[] = [];
  const plantRows = await db.select().from(plants).where(eq(plants.projectId, projectId));
  const docs = await db.select().from(budgetDocuments).where(eq(budgetDocuments.projectId, projectId));
  const measurementDocs = docs.filter((d) => d.documentType === "medicao");
  const budgetDocs = docs.filter((d) => d.documentType === "orcamento");

  const usesPlants = project.measurementMode === "plantas";
  const usesImport = project.measurementMode === "importar";

  if (!project.zoneId && budgetDocs.length === 0) {
    guidance.push({
      id: "preparar_obra",
      severity: "warning",
      title: "Prepare a obra antes de medir e orçamentar",
      message:
        "Defina a zona de preços e confirme cotações/composições no catálogo. Assim, ao enviar a medição para orçamento, os custos unitários já vêm correctos — evita vários mapas sem preço.",
      actions: [
        { label: "Preparar obra", anchor: "preparar-obra" },
        { label: "Catálogo", path: "/catalogo" },
        { label: "Fornecedores", path: "/fornecedores" },
      ],
    });
  }

  if (usesPlants) {
    if (plantRows.length === 0) {
      guidance.push({
        id: "sem_plantas",
        severity: "info",
        title: "Sem plantas carregadas",
        message: "Este projecto foi criado para usar plantas, mas ainda não há PDFs. Pode carregar desenhos ou passar à medição manual no Mapa de Quantidades.",
        actions: [
          { label: "Carregar PDF", anchor: "plantas-do-projecto" },
          { label: "Medição manual", path: measurementDocs[0] ? `/documentos/${measurementDocs[0].id}?assistente=1` : undefined, hint: "Abre o assistente sem planta" },
        ],
      });
    } else {
      const errored = plantRows.filter((p) => p.processingStatus === "erro");
      const completed = plantRows.filter((p) => p.processingStatus === "concluido");
      const processing = plantRows.filter((p) => p.processingStatus === "processando" || p.processingStatus === "pendente");

      const serviceDown = errored.some((p) => p.errorMessage?.includes("plant-service") || p.errorMessage?.includes("8001"));
      if (serviceDown) {
        guidance.push({
          id: "planta_servico_indisponivel",
          severity: "error",
          title: "Serviço de análise de plantas indisponível",
          message: "O motor de leitura de PDF não está a correr. Inicie o plant-service ou use medição manual / importação Excel enquanto isso.",
          actions: [
            { label: "Ver plantas", anchor: "plantas-do-projecto" },
            { label: "Importar Excel", path: measurementDocs[0] ? `/documentos/${measurementDocs[0].id}` : undefined },
          ],
        });
      } else if (errored.length === plantRows.length) {
        guidance.push({
          id: "planta_erro_total",
          severity: "error",
          title: "Nenhuma planta foi lida com sucesso",
          message: "Todos os PDFs falharam na análise. Tente reprocessar, confirme que o ficheiro é um projecto de arquitectura/estrutura legível, ou use o caminho manual.",
          actions: [
            { label: "Rever ficheiros", anchor: "plantas-do-projecto" },
            { label: "Assistente manual", path: measurementDocs[0] ? `/documentos/${measurementDocs[0].id}?assistente=1` : undefined },
          ],
        });
      } else if (errored.length > 0 && completed.length > 0) {
        guidance.push({
          id: "planta_parcial",
          severity: "warning",
          title: "Leitura parcial das plantas",
          message: `${completed.length} ficheiro(s) OK, ${errored.length} com erro. Pode avançar com os compartimentos já extraídos e completar o resto manualmente ou reenviar os PDFs com falha.`,
          actions: [
            { label: "Confirmar compartimentos", path: completed[0] ? `/plantas/${completed[0].id}` : undefined },
            { label: "Corrigir erros", anchor: "plantas-do-projecto" },
          ],
        });
      }

      if (processing.length > 0) {
        guidance.push({
          id: "planta_em_processamento",
          severity: "info",
          title: "Análise em curso",
          message: `${processing.length} ficheiro(s) ainda a ser processado(s). Pode aguardar ou começar a medição manual em paralelo.`,
          actions: [{ label: "Ver progresso", anchor: "plantas-do-projecto" }],
        });
      }

      if (completed.length > 0) {
        let roomCount = 0;
        for (const p of completed) {
          const rooms = await db.select({ id: extractedRooms.id }).from(extractedRooms).where(eq(extractedRooms.plantId, p.id));
          roomCount += rooms.length;
        }
        if (roomCount === 0) {
          guidance.push({
            id: "planta_sem_compartimentos",
            severity: "warning",
            title: "Planta lida, mas sem compartimentos",
            message: "O PDF foi processado, mas não foram detectadas áreas de compartimentos (tabelas de áreas ou legendas). Introduza as áreas no Assistente ou na régua item a item.",
            actions: [
              { label: "Assistente de medições", path: measurementDocs[0] ? `/documentos/${measurementDocs[0].id}?assistente=1` : undefined },
              { label: "Rever planta", path: completed[0] ? `/plantas/${completed[0].id}` : undefined },
            ],
          });
        }
      }
    }
  }

  if (usesImport && measurementDocs.length > 0) {
    const emptyQty = await countLeafItemsWithoutQuantity(measurementDocs[0].id);
    if (emptyQty > 0) {
      guidance.push({
        id: "import_excel_pendente",
        severity: "warning",
        title: "Importação incompleta ou categorias diferentes",
        message: `${emptyQty} item(ns) ainda sem quantidade. Se o Excel usa secções/disciplinas com nomes diferentes do documento, renomeie a folha para coincidir com a secção do mapa ou crie os itens em falta manualmente.`,
        actions: [
          { label: "Importar Excel", path: `/documentos/${measurementDocs[0].id}` },
          { label: "Editar mapa", path: `/documentos/${measurementDocs[0].id}` },
        ],
      });
    }
  }

  if (!usesPlants && !usesImport && measurementDocs.length > 0) {
    const emptyQty = await countLeafItemsWithoutQuantity(measurementDocs[0].id);
    if (emptyQty > 5) {
      guidance.push({
        id: "medicoes_sem_assistente",
        severity: "info",
        title: "Medição manual em curso",
        message: "Use o Assistente de Medições para um ponto de partida rápido, ou preencha quantidades na régua de cada item.",
        actions: [{ label: "Abrir assistente", path: `/documentos/${measurementDocs[0].id}?assistente=1` }],
      });
    }
  }

  if (measurementDocs.length > 0) {
    const standardOk = await getStandardSectionId(measurementDocs[0].id);
    if (!standardOk) {
      guidance.push({
        id: "mapa_nao_padrao",
        severity: "info",
        title: "Mapa com estrutura personalizada",
        message: "O Assistente automático e a ligação «Da planta» funcionam melhor com o mapa padrão SIGO. Com capítulos próprios, use a régua ou importação Excel linha a linha.",
        actions: [{ label: "Ver documento", path: `/documentos/${measurementDocs[0].id}` }],
      });
    }
  }

  if (measurementDocs.length > 0) {
    const emptyQty = await countLeafItemsWithoutQuantity(measurementDocs[0].id);
    if (emptyQty === 0 && budgetDocs.length === 0) {
      guidance.push({
        id: "pronto_para_orcamento",
        severity: "info",
        title: "Medições completas — pronto para orçamento",
        message: "Todas as quantidades estão preenchidas. Envie para orçamento para aplicar composições e preços.",
        actions: [{ label: "Ir à medição", path: `/documentos/${measurementDocs[0].id}` }],
      });
    }
  }

  // Um aviso por tipo — não um cartão por cada orçamento (evita duplicados quando há 2+ mapas).
  const unpricedBudgets: Array<{ id: string; title: string; count: number }> = [];
  const reviewReadyBudgets: Array<{ id: string; title: string }> = [];
  let hasApprovedBudget = false;

  for (const doc of budgetDocs) {
    const withoutPrice = await countLeafItemsWithoutPrice(doc.id);
    if (withoutPrice > 0) {
      unpricedBudgets.push({ id: doc.id, title: doc.title, count: withoutPrice });
    } else if (doc.status !== "aprovado") {
      reviewReadyBudgets.push({ id: doc.id, title: doc.title });
    }
    if (doc.status === "aprovado") hasApprovedBudget = true;
  }

  if (unpricedBudgets.length > 0) {
    const totalItems = unpricedBudgets.reduce((sum, item) => sum + item.count, 0);
    const message =
      unpricedBudgets.length === 1
        ? `${unpricedBudgets[0].count} item(ns) em «${unpricedBudgets[0].title}» não têm composição nem preço unitário. Ligue cada item ao catálogo ou preencha manualmente antes de submeter.`
        : `${unpricedBudgets.length} orçamentos têm itens sem preço (${totalItems} no total). Ligue cada item ao catálogo ou preencha o preço antes de submeter.`;
    guidance.push({
      id: "orcamento_sem_preco",
      severity: "warning",
      title: unpricedBudgets.length === 1 ? "Orçamento com itens sem preço" : "Orçamentos com itens sem preço",
      message,
      actions: [
        ...unpricedBudgets.slice(0, 3).map((doc, index) => ({
          label: unpricedBudgets.length === 1 ? "Abrir orçamento" : `Abrir orçamento ${index + 1}`,
          path: `/documentos/${doc.id}?semPreco=1`,
        })),
        { label: "Catálogo", path: "/catalogo" },
      ],
    });
  }

  if (reviewReadyBudgets.length > 0) {
    guidance.push({
      id: "orcamento_nao_aprovado",
      severity: "info",
      title: reviewReadyBudgets.length === 1 ? "Orçamento pronto para revisão" : "Orçamentos prontos para revisão",
      message:
        reviewReadyBudgets.length === 1
          ? "Preços preenchidos. Aprove o orçamento para desbloquear certificados de obra e cronograma financeiro."
          : `${reviewReadyBudgets.length} orçamentos têm preços preenchidos e podem ser aprovados.`,
      actions: reviewReadyBudgets.slice(0, 3).map((doc, index) => ({
        label: reviewReadyBudgets.length === 1 ? "Rever orçamento" : `Rever orçamento ${index + 1}`,
        path: `/documentos/${doc.id}`,
      })),
    });
  }

  if (hasApprovedBudget) {
    guidance.push({
      id: "certificacao_disponivel",
      severity: "info",
      title: "Obra em execução — certificados disponíveis",
      message: "Com o orçamento aprovado, pode registar avanços físicos por período (certificados de obra). Isto alimenta o cronograma e o financeiro — é distinto das medições de projecto.",
      actions: [
        { label: "Certificados", anchor: "certificados-obra" },
        { label: "Cronograma", path: `/projectos/${projectId}/cronograma` },
      ],
    });
  }

  return {
    projectId,
    measurementMode: project.measurementMode,
    projectType: project.projectType,
    guidance,
  };
}
