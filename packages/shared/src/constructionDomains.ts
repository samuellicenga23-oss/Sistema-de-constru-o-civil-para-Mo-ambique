/**
 * Léxico de construção civil (PT-MZ / PT) por domínio semântico.
 * Usado para impedir matches absurdo (pintura→cobertura, muro→sanita, etc.)
 * quando códigos de mapas de clientes colidem com o catálogo SIGO.
 *
 * Não é um dicionário exaustivo de 1000 entradas soltas — é um índice por domínio
 * com sinónimos e variantes ortográficas frequentes em mapas de quantidades.
 */

export const CONSTRUCTION_DOMAINS = [
  "pintura",
  "cobertura",
  "alvenaria",
  "betão",
  "metal",
  "sanitario",
  "agua",
  "esgoto",
  "electrica",
  "caixilharia",
  "pavimento",
  "impermeabilizacao",
  "mov_terras",
  "preliminares",
  "ligacao_utilidade",
] as const;

export type ConstructionDomain = (typeof CONSTRUCTION_DOMAINS)[number];

/** Termos / padrões por domínio (texto já normalizado: minúsculas, sem acentos). */
export const DOMAIN_LEXICON: Record<ConstructionDomain, RegExp[]> = {
  pintura: [
    /\bpintura\b/,
    /\bpintar\b/,
    /\btinta\b/,
    /\besmalte\b/,
    /\bacril(ica|ico)?\b/,
    /\bprimario\b/,
    /\bverniz\b/,
    /\bdemao\b/,
    /\bdemaos\b/,
    /\bcinacryl\b/,
    /\bsintecin\b/,
    /\banti\s*ferrug/,
    /\banti\s*corros/,
    /\bmassa\s+corrida\b/,
    /\blixagem\b/,
  ],
  cobertura: [
    /\bcobertura\b/,
    /\btelha\b/,
    /\bcumeeira\b/,
    /\brufos?\b/,
    /\bcalha\b/,
    /\bchapa\s+(ondul|perfil|metal|galvan)/,
    /\bluzalite\b/,
    /\bfibrocimento\b/,
    /\bviga(mento)?\s+de\s+cobertura\b/,
  ],
  alvenaria: [
    /\balvenaria\b/,
    /\bbloco\b/,
    /\btijolo\b/,
    /\bmuro\b/,
    /\bmurro\b/, // typo frequente
    /\bvedacao\b/,
    /\bvedaçao\b/,
    /\bcerca\b/,
    /\bmurete\b/,
    /\bparede\b/,
    /\bportao\b/,
    /\bgrade\b/,
  ],
  betão: [
    /\bbetao\b/,
    /\bbetão\b/,
    /\bb15\b/,
    /\bb20\b/,
    /\bb25\b/,
    /\bb30\b/,
    /\bviga\b/,
    /\bpilar\b/,
    /\bsapata\b/,
    /\blaje\b/,
    /\bcofrag/,
    /\barmacao\b/,
    /\barmadura\b/,
    /\bvarao\b/,
  ],
  metal: [
    /\bestrutura\s+metal/,
    /\btrelic/,
    /\btorre\b/,
    /\bcantoneira\b/,
    /\bgalvaniz/,
    /\bserralh/,
    /\bsoldadur/,
    /\bperfil\s+(ipn|upe|hea|ipe)/,
  ],
  sanitario: [
    /\bsanita\b/,
    /\bautoclismo\b/,
    /\blavatorio\b/,
    /\bbide\b/,
    /\bbainha\b/,
    /\bduche\b/,
    /\burinol\b/,
    /\bwc\b/,
    /\bcasa\s+de\s+banho\b/,
    /\btorneira\b/,
    /\bsifao\b/,
  ],
  agua: [
    /\bagua\b/,
    /\bppr\b/,
    /\bredes?\s+de\s+agua\b/,
    /\btubo.*(agua|ppr)/,
    /\breservatorio\b/,
    /\bbomba\s+de\s+agua\b/,
    /\bramal\s+de\s+agua\b/,
  ],
  esgoto: [
    /\besgoto\b/,
    /\bfossa\b/,
    /\bseptica\b/,
    /\binfiltrac/,
    /\bvala\b/,
    /\bpead\b/,
    /\bupvc\b/,
    /\bsaneamento\b/,
    /\bdrenagem\b/,
  ],
  electrica: [
    /\belectric/,
    /\beletric/,
    /\bcabo\b/,
    /\btomada\b/,
    /\binterruptor\b/,
    /\bluminar/,
    /\bquadro\b/,
    /\bdisjuntor\b/,
    /\beletroduto\b/,
    /\bcorrente\b/,
    /\benergia\b/,
    /\biluminacao\b/,
  ],
  caixilharia: [
    /\bjanela\b/,
    /\bporta\b/,
    /\bcaixilh/,
    /\baluminio\b/,
    /\bpvc\b/,
    /\bvidro\b/,
    /\bvidraceiro\b/,
  ],
  pavimento: [
    /\bpavimento\b/,
    /\bmosaico\b/,
    /\bazulej/,
    /\bporcelanato\b/,
    /\btijoleira\b/,
    /\brodape\b/,
    /\bbetonilha\b/,
  ],
  impermeabilizacao: [
    /\bimpermeabil/,
    /\btela\s+asfalt/,
    /\btela\s+betumin/,
    /\bmanta\s+liquid/,
  ],
  mov_terras: [
    /\bescavacao\b/,
    /\baterro\b/,
    /\breaterro\b/,
    /\bcompactac/,
    /\bterraplen/,
    /\benrocamento\b/,
  ],
  preliminares: [
    /\bestaleiro\b/,
    /\bimplantacao\b/,
    /\bcangalho\b/,
    /\bcerco\s+de\s+obra\b/,
    /\banti-?termit/,
  ],
  ligacao_utilidade: [
    /\bligacao\b/,
    /\bramal\b/,
    /\bcontrato\s+de\s+ligacao\b/,
    /\bpagamento\s+do\s+contrato\b/,
    /\badmissao\b/,
    /\badesao\b/,
  ],
};

