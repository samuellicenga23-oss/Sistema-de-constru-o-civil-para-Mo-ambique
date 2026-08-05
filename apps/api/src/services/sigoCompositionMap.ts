/**
 * Mapeamento determinístico de descrições de mapas de quantidades →
 * composições SIGO clássicas (por nome exacto na biblioteca global).
 *
 * As regras são avaliadas pela ordem (mais específicas primeiro).
 */
import { normalizeUnit, type Unit } from "@sigo/shared";

export type SigoMapHit = {
  compositionName: string;
  confidence: number;
  reason: string;
};

type Rule = {
  name: string;
  /** Testa descrição já normalizada (sem acentos, minúsculas). */
  test: (d: string, unit: Unit) => boolean;
  compositionName: string;
  confidence?: number;
};

function n(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

/** Aço / varão — evita falso positivo em "fundacoes" (contém "aco"). Entrada já normalizada. */
export function mentionsSteel(d: string): boolean {
  return (
    /\bvaraoe?s?\b|\bvaroes\b|\barmac?ao\b|\barmadura\b|\bferrag(em|ens)?\b|\bmalhasol\b|\ba400\b/.test(d) ||
    /\baco\s+(a400|nervurado|doce|liso|aplicado)\b/.test(d) ||
    /\b(f\/?a|fornecimento)\s+(e\s+)?(montagem\s+de\s+)?var/.test(d)
  );
}

const RULES: Rule[] = [
  // ---- Eléctrica (antes de "caixa" genérica) ----
  {
    name: "quadro electrico",
    test: (d) => /quadro\s+(electric|eletrico)|quadro\s+geral|quadro\s+parcial/.test(d),
    compositionName: "Quadro eléctrico completo, montado e ensaiado",
  },
  {
    name: "aterramento",
    test: (d) => /aterramento|electrodo|rede\s+de\s+terra|equipotencial/.test(d),
    compositionName: "Rede de terra e equipotencial completa, ensaiada",
  },
  {
    name: "tomada",
    test: (d) => /\btomada\b|2p\+?t/.test(d) && !/interruptor/.test(d),
    compositionName: "Ponto de tomada 2P+T completo em tubagem embutida",
  },
  {
    name: "interruptor / comutador / iluminação",
    test: (d) =>
      /\binterruptor\b|\bcomutador\b|\biluminac/.test(d) ||
      (/ponto\s+de\s+luz|\bluminar|\bled\b/.test(d) && /electric|eletrico|ilumin/.test(d)),
    compositionName: "Ponto de iluminação completo em tubagem embutida (sem luminária)",
  },
  {
    name: "TV / antena / coaxial",
    test: (d) => /antena|parabol|coaxial|descodificador|repartidor\s+de\s+tv|\btv\b/.test(d),
    compositionName: "Ponto de electricidade (tomada/interruptor)",
  },
  {
    name: "luminária",
    test: (d) => /\bluminar|\bled\b|candeeiro|aplique/.test(d),
    compositionName: "Ponto de iluminação com luminária",
  },
  {
    name: "caixa derivação eléctrica",
    test: (d) =>
      /caixa\s+de\s+derivac/.test(d) ||
      (/caixa\s+(int|embut|aparelh)/.test(d) && /electric|eletrico|int\s*80/.test(d)),
    compositionName: "Rede eléctrica embutida (tubagem + cabo)",
  },
  {
    name: "rede eléctrica",
    test: (d) =>
      /eletroduto|tubagem\s+embutida|cabo\s+electric|cabo\s+eletrico|instalac(ao|oes)\s+electric/.test(d),
    compositionName: "Rede eléctrica embutida (tubagem + cabo)",
  },
  {
    name: "ponto electricidade genérico",
    test: (d) => /electric|eletrico/.test(d) && /\b(ponto|tomada|interruptor|circuito)\b/.test(d),
    compositionName: "Ponto de electricidade (tomada/interruptor)",
  },
  {
    name: "ar condicionado",
    test: (d) => /ar\s+condicionado|split\s+\d|hvac|climatiz/.test(d),
    compositionName: "Instalação ar condicionado split",
  },

  // ---- Sanitários / águas ----
  {
    name: "sanita",
    test: (d) => /\bsanita\b|autoclismo|vaso\s+sanitario/.test(d),
    compositionName: "Sanita completa montada (com autoclismo)",
  },
  {
    name: "lavatório",
    test: (d) => /\blavatorio\b/.test(d),
    compositionName: "Lavatório com torneira montado",
  },
  {
    name: "chuveiro",
    test: (d) => /\bchuveiro\b|\bduche\b|misturadora/.test(d),
    compositionName: "Chuveiro com misturadora montado",
  },
  {
    name: "pia / cuba cozinha",
    test: (d) =>
      /\bpia\b.*cozin|lava-?loi[cç]a|bancada.*torneira|\bcubas?\b.*inox|loi[cç]a\s+sanitaria/.test(d),
    compositionName: "Pia de cozinha com torneira montada",
  },
  {
    name: "acessórios WC / toalheiro",
    test: (d) => /toalheiro|porta-?papel|acessorios?\s+wc|espelho.*lavatorio/.test(d),
    compositionName: "Acessórios WC montados (espelho, toalheiro)",
  },
  {
    name: "tanque lavandaria",
    test: (d) => /tanque.*lavand|tanque\s+de\s+servico/.test(d),
    compositionName: "Tanque de lavandaria com torneira montado",
  },
  {
    name: "reservatório",
    test: (d) => /reservatorio|deposito\s+de\s+agua/.test(d),
    compositionName: "Reservatório de água instalado (500L, com suportes)",
  },
  {
    name: "fossa",
    test: (d) => /fossa\s+septica/.test(d),
    compositionName: "Fossa séptica pré-fabricada instalada",
  },
  {
    name: "caixa visita esgotos",
    test: (d) => /caixa\s+de\s+visita|caixa\s+de\s+inspec/.test(d) && !/terra|electric/.test(d),
    compositionName: "Caixa de visita de esgotos montada",
  },
  {
    name: "tubo PEAD",
    test: (d) => /pead|hdpe/.test(d),
    compositionName: "Tubagem PEAD Ø110mm assente (esgotos)",
  },
  {
    name: "tubo uPVC 110",
    test: (d) =>
      (/(upvc|pvc|esgoto|saneamento)/.test(d) && /(110|ø110|dn\s*110)/.test(d)) ||
      /^ø?\s*110\s*mm$/.test(d.trim()),
    compositionName: "Tubagem uPVC Ø110mm assente (esgotos)",
  },
  {
    name: "tubo uPVC 40",
    test: (d) =>
      (/(upvc|pvc|esgoto)/.test(d) && /(40|ø40|dn\s*40)/.test(d)) || /^ø?\s*40\s*mm$/.test(d.trim()),
    compositionName: "Tubagem uPVC Ø40mm assente (esgotos)",
  },
  {
    name: "queda / pluviais / Ø80",
    test: (d) =>
      /tubo\s+de\s+queda|pluvia|caleira|calha/.test(d) ||
      (/(80|ø80|dn\s*80)/.test(d) && /(pvc|upvc|queda|pluvia)/.test(d)) ||
      /^ø?\s*80\s*mm$/.test(d.trim()),
    compositionName: "Tubo de queda PVC Ø80mm montado (pluviais)",
  },
  {
    name: "água PPR / distribuição",
    test: (d) => /\bppr\b|agua\s+fria|rede\s+de\s+agua|canalizac.*agua/.test(d),
    compositionName: "Rede de distribuição de água fria (tubo PPR Ø20mm)",
  },
  {
    name: "ponto de água",
    test: (d) => /ponto\s+de\s+agua|torneira|registo\s+de\s+agua/.test(d),
    compositionName: "Ponto de água (canalização) instalado",
  },
  {
    name: "bomba água",
    test: (d) => /bomba.*(agua|recalque)|eletrobomba/.test(d),
    compositionName: "Bomba de recalque de água instalada",
  },

  // ---- Terras / preliminares ----
  {
    name: "anti-térmitas",
    test: (d) => /anti-?termit|carbolim|xilofag|muchem|produto\s+quimic.*fund/.test(d),
    compositionName: "Tratamento anti-térmitas do solo",
  },
  {
    name: "limpeza terreno",
    test: (d) => /limpeza\s+do\s+terreno|desmatamento|remocao.*veget/.test(d),
    compositionName: "Remoção e limpeza do terreno até 20cm de profundidade",
  },
  {
    name: "marcação / implantação",
    test: (d) => /marcac(ao|oes)\s+da\s+obra|implantac|cangalho|piquetagem/.test(d),
    compositionName: "Implantação da obra / montagem de cangalho",
  },
  {
    name: "enrocamento",
    test: (d) => /enrocamento|pedra\s+mediana|leito\s+de\s+fund/.test(d),
    compositionName: "Enrocamento com pedra em fundações/pavimentos",
  },
  {
    name: "membrana",
    test: (d) => /membrana|polietileno|folha\s+preta/.test(d),
    compositionName: "Membrana de polietileno em caixas de pavimento",
  },
  {
    name: "compactação / rega base",
    test: (d) =>
      /compactac|rega\s+e\s+compact|aashto|95%\s*aashto|maco/.test(d) ||
      (/leitos?\s+das?\s+fund/.test(d) && /compact|rega/.test(d)),
    compositionName: "Reaterro compactado com solos da escavação",
  },
  {
    name: "reaterro",
    test: (d) => /reaterro|aterro.*solos?\s+da\s+escav/.test(d),
    compositionName: "Reaterro compactado com solos da escavação",
  },
  {
    name: "aterro empréstimo",
    test: (d) =>
      (/terras?\s+de\s+emprestimo/.test(d) || (/\baterro\b/.test(d) && !/reaterro|compactac/.test(d))),
    compositionName: "Aterro com terras de empréstimo compactado",
  },
  {
    name: "escavação mecânica",
    test: (d) => /escavac.*mecanic|escavadeira|maquina/.test(d) && /escav|terrap/.test(d),
    compositionName: "Escavação mecânica em fundações",
  },
  {
    name: "escavação",
    test: (d) => /escavac|excavac|cabouco|abertura\s+de\s+valas?/.test(d),
    compositionName: "Escavação manual em fundações (incl. baldeação)",
  },
  {
    name: "terraplanagem",
    test: (d) => /terraplan|regularizac.*terreno/.test(d),
    compositionName: "Terraplanagem mecânica",
  },
  {
    name: "saibro",
    test: (d) => /\bsaibro\b/.test(d),
    compositionName: "Saibro regularizado e compactado (pavimento exterior)",
  },

  // ---- Betão / aço / cofragem ----
  {
    name: "aço aplicado",
    test: (d, unit) => mentionsSteel(d) && (unit === "kg" || /var[oõ]|armac|armadura|a400/.test(d)),
    compositionName: "Aço A400 aplicado (corte, dobragem e amarração)",
  },
  {
    name: "malhasol",
    test: (d) => /malhas+ol|malhassol|malha\s+soldada|electrosold/.test(d),
    compositionName: "Malhasol AQ38 aplicado",
  },
  {
    name: "cofragem",
    test: (d) => /cofrag|descofrag|forma\s+de\s+madeira/.test(d),
    compositionName: "Cofragem e descofragem de madeira",
  },
  {
    name: "escadas betão",
    test: (d) => /escadas?\s+(em\s+)?betao|betao.*escadas?/.test(d),
    compositionName: "Escadas em betão armado B25",
  },
  {
    name: "peitoril / lintel",
    test: (d) => /peitoril|lintel|padieira/.test(d),
    compositionName: "Peitoril/lintel em betão B25",
  },
  {
    name: "laje aligeirada / abobadilha",
    test: (d) =>
      /laje\s+aligeir|bloco\s+de\s+enchimento|vigota|abobadilh|abobada/.test(d),
    compositionName: "Laje aligeirada com blocos de enchimento",
  },
  {
    name: "elementos estruturais curtos",
    test: (d) =>
      /^(vigas?(\s+de\s+pavimento)?|pilares?|sapatas?(\s+isoladas?)?|lajes?(\s+de\s+pavimento)?|cintas?|muretes?)$/.test(
        d.trim(),
      ) ||
      /vigas?\s+estruturai|linteis?|vergas?|peitor[ií]s?.*lajes?|sapatas?\s+isoladas?/.test(d),
    compositionName: "Betão B25 (estrutural)",
  },
  {
    name: "betão B15 limpeza",
    test: (d) => /b15|betao\s+de\s+limpeza|magro/.test(d),
    compositionName: "Betão B15 (betão de limpeza)",
  },
  {
    name: "betão B20",
    test: (d) => /\bb20\b/.test(d),
    compositionName: "Betão B20 (estrutural leve)",
  },
  {
    name: "betão B30",
    test: (d) => /\bb30\b/.test(d),
    compositionName: "Betão B30 (alta resistência)",
  },
  {
    name: "betão bombeado",
    test: (d) => /bombeado|bomba\s+de\s+betao/.test(d),
    compositionName: "Betão B25 bombeado",
  },
  {
    name: "viga / pilar / fundação armada",
    test: (d) =>
      /\b(viga|pilares?|sapata|cintas?|murete)s?\b/.test(d) ||
      /laje\s+de\s+pavimento|pronta\s+para\s+receber\s+laje|mistura\s*1\s*:\s*2\s*:\s*3/.test(d) ||
      (/fundac/.test(d) && /arm|varao|betao|betão|cimento|b25|b20/.test(d)) ||
      (/betao|betão/.test(d) && /estrutural|armado/.test(d)),
    compositionName: "Betão B25 (estrutural)",
  },
  {
    name: "betão genérico",
    test: (d) => /\bbetao\b|\bbetão\b|\bb25\b/.test(d),
    compositionName: "Betão B25 (estrutural)",
  },
  {
    name: "contrapiso",
    test: (d) => /contrapiso|soleira\s+em\s+betao/.test(d),
    compositionName: "Contrapiso/soleira em betão",
  },

  // ---- Alvenarias ----
  {
    name: "bloco 15",
    test: (d) => /bloco.*15|15\s*x\s*20|400\s*x\s*200\s*x\s*150|alvenaria.*15/.test(d),
    compositionName: "Alvenaria de bloco 15 (400x200x150mm)",
  },
  {
    name: "muro vedação",
    test: (d) => /muro\s+de\s+vedac|vedacao\s+em\s+bloco/.test(d),
    compositionName: "Muro de vedação em bloco 20",
  },
  {
    name: "tijolo",
    test: (d) => /tijolo|bloco\s+perfurado/.test(d),
    compositionName: "Alvenaria de tijolo furado 30x20x15",
  },
  {
    name: "alvenaria / bloco 20",
    test: (d) => /alvenaria|bloco\s+de\s+cimento|bloco.*20|400\s*x\s*200\s*x\s*200/.test(d),
    compositionName: "Alvenaria de bloco 20 (400x200x200mm)",
  },

  // ---- Revestimentos / pinturas ----
  {
    name: "impermeabilização WC",
    test: (d) => /impermeabil.*banh|manta\s+liquida|casa\s+de\s+banho.*imper/.test(d),
    compositionName: "Impermeabilização de casa de banho (manta líquida)",
  },
  {
    name: "impermeabilização cobertura",
    test: (d) => /impermeabil.*cobertura|tela\s+asfalt/.test(d),
    compositionName: "Impermeabilização de laje de cobertura (tela asfáltica)",
  },
  {
    name: "impermeabilização fundações",
    test: (d) => /impermeabil.*fund|tela\s+betumin/.test(d),
    compositionName: "Impermeabilização de fundações (tela betuminosa)",
  },
  {
    name: "isolamento",
    test: (d) => /isolamento\s+term|poliestireno|eps\b/.test(d),
    compositionName: "Isolamento térmico com poliestireno expandido",
  },
  {
    name: "betonilha",
    test: (d) => /betonilha|regularizac.*pavimento|tra[cç]o\s*1\s*:\s*4/.test(d),
    compositionName: "Betonilha de regularização",
  },
  {
    name: "reboco exterior",
    test: (d) => /reboco\s+exterior|argamassa.*exterior|hidrofug/.test(d),
    compositionName: "Reboco exterior hidrófugo",
  },
  {
    name: "reboco interior",
    test: (d) => /reboco|estanhado|argamassa\s+de\s+reboco/.test(d),
    compositionName: "Reboco interior estanhado",
  },
  {
    name: "mosaico / azulejo",
    test: (d) => /mosaico|azulej|porcelanato|ceramic.*paviment|tijoleira/.test(d),
    compositionName: "Assentamento de mosaico cerâmico",
  },
  {
    name: "rodapé",
    test: (d) => /rodape/.test(d),
    compositionName: "Rodapé cerâmico assente",
  },
  {
    name: "tecto falso",
    test: (d) => /tecto\s+falso|gesso\s+carton|pladur|contraplacado.*tecto/.test(d),
    compositionName: "Tecto falso em gesso cartonado",
  },
  {
    name: "massa corrida",
    test: (d) => /massa\s+corrida|lixagem/.test(d),
    compositionName: "Massa corrida e lixagem antes de pintura",
  },
  {
    name: "pintura metal / antiferro",
    test: (d) => /anti\s*corros|ant\s*ferrug|pintura.*metal|grade.*pint/.test(d),
    compositionName: "Pintura ant ferrugem em metal",
  },
  {
    name: "verniz",
    test: (d) => /\bverniz\b/.test(d),
    compositionName: "Verniz em madeira (portas, estruturas)",
  },
  {
    name: "pintura exterior",
    test: (d) => /pintura.*exterior|tinta\s+acril.*exterior|acrilica\s+exterior/.test(d),
    compositionName: "Pintura acrílica exterior (2 demãos + primário)",
  },
  {
    name: "pintura interior / esmalte",
    test: (d) => /pintura|esmalte|cinacryl|tinta\s+aquos|primario\s+selante/.test(d),
    compositionName: "Pintura esmalte aquoso interior (2 demãos + primário)",
  },

  // ---- Caixilharias / coberturas ----
  {
    name: "janela alumínio",
    test: (d) => /janela.*alumin|caixilh.*alumin/.test(d),
    compositionName: "Janela de alumínio com vidro montada",
  },
  {
    name: "janela PVC",
    test: (d) => /janela.*pvc|caixilh.*pvc/.test(d),
    compositionName: "Janela PVC com vidro montada",
  },
  {
    name: "janela madeira / genérica",
    test: (d) => /\bjanelas?\b/.test(d),
    compositionName: "Janela de alumínio com vidro montada",
  },
  {
    name: "demolição / remoção",
    test: (d) => /demolic|remocao\s+do\s+acesso|remocao\s+de\s+entulho|entulho/.test(d),
    compositionName: "Demolição de alvenaria existente",
  },
  {
    name: "porta exterior metálica",
    test: (d) => /porta.*metal|porta.*ferro|grades?\s+metalicas?\s+nas?\s+portas?/.test(d),
    compositionName: "Porta exterior metálica montada",
  },
  {
    name: "porta exterior madeira",
    test: (d) => /porta\s+exterior.*madeira|porta\s+de\s+entrada/.test(d),
    compositionName: "Porta exterior de madeira montada",
  },
  {
    name: "porta interior / genérica",
    test: (d) => /\bportas?\b/.test(d) && !/portao|portarolo|porta-?papel|porta-?toalh/.test(d),
    compositionName: "Porta interior de madeira montada",
  },
  {
    name: "ferragens",
    test: (d) =>
      /fechadura|dobradic|tranqueta|regulador|ferrag|parafusos?\s+para\s+fixac/.test(d),
    compositionName: "Porta interior de madeira montada",
  },
  {
    name: "disjuntor / caixa coluna",
    test: (d) => /disjuntor|caixa\s+de\s+coluna|quadro\s+de\s+coluna|trifasica/.test(d),
    compositionName: "Quadro eléctrico parcial montado",
  },
  {
    name: "tubo anelado / eletroduto",
    test: (d) => /tubo\s+anelado|eletroduto|conduite/.test(d),
    compositionName: "Rede eléctrica embutida (tubagem + cabo)",
  },
  {
    name: "guarda-corpos",
    test: (d) => /guarda-?corpos|corrim[aã]o|guarda\s+corpo/.test(d),
    compositionName: "Guarda-corpos metálico montado",
  },
  {
    name: "portão",
    test: (d) => /\bportao\b/.test(d),
    compositionName: "Portão metálico montado",
  },
  {
    name: "cobertura telha",
    test: (d) => /telha\s+ceram|cobertura.*telha/.test(d),
    compositionName: "Cobertura em telha cerâmica",
  },
  {
    name: "cobertura chapa",
    test: (d) => /chapa.*(ondul|perfil|metal|galvan)|cobertura.*chapa|luzalite|fibrocimento/.test(d),
    compositionName: "Cobertura em chapa metálica ondulada",
  },
  {
    name: "cumeeira",
    test: (d) => /cumeeira|remate\s+de\s+cobertura/.test(d),
    compositionName: "Cumeeira / remate de cobertura",
  },

  // ---- Estaleiro ----
  {
    name: "cerco obra",
    test: (d) => /cerco\s+de\s+obra|vedacao\s+provisoria|tela\s+metalica.*obra/.test(d),
    compositionName: "Cerco de obra com tela metálica",
  },
  {
    name: "estaleiro",
    test: (d) => /estaleiro|contentor/.test(d),
    compositionName: "Montagem de estaleiro (contentor e protecções)",
  },
  {
    name: "limpeza final",
    test: (d) => /limpeza\s+final|limpeza\s+geral\s+da\s+obra/.test(d),
    compositionName: "Limpeza final de obra",
  },
];

/**
 * Devolve o nome da composição SIGO a usar, ou null se nenhuma regra aplicar.
 */
export function mapDescriptionToSigoComposition(
  description: string,
  unit: string,
): SigoMapHit | null {
  const d = n(description);
  const u = normalizeUnit(unit, "un");
  if (!d) return null;

  for (const rule of RULES) {
    if (rule.test(d, u)) {
      return {
        compositionName: rule.compositionName,
        confidence: rule.confidence ?? 0.92,
        reason: rule.name,
      };
    }
  }
  return null;
}
