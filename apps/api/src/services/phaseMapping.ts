// Mapeamento das fases de obra (modelo de 12 fases pedido pelo utilizador) para os capítulos de
// um Mapa de Quantidades. Cada capítulo mapeia para UMA fase por omissão (por nome, tolerante a
// pequenas variações de texto entre documentos gerados pelo sistema e documentos importados de
// ficheiros reais — ex: "REVESTIMENTO DE PAVIMENTOS E PAREDES" vs "...E RODAPÉS").
//
// Alguns capítulos reais misturam trabalhos de mais do que uma fase no mesmo capítulo (ex:
// "BETÕES, AÇOS E COFRAGENS" tem betão/aço de fundações e de estrutura juntos; "INSTALAÇÃO
// HIDRÁULICA" tem rede de água e louças sanitárias juntos). Para esses casos, em vez de excepções
// por código de item (frágil — a numeração muda consoante o documento é gerado pelo sistema ou
// importado, como se confirmou ao testar contra um ficheiro real onde os códigos de fundações não
// batiam certo com os do gerador padrão), procura-se por palavras-chave na descrição do próprio
// item e dos seus grupos ascendentes (ex: "Aço A400 > Em Sapatas e Arranque de pilar > Ø6mm" — a
// pista "sapata" está no grupo, não no item folha).
export type PhaseKey =
  | "mobilizacao"
  | "terraplenagem_fundacoes"
  | "estrutura"
  | "alvenaria"
  | "cobertura"
  | "instalacoes"
  | "revestimentos"
  | "esquadrias"
  | "acabamentos"
  | "obras_exteriores"
  | "entrega_garantia"
  | "nao_classificado";

export const CONSTRUCTION_PHASES: { key: PhaseKey; label: string }[] = [
  { key: "mobilizacao", label: "Mobilização do Estaleiro" },
  { key: "terraplenagem_fundacoes", label: "Terraplenagem e Fundações" },
  { key: "estrutura", label: "Estrutura" },
  { key: "alvenaria", label: "Alvenaria" },
  { key: "cobertura", label: "Cobertura" },
  { key: "instalacoes", label: "Instalações Prediais" },
  { key: "revestimentos", label: "Revestimentos" },
  { key: "esquadrias", label: "Esquadrias" },
  { key: "acabamentos", label: "Acabamentos" },
  { key: "obras_exteriores", label: "Obras Exteriores" },
  { key: "entrega_garantia", label: "Limpeza, Testes e Entrega" },
  { key: "nao_classificado", label: "Não Classificado" },
];

const PHASE_LABEL: Record<PhaseKey, string> = Object.fromEntries(CONSTRUCTION_PHASES.map((p) => [p.key, p.label])) as Record<
  PhaseKey,
  string
>;

export function phaseLabel(key: PhaseKey): string {
  return PHASE_LABEL[key] ?? key;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[,.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Nome do capítulo (normalizado) → fase por omissão. Inclui variantes de texto encontradas tanto
// na estrutura padrão gerada pelo sistema (`boqTemplate.ts`) como em ficheiros reais importados.
const CHAPTER_TO_PHASE: Record<string, PhaseKey> = {
  "trabalhos preliminares": "mobilizacao",
  "movimentos de terra": "terraplenagem_fundacoes",
  "betoes acos e cofragens": "estrutura",
  alvenarias: "alvenaria",
  "betonilhas e rebocos": "revestimentos",
  "revestimento de pavimentos e paredes": "revestimentos",
  "revestimento de pavimentos e rodapes": "revestimentos",
  pinturas: "acabamentos",
  "drenagem de esgotos": "instalacoes",
  "drenagem de aguas pluviais": "instalacoes",
  cobertura: "cobertura",
  "instalacao hidraulica": "instalacoes",
  "saneamento autonomo (fossa septica)": "instalacoes",
  "instalacoes electricas": "instalacoes",
  "instalacao electrica": "instalacoes",
  "portas janelas e caixilharias": "esquadrias",
  "portas e janelas": "esquadrias",
  caixilharias: "esquadrias",
};

// Dentro de um capítulo classificado como "estrutura", uma destas palavras no item ou num dos seus
// grupos ascendentes indica que é afinal um trabalho de fundação (não de super-estrutura).
const FOUNDATION_KEYWORDS = ["fundac", "sapata", "cabouco"];

// Dentro de um capítulo classificado como "instalacoes", uma destas palavras indica um aparelho
// sanitário/acabamento (não rede de distribuição) — no modelo de fases do utilizador isso conta
// como Acabamentos.
const SANITARY_FIXTURE_KEYWORDS = [
  "sanit",
  "lavatorio",
  "duche",
  "chuveiro",
  "pia de cozinha",
  "tanque de lavandaria",
  "autoclismo",
];

function containsKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalize(text);
  return keywords.some((k) => normalized.includes(k));
}

export function mapToPhase(chapterName: string, ancestorDescriptions: string[], itemDescription: string): PhaseKey {
  const basePhase = CHAPTER_TO_PHASE[normalize(chapterName)] ?? "nao_classificado";
  const combined = [...ancestorDescriptions, itemDescription].join(" ");

  if (basePhase === "estrutura" && containsKeyword(combined, FOUNDATION_KEYWORDS)) return "terraplenagem_fundacoes";
  if (basePhase === "instalacoes" && containsKeyword(combined, SANITARY_FIXTURE_KEYWORDS)) return "acabamentos";

  return basePhase;
}
