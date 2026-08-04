/** Templates Comercial Avançado — conforme PDF «Comercial Avançado SIGO». */

export type ServiceCategory = "project" | "technical" | "construction";

export type ServiceTypeDef = {
  id: string;
  category: ServiceCategory;
  label: string;
  suggestedTitle: string;
  intro: string;
  pricingModes: string[];
};

export type TemplateLine = {
  phase: string;
  specialty?: string;
  description: string;
  unit?: string;
  optional?: boolean;
};

export type ProposalTemplate = {
  serviceType: string;
  lines: TemplateLine[];
};

export const SERVICE_TYPES: ServiceTypeDef[] = [
  { id: "arquitectura", category: "project", label: "Projecto de Arquitectura", suggestedTitle: "Proposta de Prestação de Serviços de Arquitectura", intro: "Apresentamos a presente proposta para o desenvolvimento dos serviços de arquitectura referentes ao projecto identificado neste documento. Os trabalhos serão desenvolvidos de acordo com o âmbito, fases, entregáveis e condições comerciais apresentados abaixo.", pricingModes: ["por_fase", "global", "percentagem"] },
  { id: "estrutural", category: "project", label: "Projecto Estrutural", suggestedTitle: "Proposta de Prestação de Serviços de Engenharia Estrutural", intro: "Os serviços compreendem a concepção, análise, dimensionamento e documentação da solução estrutural do empreendimento, tendo como referência o projecto arquitectónico e as informações técnicas disponibilizadas pelo cliente.", pricingModes: ["por_fase", "global"] },
  { id: "hidrossanitario", category: "project", label: "Projecto Hidrossanitário", suggestedTitle: "Proposta de Projecto Hidrossanitário", intro: "Proposta para o desenvolvimento do projecto hidrossanitário do empreendimento, incluindo redes, dimensionamento e peças desenhadas/escritas.", pricingModes: ["por_fase", "global"] },
  { id: "electrico", category: "project", label: "Projecto Eléctrico", suggestedTitle: "Proposta de Projecto Eléctrico", intro: "Proposta para o projecto das instalações eléctricas, incluindo definição de pontos, circuitos, dimensionamento e documentação.", pricingModes: ["por_fase", "global"] },
  { id: "avac", category: "project", label: "Projecto de AVAC / Climatização", suggestedTitle: "Proposta de Projecto de AVAC / Climatização", intro: "Proposta para concepção e documentação do sistema de AVAC/climatização do empreendimento.", pricingModes: ["por_fase", "global"] },
  { id: "sci", category: "project", label: "Projecto de Segurança Contra Incêndios", suggestedTitle: "Proposta de Projecto de SCI", intro: "Proposta para o projecto de segurança contra incêndios conforme o âmbito indicado.", pricingModes: ["por_fase", "global"] },
  { id: "telecom", category: "project", label: "Projecto de Telecomunicações / IT", suggestedTitle: "Proposta de Projecto de Telecomunicações / IT", intro: "Proposta para o projecto de telecomunicações e infraestruturas IT.", pricingModes: ["por_fase", "global"] },
  { id: "drenagem", category: "project", label: "Projecto de Drenagem", suggestedTitle: "Proposta de Projecto de Drenagem", intro: "Proposta para o projecto de drenagem do empreendimento.", pricingModes: ["por_fase", "global"] },
  { id: "arranjos", category: "project", label: "Projecto de Arranjos Exteriores", suggestedTitle: "Proposta de Projecto de Arranjos Exteriores", intro: "Proposta para o projecto de arranjos exteriores.", pricingModes: ["por_fase", "global"] },
  { id: "especialidade_custom", category: "project", label: "Projecto de Especialidade personalizado", suggestedTitle: "Proposta de Projecto de Especialidade", intro: "Proposta para o desenvolvimento da especialidade indicada neste documento.", pricingModes: ["por_fase", "global", "personalizado"] },
  { id: "completo", category: "project", label: "Projecto Completo (Arquitectura + Especialidades)", suggestedTitle: "Proposta de Projecto Completo — Arquitectura e Especialidades", intro: "Proposta única para o desenvolvimento do projecto completo, incluindo arquitectura e especialidades seleccionadas, com coordenação e compatibilização.", pricingModes: ["por_especialidade", "por_fase", "global"] },
  { id: "estudo_preliminar", category: "project", label: "Projecto Base / Estudo Preliminar", suggestedTitle: "Proposta de Estudo Preliminar / Projecto Base", intro: "Proposta para o desenvolvimento do estudo preliminar / projecto base.", pricingModes: ["global", "por_fase"] },
  { id: "compatibilizacao", category: "project", label: "Compatibilização de Projectos", suggestedTitle: "Proposta de Compatibilização de Projectos", intro: "Proposta para serviços de coordenação e compatibilização entre especialidades.", pricingModes: ["global", "por_hora", "por_mes"] },
  { id: "fiscalizacao", category: "technical", label: "Fiscalização de Obra", suggestedTitle: "Proposta de Serviços de Fiscalização de Obra", intro: "Proposta para prestação de serviços de fiscalização de obra, distintos da execução dos trabalhos.", pricingModes: ["por_mes", "por_visita", "global", "por_fase"] },
  { id: "gestao_projecto", category: "technical", label: "Gestão / Coordenação de Projecto", suggestedTitle: "Proposta de Gestão / Coordenação de Projecto", intro: "Proposta para serviços de gestão e coordenação de projecto.", pricingModes: ["por_mes", "global", "por_hora"] },
  { id: "assistencia", category: "technical", label: "Assistência Técnica", suggestedTitle: "Proposta de Assistência Técnica", intro: "Proposta para serviços de assistência técnica.", pricingModes: ["por_hora", "por_visita", "por_dia", "global"] },
  { id: "consultoria", category: "technical", label: "Consultoria Técnica", suggestedTitle: "Proposta de Consultoria Técnica", intro: "Proposta para serviços de consultoria técnica profissional.", pricingModes: ["por_hora", "por_dia", "por_visita", "por_mes", "global"] },
  { id: "levantamento_arq", category: "technical", label: "Levantamento Arquitectónico", suggestedTitle: "Proposta de Levantamento Arquitectónico", intro: "Proposta para levantamento arquitectónico do local/edifício.", pricingModes: ["global", "por_visita"] },
  { id: "levantamento_tec", category: "technical", label: "Levantamento Técnico", suggestedTitle: "Proposta de Levantamento Técnico", intro: "Proposta para levantamento técnico.", pricingModes: ["global", "por_visita"] },
  { id: "avaliacao", category: "technical", label: "Avaliação / Diagnóstico Técnico", suggestedTitle: "Proposta de Avaliação / Diagnóstico Técnico", intro: "Proposta para avaliação ou diagnóstico técnico.", pricingModes: ["global", "por_hora"] },
  { id: "revisao_projecto", category: "technical", label: "Revisão de Projecto", suggestedTitle: "Proposta de Revisão de Projecto", intro: "Proposta para revisão técnica de projecto.", pricingModes: ["global", "por_hora"] },
  { id: "documentacao", category: "technical", label: "Preparação de Documentação Técnica", suggestedTitle: "Proposta de Preparação de Documentação Técnica", intro: "Proposta para preparação de documentação técnica.", pricingModes: ["global", "por_hora"] },
  { id: "outro_servico", category: "technical", label: "Outro serviço personalizado", suggestedTitle: "Proposta de Prestação de Serviços", intro: "Proposta para os serviços técnicos descritos neste documento.", pricingModes: ["personalizado", "global", "por_hora"] },
  { id: "execucao_obra", category: "construction", label: "Execução de Obra", suggestedTitle: "Proposta Comercial de Execução de Obra", intro: "Proposta comercial de execução com base na medição e orçamento técnicos associados.", pricingModes: ["global"] },
];

