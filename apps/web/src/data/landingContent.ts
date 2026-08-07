export type LandingPricingPlan = {
  name: string;
  price: number;
  period: string;
  description: string;
  features: string[];
  recommended?: boolean;
  cta: string;
};

export const features = [
  {
    icon: "Ruler",
    title: "Medições sobre plantas",
    description:
      "Levante quantidades directamente das plantas e mantenha a rastreabilidade até ao item do mapa.",
  },
  {
    icon: "FileSpreadsheet",
    title: "Orçamentos com composições",
    description:
      "Mapas de quantidades hierárquicos, composições de custo e detecção automática de itens sem preço.",
  },
  {
    icon: "GanttChartSquare",
    title: "Cronograma e WBS",
    description:
      "Planeie ao estilo MS Project, com precedências, caminho crítico e validação do plano.",
  },
  {
    icon: "Truck",
    title: "Compras e cotações",
    description:
      "Compare propostas no Portal SIGO Fornecedores, aceite cotações na Gestão da obra e execute as compras na obra.",
  },
  {
    icon: "ClipboardList",
    title: "Diário de obra",
    description:
      "Registo diário de mão-de-obra, equipamento, clima e ocorrências, com fotografia no telemóvel.",
  },
  {
    icon: "BadgeCheck",
    title: "Autos de medição",
    description:
      "Certificados mensais gerados a partir do executado real, prontos para fiscalização e facturação.",
  },
];

export const productTabs = [
  {
    id: "custos",
    label: "Custos",
    title: "Do mapa de quantidades ao custo real",
    description:
      "Cada item do orçamento liga-se à sua composição, ao preço da zona e ao custo efectivamente incorrido em obra.",
    bullets: [
      "Catálogo de preços por zona (Maputo, Beira, Nampula, Tete)",
      "Composições de mão-de-obra, material e equipamento",
      "Desvio orçamento vs. realizado por capítulo",
    ],
  },
  {
    id: "planeamento",
    label: "Planeamento",
    title: "Planeamento que a obra consegue cumprir",
    description:
      "WBS editável ligada ao Gantt, com precedências, baseline e alertas quando o plano deixa de ser executável.",
    bullets: [
      "Folha WBS e Gantt sincronizados",
      "Caminho crítico e folgas calculados",
      "Validação de recursos sobrealocados",
    ],
  },
  {
    id: "execucao",
    label: "Execução",
    title: "O que aconteceu hoje no estaleiro",
    description:
      "Diário de obra no telemóvel, medições de campo e autos gerados sem folhas de cálculo paralelas.",
    bullets: [
      "Diário com fotografias e ocorrências",
      "Medições de campo aprovadas por fiscalização",
      "Autos mensais com histórico de aprovações",
    ],
  },
];

export const roles = [
  {
    icon: "HardHat",
    role: "Construtora",
    description:
      "Controle margens por capítulo, antecipe compras e feche autos sem retrabalho no fim do mês.",
    points: ["Custo real por frente", "Cotações na Gestão da obra", "Pedidos de compra ligados ao mapa"],
  },
  {
    icon: "ClipboardCheck",
    role: "Fiscalização",
    description:
      "Verifique quantidades medidas contra o executado, com evidência fotográfica e histórico completo.",
    points: ["Aprovação de medições", "Registo de não conformidades", "Pista de auditoria"],
  },
  {
    icon: "Landmark",
    role: "Dono da obra",
    description:
      "Acompanhe prazo, valor certificado e risco financeiro da empreitada num único painel.",
    points: ["Curva de facturação", "Desvio de prazo", "Relatórios mensais em PDF"],
  },
];

export const faqs = [
  {
    q: "O SIGO funciona com fraca ligação à internet no estaleiro?",
    a: "Sim. O diário de obra e as medições de campo funcionam offline no telemóvel e sincronizam automaticamente quando a ligação regressa.",
  },
  {
    q: "Posso trabalhar em MZN e USD na mesma obra?",
    a: "Pode. Define a moeda base da obra e o SIGO converte compras e propostas em USD à taxa de câmbio registada na data do documento.",
  },
  {
    q: "Os autos de medição seguem o formato exigido pela fiscalização?",
    a: "Os autos são gerados a partir do mapa de quantidades aprovado, com quantidades anteriores, do período e acumuladas, prontos a assinar.",
  },
  {
    q: "Como funciona o catálogo de preços por zona?",
    a: "Mantém um catálogo central de artigos e composições, com factores de preço por zona do país, de forma a orçamentar Beira ou Tete com custos realistas.",
  },
  {
    q: "É possível importar mapas de quantidades existentes em Excel?",
    a: "Sim, importa ficheiros Excel com estrutura de capítulos e itens. O SIGO identifica os itens sem preço e sugere correspondência com o catálogo.",
  },
];
