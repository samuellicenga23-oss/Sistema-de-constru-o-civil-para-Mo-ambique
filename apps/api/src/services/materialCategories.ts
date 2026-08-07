/** Categorias canónicas de materiais (catálogo + portal fornecedor). */
export const MATERIAL_CATEGORIES = [
  "Cimento",
  "Agregados",
  "Aços",
  "Alvenaria",
  "Madeiras",
  "Coberturas",
  "Instalações hidráulicas",
  "Instalações eléctricas",
  "Acabamentos",
  "Isolamentos",
  "Ferragens",
  "Betões preparados",
  "Estaleiro e segurança",
  "Outros",
] as const;

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

const LEGACY_TO_CANONICAL: Record<string, MaterialCategory> = {
  "tintas e revestimentos": "Acabamentos",
  revestimentos: "Acabamentos",
  "aparelhos sanitários": "Instalações hidráulicas",
  "aparelhos sanitarios": "Instalações hidráulicas",
  betoes: "Betões preparados",
  "betões": "Betões preparados",
  instalacoes: "Instalações hidráulicas",
  "instalações": "Instalações hidráulicas",
  ligantes: "Cimento",
  cimentos: "Cimento",
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((n) => haystack.includes(n));
}

/** Infere o tipo de material a partir do nome (e opcionalmente da especificação). */
export function inferMaterialCategory(name: string, specification?: string | null): MaterialCategory {
  const blob = normalize(`${name} ${specification ?? ""}`);

  // Ordem importa — regras mais específicas primeiro.
  if (includesAny(blob, ["cimento cola", "cola flexivel"])) return "Acabamentos";
  if (
    includesAny(blob, ["cimento", "limak", "dugongo", "cimentos de mocambique", "cem ii", "cem iv"]) &&
    !includesAny(blob, ["bloco de cimento", "alvenaria"])
  ) {
    return "Cimento";
  }

  if (includesAny(blob, ["bloco de cimento", "tijolo", "bloco de enchimento", "pavimento intertravado", "bloco intertravado"])) {
    return "Alvenaria";
  }

  if (includesAny(blob, ["areia", "brita", "saibro", "terras de emprestimo", "pedra 0/", "agua"])) {
    return "Agregados";
  }

  if (includesAny(blob, ["aco a", "malhasol", "arame de amarracao", "perfil metalico ipn", "ipn"])) {
    return "Aços";
  }

  if (includesAny(blob, ["madeira de cofragem", "vigamento de madeira"])) return "Madeiras";

  if (
    includesAny(blob, [
      "cobertura",
      "telha",
      "cumeeira",
      "chapa metalica",
      "chapa metalica perfilada",
      "calha galvanizada",
      "rufos",
    ])
  ) {
    return "Coberturas";
  }

  if (
    includesAny(blob, [
      "eletroduto",
      "electroduto",
      "cabo electric",
      "cabo de cobre",
      "tomada",
      "interruptor",
      "luminaria",
      "quadro electric",
      "disjuntor",
      "caixa de derivacao",
      "caixa de aparelhagem",
      "aterramento",
      "electrodo de aterramento",
      "barramento equipotencial",
      "caixa de inspeccao de terra",
      "ar condicionado",
      "sensor de movimento",
      "diferencial",
    ])
  ) {
    return "Instalações eléctricas";
  }

  if (
    includesAny(blob, [
      "tubo upvc",
      "tubo pvc",
      "tubo ppr",
      "tubo pead",
      "acessorios upvc",
      "acessorios de canalizacao",
      "torneira",
      "sanita",
      "lavatorio",
      "chuveiro",
      "pia de cozinha",
      "tanque de lavandaria",
      "reservatorio de agua",
      "fossa septica",
      "caixa de visita",
      "bomba de agua",
      "valvula",
      "termoacumulador",
      "acessorios wc",
      "barra de apoio",
      "espelho para lavatorio",
      "cola pvc",
      "manta liquida",
    ])
  ) {
    return "Instalações hidráulicas";
  }

  if (
    includesAny(blob, [
      "isolamento",
      "poliestireno",
      "tela asfaltica",
      "tela betuminosa",
      "primario betuminoso",
      "membrana polietileno",
      "geotextil",
      "lona/plastico",
      "la mineral",
      "anti-termitas",
      "ant termitas",
      "aditivo hidrofugo",
      "manta liquida impermeabilizante",
    ])
  ) {
    return "Isolamentos";
  }

  if (
    includesAny(blob, [
      "ferragem",
      "fechadura",
      "dobradica",
      "prego",
      "parafuso",
      "cruzetas",
      "ferragens de porta",
    ])
  ) {
    return "Ferragens";
  }

  if (includesAny(blob, ["betao preparado", "betao usinado", "ready mix", "sarjeta prefabricada"])) {
    return "Betões preparados";
  }

  if (
    includesAny(blob, [
      "tinta",
      "verniz",
      "primario acrilico",
      "massa corrida",
      "mosaico",
      "ceramico",
      "rejunte",
      "rodape",
      "gesso",
      "granito",
      "laminado para bancada",
      "vidro",
      "janela",
      "porta interior",
      "porta exterior",
      "porta pvc",
      "portao",
      "guarda-corpos",
      "perfilaria metalica para tecto",
      "placa de gesso",
      "silicone",
      "espuma expansiva",
      "cal hidraulica",
      "tela de fibra de vidro",
    ])
  ) {
    return "Acabamentos";
  }

  if (
    includesAny(blob, [
      "extintor",
      "placa identificativa",
      "contentor estaleiro",
      "grelha de ventilacao",
      "tela metalica galvanizada (vedacao)",
      "poste metalico para vedacao",
    ])
  ) {
    return "Estaleiro e segurança";
  }

  return "Outros";
}

/** Normaliza uma categoria legada ou vazia para a taxonomia canónica. */
export function resolveMaterialCategory(name: string, existingCategory?: string | null, specification?: string | null): MaterialCategory {
  const raw = (existingCategory ?? "").trim();
  if (raw) {
    const key = normalize(raw);
    if (LEGACY_TO_CANONICAL[key]) return LEGACY_TO_CANONICAL[key];
    const exact = MATERIAL_CATEGORIES.find((c) => normalize(c) === key);
    if (exact && exact !== "Outros") return exact;
  }
  return inferMaterialCategory(name, specification);
}