export const COMMERCIAL_TEXT_LIBRARY = {
  prazo: "O prazo de execução dos serviços será contado a partir da confirmação da adjudicação, disponibilização das informações necessárias e cumprimento das condições iniciais estabelecidas na presente proposta.",
  validade: "A presente proposta é válida pelo período indicado no documento, contado a partir da data da sua emissão.",
  alteracoes: "Alterações relevantes ao programa, âmbito ou solução previamente aprovada poderão implicar revisão dos honorários e do prazo inicialmente estabelecido.",
  informacoesCliente: "O cliente deverá disponibilizar atempadamente as informações, documentos e decisões necessárias ao desenvolvimento dos trabalhos.",
  servicosAdicionais: "Trabalhos não contemplados no âmbito desta proposta poderão ser objecto de orçamento complementar, mediante aprovação prévia do cliente.",
  revisoes: "A proposta contempla as revisões indicadas no âmbito contratado. Revisões adicionais ou alterações substanciais após aprovação de uma fase poderão ser consideradas serviços adicionais.",
  pagamentos: "Os pagamentos deverão ser realizados de acordo com o plano de parcelas definido na presente proposta e respectivo contrato.",
  inicio: "O início dos serviços fica condicionado à adjudicação da proposta e ao cumprimento das condições comerciais acordadas.",
  aceitacao: "A aceitação da presente proposta implica a concordância com o âmbito, honorários e condições comerciais aqui descritos.",
};

