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
      "No Profissional+, o SIGO sugere os melhores preços na região da obra, prepara o PDF do pedido com contactos e liga as cotações às compras.",
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
    points: [
      "Custo real por frente",
      "Cotações Profissional+ com fornecedores na zona",
      "Pedidos de compra ligados ao mapa",
    ],
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

/** Secção dedicada a SIGO Fornecedores — portal gratuito para fornecedores; mercado Profissional+ para obras. */
export const suppliersSection = {
  eyebrow: "SIGO Fornecedores",
  title: "Fornecedores reais, na região da sua obra",
  lead:
    "O catálogo SIGO Preços serve de referência em qualquer plano. A partir do Profissional, a obra fala directamente com fornecedores da zona: preços reais, contactos e um PDF do pedido ordenado do melhor custo ao mais caro.",
  forBuilders: {
    title: "Para a construtora (Profissional+)",
    points: [
      "Quando cria uma cotação, o SIGO identifica quem tem o material na região da obra",
      "Sugere os melhores preços tendo em conta a zona e a proximidade",
      "Gera um PDF com lista de materiais, fornecedores e contactos — do mais barato ao mais caro",
      "Comunicação directa no pedido; as respostas entram em Gestão da obra → Cotações",
    ],
  },
  forSuppliers: {
    title: "Para o fornecedor (portal gratuito)",
    points: [
      "Conta no Portal SIGO Fornecedores sem custo de plano SIGO",
      "Publica preços por zona e recebe pedidos de cotação das obras",
      "Responde com preços e notas; a construtora aceita na Gestão da obra",
      "Visibilidade junto de obras que trabalham em Profissional ou superior",
    ],
  },
};

export const faqs = [
  {
    q: "O SIGO funciona com fraca ligação à internet no estaleiro?",
    a: "A aplicação pode ser instalada no telemóvel, mas o envio e a consulta de dados da obra ainda precisam de ligação à internet. O modo offline completo está em desenvolvimento.",
  },
  {
    q: "Como funcionam os fornecedores nos planos?",
    a: "No Individual (e no período de avaliação) usa SIGO Preços de referência, editáveis por si. A partir do Profissional, activa o SIGO Fornecedores: preços reais por zona, contacto directo, e ao pedir cotação o sistema monta a lista de fornecedores com o material — com PDF ordenado do melhor preço ao mais caro. O Portal do Fornecedor em si é gratuito para quem vende.",
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
    a: "Mantém um catálogo central de artigos e composições, com factores de preço por zona do país, de forma a orçamentar Beira ou Tete com custos realistas. No Profissional+, as cotações de fornecedores reais reforçam esses preços na região da obra.",
  },
  {
    q: "É possível importar mapas de quantidades existentes em Excel?",
    a: "Sim, importa ficheiros Excel com estrutura de capítulos e itens. O SIGO identifica os itens sem preço e sugere correspondência com o catálogo.",
  },
];
