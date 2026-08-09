import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  projects,
  plants,
  extractedRooms,
  budgetDocuments,
  budgetSections,
  lineItems,
  scheduleTasks,
  siteDiaryEntries,
  purchaseRequisitions,
} from "../db/schema.js";
import { buildProjectWorkflowControl, type ProjectWorkflowControl } from "./projectWorkflowControl.js";

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
  | "certificacao_disponivel";

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
  control: ProjectWorkflowControl;
  guidance: WorkflowGuidanceItem[];
};

async function countLeafItemsWithoutPrice(documentId: string): Promise<number> {
  const rows = await db
    .select({ quantity: lineItems.quantity, unitPrice: lineItems.unitPrice, compositionId: lineItems.compositionId })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(and(eq(budgetSections.documentId, documentId), eq(lineItems.kind, "item")));
  // Linhas opcionais a zero não entram na proposta. Itens já ligados a composição
  // resolvem o preço pelo catálogo — não contam como «sem preço».
  return rows.filter((row) =>
    Number(row.quantity ?? 0) > 0
    && !row.compositionId
    && Number(row.unitPrice ?? 0) <= 0
  ).length;
}

async function countMeasuredLeafItems(documentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lineItems)
    .innerJoin(budgetSections, eq(lineItems.sectionId, budgetSections.id))
    .where(and(
      eq(budgetSections.documentId, documentId),
      eq(lineItems.kind, "item"),
      sql`${lineItems.quantity} > 0`,
    ));
  return row?.count ?? 0;
}

export async function getProjectWorkflowStatus(projectId: string): Promise<ProjectWorkflowStatus | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const guidance: WorkflowGuidanceItem[] = [];
  const [plantRows, docs, scheduleRows, diaryRows, requisitionRows] = await Promise.all([
    db.select().from(plants).where(eq(plants.projectId, projectId)),
    db.select().from(budgetDocuments).where(eq(budgetDocuments.projectId, projectId)),
    db.select({ id: scheduleTasks.id }).from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId)),
    db.select({ id: siteDiaryEntries.id }).from(siteDiaryEntries).where(eq(siteDiaryEntries.projectId, projectId)),
    db.select({ id: purchaseRequisitions.id }).from(purchaseRequisitions).where(eq(purchaseRequisitions.projectId, projectId)),
  ]);
  const measurementDocs = docs.filter((d) => d.documentType === "medicao");
  const budgetDocs = docs.filter((d) => d.documentType === "orcamento");
  const primaryMeasurement = measurementDocs
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const measuredItemCount = primaryMeasurement ? await countMeasuredLeafItems(primaryMeasurement.id) : 0;
  const measurementReady = Boolean(primaryMeasurement && measuredItemCount > 0 && primaryMeasurement.status === "aprovado");

  const usesPlants = project.measurementMode === "plantas";
  const usesImport = project.measurementMode === "importar";

  if (!project.zoneId && budgetDocs.length === 0) {
    guidance.push({
      id: "preparar_obra",
      severity: "warning",
      title: "Prepare a obra antes de medir e orçamentar",
      message: "Defina a zona. O SIGO aplicará os preços e composições disponíveis ao orçamento.",
      actions: [
        { label: "Preparar obra", anchor: "preparar-obra" },
        { label: "Catálogo", path: "/catalogo" },
        { label: "Cotações", path: "/gestao/cotacoes" },
      ],
    });
  }

  if (usesPlants) {
    if (plantRows.length === 0) {
      guidance.push({
        id: "sem_plantas",
        severity: "info",
        title: "Carregue os desenhos",
        message: "O SIGO identifica disciplinas, pisos e elementos antes de preparar a medição.",
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
          message: `${processing.length} ficheiro(s) em análise. Pode sair desta página; o processamento continua em segundo plano.`,
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
    if (measuredItemCount === 0) {
      guidance.push({
        id: "import_excel_pendente",
        severity: "warning",
        title: "Importação sem quantidades",
        message: "Nenhuma linha medida foi reconhecida. Reveja apenas as correspondências assinaladas.",
        actions: [
          { label: "Importar Excel", path: `/documentos/${measurementDocs[0].id}` },
          { label: "Editar mapa", path: `/documentos/${measurementDocs[0].id}` },
        ],
      });
    }
  }

  if (!usesPlants && !usesImport && measurementDocs.length > 0) {
    if (measuredItemCount === 0) {
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
    if (measurementReady && budgetDocs.length === 0) {
      guidance.push({
        id: "pronto_para_orcamento",
        severity: "info",
        title: "Medição aprovada",
        message: "Crie o orçamento; quantidades, estrutura e ligações serão transportadas automaticamente.",
        actions: [{ label: "Criar orçamento", path: `/documentos/${primaryMeasurement!.id}` }],
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

  const completedPlants = plantRows.filter((plant) => plant.processingStatus === "concluido").length;
  const processingPlants = plantRows.filter((plant) => ["pendente", "processando"].includes(plant.processingStatus)).length;
  const allPlantsFailed = plantRows.length > 0 && plantRows.every((plant) => plant.processingStatus === "erro");
  const sourceReady = usesPlants
    ? completedPlants > 0
    : usesImport
      ? measuredItemCount > 0
      : primaryMeasurement !== null;
  const sourceStatus: "concluido" | "actual" | "pendente" | "bloqueado" = sourceReady
    ? "concluido"
    : allPlantsFailed
      ? "bloqueado"
      : processingPlants > 0
        ? "actual"
        : "pendente";
  const rawChecks: ProjectWorkflowControl["checks"] = [
    { id: "dados", label: "Obra configurada", status: project.zoneId ? "concluido" : "pendente" },
    { id: "fonte", label: usesPlants ? "Desenhos analisados" : usesImport ? "Mapa importado" : "Medição aberta", status: sourceStatus },
    { id: "medicao", label: "Medição aprovada", status: measurementReady ? "concluido" : measuredItemCount > 0 ? "actual" : "pendente" },
    { id: "orcamento", label: "Orçamento aprovado", status: hasApprovedBudget ? "concluido" : budgetDocs.length > 0 ? "actual" : "pendente" },
    { id: "planeamento", label: "Cronograma gerado", status: scheduleRows.length > 0 ? "concluido" : "pendente" },
    { id: "execucao", label: "Execução ligada", status: diaryRows.length > 0 || requisitionRows.length > 0 ? "concluido" : "pendente" },
  ];
  const control = buildProjectWorkflowControl(rawChecks, guidance.map((item) => item.severity));

  return {
    projectId,
    measurementMode: project.measurementMode,
    projectType: project.projectType,
    control,
    guidance,
  };
}