function lines(items: Array<[string, string] | [string, string, Partial<TemplateLine>]>): TemplateLine[] {
  return items.map(([phase, description, extra]) => ({
    phase,
    description,
    unit: "vb",
    ...extra,
  }));
}

const TEMPLATES: Record<string, TemplateLine[]> = {
  arquitectura: lines([
    ["Levantamento", "Levantamento e análise inicial"],
    ["Levantamento", "Reunião de levantamento de necessidades"],
    ["Levantamento", "Análise do programa do cliente"],
    ["Levantamento", "Análise das informações disponibilizadas"],
    ["Levantamento", "Análise do terreno / implantação, quando aplicável"],
    ["Estudo preliminar", "Desenvolvimento do conceito arquitectónico"],
    ["Estudo preliminar", "Organização funcional dos espaços"],
    ["Estudo preliminar", "Planta preliminar"],
    ["Estudo preliminar", "Proposta de implantação"],
    ["Estudo preliminar", "Estudos volumétricos"],
    ["Estudo preliminar", "Apresentação para apreciação do cliente"],
    ["Anteprojecto", "Plantas arquitectónicas"],
    ["Anteprojecto", "Cortes"],
    ["Anteprojecto", "Alçados"],
    ["Anteprojecto", "Planta de cobertura"],
    ["Anteprojecto", "Quadro de áreas"],
    ["Anteprojecto", "Ajustes decorrentes da aprovação do estudo preliminar"],
    ["Projecto", "Plantas finais"],
    ["Projecto", "Cortes finais"],
    ["Projecto", "Alçados finais"],
    ["Projecto", "Pormenores arquitectónicos aplicáveis"],
    ["Projecto", "Mapas e quadros necessários"],
    ["Projecto", "Peças desenhadas"],
    ["Projecto", "Peças escritas aplicáveis"],
    ["Entrega", "Documentação digital"],
    ["Entrega", "Pranchas finais / ficheiros PDF"],
    ["Opcional", "Modelação 3D", { optional: true }],
    ["Opcional", "Renderização / imagens fotorrealistas", { optional: true }],
    ["Opcional", "Processo de licenciamento", { optional: true }],
    ["Opcional", "Assistência técnica durante a obra", { optional: true }],
  ]),
  estrutural: lines([
    ["Análise", "Análise do projecto arquitectónico"],
    ["Concepção", "Definição do sistema estrutural"],
    ["Concepção", "Pré-dimensionamento"],
    ["Cálculo", "Modelação estrutural"],
    ["Cálculo", "Cálculo estrutural"],
    ["Dimensionamento", "Dimensionamento de fundações"],
    ["Dimensionamento", "Dimensionamento de pilares, vigas, lajes e escadas"],
    ["Documentação", "Plantas estruturais e de fundações"],
    ["Documentação", "Plantas de formas e pormenorização de armaduras"],
    ["Documentação", "Memória de cálculo"],
    ["Compatibilização", "Compatibilização com arquitectura e outras especialidades"],
  ]),
  hidrossanitario: lines([
    ["Análise", "Análise da arquitectura"],
    ["Concepção", "Definição da solução hidráulica"],
    ["Redes", "Rede de abastecimento de água"],
    ["Redes", "Rede de águas residuais e ventilação"],
    ["Redes", "Rede de águas pluviais, quando aplicável"],
    ["Dimensionamento", "Dimensionamento das redes e localização de equipamentos"],
    ["Documentação", "Plantas, diagramas e pormenores"],
    ["Documentação", "Memória descritiva e especificações"],
    ["Compatibilização", "Compatibilização com arquitectura e estrutura"],
  ]),
  electrico: lines([
    ["Levantamento", "Levantamento das necessidades"],
    ["Concepção", "Definição dos pontos eléctricos, iluminação e tomadas"],
    ["Dimensionamento", "Quadros, circuitos e dimensionamento de cargas"],
    ["Documentação", "Diagrama unifilar e sistema de aterramento"],
    ["Documentação", "Plantas eléctricas e quadros de cargas"],
    ["Documentação", "Especificações"],
    ["Compatibilização", "Compatibilização com outras especialidades"],
  ]),
  completo: [
    { phase: "Arquitectura", specialty: "Arquitectura", description: "Honorários — Arquitectura", unit: "vb" },
    { phase: "Estruturas", specialty: "Estruturas", description: "Honorários — Projecto estrutural", unit: "vb" },
    { phase: "Hidrossanitário", specialty: "Hidrossanitário", description: "Honorários — Projecto hidrossanitário", unit: "vb" },
    { phase: "Electricidade", specialty: "Electricidade", description: "Honorários — Projecto eléctrico", unit: "vb" },
    { phase: "AVAC", specialty: "AVAC", description: "Honorários — AVAC / climatização", unit: "vb", optional: true },
    { phase: "SCI", specialty: "SCI", description: "Honorários — Segurança contra incêndios", unit: "vb", optional: true },
    { phase: "Telecom", specialty: "Telecom", description: "Honorários — Telecomunicações / IT", unit: "vb", optional: true },
    { phase: "Coordenação", specialty: "Coordenação", description: "Coordenação e compatibilização", unit: "vb" },
  ],
  fiscalizacao: lines([
    ["Acompanhamento", "Acompanhamento da execução dos trabalhos"],
    ["Verificação", "Verificação da conformidade com os projectos"],
    ["Verificação", "Verificação da qualidade dos trabalhos e materiais"],
    ["Planeamento", "Acompanhamento do planeamento"],
    ["Registos", "Registo de ocorrências e registo fotográfico"],
    ["Reuniões", "Reuniões de obra"],
    ["Relatórios", "Relatórios periódicos"],
    ["Medição", "Conferência de trabalhos executados"],
    ["Desvios", "Análise de desvios e recomendações técnicas"],
    ["Recepção", "Apoio na recepção dos trabalhos"],
  ]),
  consultoria: lines([
    ["Consultoria", "Consultoria técnica", { unit: "h" }],
    ["Visitas", "Visitas ao local", { unit: "visita" }],
    ["Entregável", "Relatório técnico", { unit: "un" }],
  ]),
  assistencia: lines([
    ["Assistência", "Assistência técnica", { unit: "h" }],
    ["Visitas", "Visitas técnicas", { unit: "visita" }],
  ]),
  gestao_projecto: lines([
    ["Coordenação", "Coordenação geral do projecto", { unit: "mês" }],
    ["Reuniões", "Reuniões de coordenação"],
    ["Compatibilização", "Gestão de interfaces entre especialidades"],
  ]),
};