/** Pares de domínios que nunca devem partilhar composição por fuzzy/código. */
const INCOMPATIBLE_PAIRS: Array<[ConstructionDomain, ConstructionDomain]> = [
  ["electrica", "esgoto"],
  ["electrica", "sanitario"],
  ["agua", "esgoto"],
  ["ligacao_utilidade", "esgoto"],
  ["ligacao_utilidade", "sanitario"],
  ["ligacao_utilidade", "alvenaria"],
  ["metal", "betão"],
  ["metal", "sanitario"],
  ["cobertura", "sanitario"],
  ["cobertura", "electrica"],
  ["caixilharia", "esgoto"],
  ["caixilharia", "sanitario"],
  ["alvenaria", "sanitario"],
  ["alvenaria", "esgoto"],
  ["alvenaria", "cobertura"],
  ["pintura", "cobertura"],
  ["pintura", "sanitario"],
  ["pintura", "esgoto"],
  ["pintura", "betão"],
];

function n(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

export function detectConstructionDomains(text: string): ConstructionDomain[] {
  const d = n(text);
  if (!d) return [];
  const found: ConstructionDomain[] = [];
  for (const domain of CONSTRUCTION_DOMAINS) {
    if (DOMAIN_LEXICON[domain].some((re) => re.test(d))) found.push(domain);
  }
  return found;
}

export function primaryConstructionDomain(text: string): ConstructionDomain | null {
  const domains = detectConstructionDomains(text);
  // Prioridade: ligação utilidade e pintura/cobertura antes de termos genéricos (parede, etc.)
  const priority: ConstructionDomain[] = [
    "ligacao_utilidade",
    "pintura",
    "cobertura",
    "electrica",
    "esgoto",
    "sanitario",
    "agua",
    "metal",
    "betão",
    "alvenaria",
    "caixilharia",
    "pavimento",
    "impermeabilizacao",
    "mov_terras",
    "preliminares",
  ];
  for (const p of priority) {
    if (domains.includes(p)) return p;
  }
  return domains[0] ?? null;
}

function pairIncompatible(a: ConstructionDomain, b: ConstructionDomain): boolean {
  if (a === b) return false;
  // electrica vs esgoto especial (fossa)
  if ((a === "electrica" && b === "esgoto") || (a === "esgoto" && b === "electrica")) return true;
  return INCOMPATIBLE_PAIRS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

/**
 * True se a descrição do mapa e o alvo (descrição/composição do catálogo)
 * pertencem a domínios incompatíveis — não confiar no código.
 */
export function constructionDomainsConflict(sourceDescription: string, targetText: string): boolean {
  const src = detectConstructionDomains(sourceDescription);
  const tgt = detectConstructionDomains(targetText);
  if (!src.length || !tgt.length) return false;
  for (const a of src) {
    for (const b of tgt) {
      if (pairIncompatible(a, b)) return true;
    }
  }
  return false;
}

/** Contagem aproximada de termos no léxico (para docs / UI). */
export function constructionLexiconTermCount(): number {
  return Object.values(DOMAIN_LEXICON).reduce((n, list) => n + list.length, 0);
}