TEMPLATES.avac = lines([
  ["Concepção", "Definição da solução de AVAC / climatização"],
  ["Dimensionamento", "Dimensionamento e selecção de equipamentos"],
  ["Documentação", "Plantas, esquemas e especificações"],
  ["Compatibilização", "Compatibilização com arquitectura e especialidades"],
]);
TEMPLATES.sci = lines([
  ["Análise", "Análise de riscos e requisitos de SCI"],
  ["Concepção", "Definição da solução de segurança contra incêndios"],
  ["Documentação", "Peças desenhadas e escritas de SCI"],
]);
TEMPLATES.telecom = lines([
  ["Concepção", "Definição da infraestrutura de telecomunicações / IT"],
  ["Documentação", "Plantas, diagramas e especificações"],
]);
TEMPLATES.drenagem = lines([
  ["Concepção", "Definição da solução de drenagem"],
  ["Dimensionamento", "Dimensionamento das redes"],
  ["Documentação", "Plantas e especificações"],
]);
TEMPLATES.arranjos = lines([
  ["Concepção", "Conceito de arranjos exteriores"],
  ["Projecto", "Peças desenhadas de arranjos exteriores"],
]);
TEMPLATES.estudo_preliminar = TEMPLATES.arquitectura.filter((l) =>
  ["Levantamento", "Estudo preliminar"].includes(l.phase),
);
TEMPLATES.compatibilizacao = lines([
  ["Compatibilização", "Análise de conflitos entre especialidades"],
  ["Compatibilização", "Reuniões de coordenação"],
  ["Compatibilização", "Relatório de compatibilização"],
]);
TEMPLATES.especialidade_custom = lines([["Especialidade", "Serviços da especialidade (definir)"]]);
TEMPLATES.levantamento_arq = lines([["Levantamento", "Levantamento arquitectónico do local"]]);
TEMPLATES.levantamento_tec = lines([["Levantamento", "Levantamento técnico"]]);
TEMPLATES.avaliacao = lines([["Diagnóstico", "Avaliação / diagnóstico técnico e relatório"]]);
TEMPLATES.revisao_projecto = lines([["Revisão", "Revisão técnica de projecto"]]);
TEMPLATES.documentacao = lines([["Documentação", "Preparação de documentação técnica"]]);
TEMPLATES.outro_servico = lines([["Serviços", "Serviços técnicos (definir)"]]);
TEMPLATES.execucao_obra = []; // preenchido a partir da medição/orçamento

export function getServiceType(id: string) {
  return SERVICE_TYPES.find((s) => s.id === id) ?? null;
}

export function getTemplateLines(serviceType: string): TemplateLine[] {
  return (TEMPLATES[serviceType] ?? []).map((line) => ({ ...line }));
}

export function defaultConditions(serviceType: string) {
  const def = getServiceType(serviceType);
  return {
    intro: def?.intro ?? "",
    validityText: COMMERCIAL_TEXT_LIBRARY.validade,
    deadlineText: COMMERCIAL_TEXT_LIBRARY.prazo,
    paymentTerms: COMMERCIAL_TEXT_LIBRARY.pagamentos,
    exclusions: COMMERCIAL_TEXT_LIBRARY.servicosAdicionais,
    revisionsIncluded: 2,
    additionalNotes: [COMMERCIAL_TEXT_LIBRARY.alteracoes, COMMERCIAL_TEXT_LIBRARY.informacoesCliente, COMMERCIAL_TEXT_LIBRARY.revisoes, COMMERCIAL_TEXT_LIBRARY.inicio].join("\n\n"),
    acceptanceText: COMMERCIAL_TEXT_LIBRARY.aceitacao,
  };
}

export const PRICING_MODE_LABELS: Record<string, string> = {
  global: "Preço global",
  por_fase: "Por fase",
  por_especialidade: "Por especialidade",
  por_mes: "Por mês",
  por_visita: "Por visita",
  por_hora: "Por hora",
  por_dia: "Por dia",
  percentagem: "Percentagem",
  personalizado: "Personalizado",
};
