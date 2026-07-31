import { eq, isNull, and } from "drizzle-orm";
import { db, sql } from "./index.js";
import {
  labourCategories,
  materials,
  equipment,
  costCompositions,
  compositionLabourLines,
  compositionMaterialLines,
  compositionEquipmentLines,
} from "./schema.js";
import { computeHourlyRate } from "../services/costEngine.js";

// Biblioteca completa de composições de custo (catálogo global partilhado, MZN), organizada
// por categoria — do estaleiro ao acabamento final. Rendimentos de mão-de-obra baseados no
// ficheiro real "ESTUDO DE PRECOS MASTER" do utilizador quando disponíveis; os restantes
// seguem rácios correntes de mercado em Moçambique. Tudo editável directamente por cada
// empresa (a edição clona automaticamente em segundo plano — nunca precisa de "clonar" à mão).

const WORKING_DAYS = 22;
const WORKING_HOURS = 9;

// Ver nota de salários em seedCatalog.ts — mesmo critério (mínimo legal 2026 + escalão por
// qualificação/escassez de mão-de-obra especializada).
const EXTRA_LABOUR = [
  { name: "Pintor", monthlySalary: 10500 },
  { name: "Canalizador", monthlySalary: 11500 },
  { name: "Electricista", monthlySalary: 12000 },
  { name: "Encarregado", monthlySalary: 22000 },
  { name: "Serralheiro", monthlySalary: 12500 },
  { name: "Vidraceiro", monthlySalary: 11500 },
  { name: "Carpinteiro de Tectos (Gesseiro)", monthlySalary: 10500 },
];

const EXTRA_MATERIALS: Array<{
  name: string;
  unit: "m" | "m2" | "m3" | "ml" | "kg" | "un" | "vg" | "h";
  baseUnitCost: number;
  importFactor?: number;
  category?: string;
  specification?: string;
  // Unidade de compra de mercado, quando difere da unidade de medida (ver nota em seedCatalog.ts).
  purchasePackage?: { label: string; qty: number };
}> = [
  { name: "Água", unit: "m3", baseUnitCost: 150 },
  { name: "Madeira de cofragem", unit: "m3", baseUnitCost: 25000 },
  { name: "Prego", unit: "kg", baseUnitCost: 115 },
  { name: "Arame de amarração", unit: "kg", baseUnitCost: 120 },
  { name: "Terras de empréstimo (posto em obra)", unit: "m3", baseUnitCost: 880, purchasePackage: { label: "Camião 10m³", qty: 10 } },
  {
    name: "Tinta acrílica exterior",
    unit: "un",
    baseUnitCost: 4500,
    category: "Tintas e revestimentos",
    specification: "Tinta aquosa 100% acrílica para exterior, resistente a intempéries e radiação UV, acabamento e cor conforme projecto, em embalagem original. Aplicar primário compatível e mínimo de duas demãos segundo a ficha do fabricante; marca indicada apenas como referência, admitindo equivalente aprovado.",
  },
  {
    name: "Tinta esmalte aquoso interior",
    unit: "un",
    baseUnitCost: 3800,
    category: "Tintas e revestimentos",
    specification: "Tinta aquosa estireno-acrílica lavável para interior, resistência à esfrega tipo II ou superior, acabamento mate e cor conforme projecto, em embalagem original. Aplicar primário compatível e mínimo de duas demãos segundo a ficha do fabricante; ou equivalente aprovado.",
  },
  { name: "Verniz para madeira", unit: "un", baseUnitCost: 3200 },
  { name: "Mosaico cerâmico", unit: "m2", baseUnitCost: 800, purchasePackage: { label: "Caixa 2m²", qty: 2 } },
  { name: "Cimento cola", unit: "kg", baseUnitCost: 60, purchasePackage: { label: "Saco 20kg", qty: 20 } },
  { name: "Cruzetas para juntas", unit: "un", baseUnitCost: 1, purchasePackage: { label: "Pacote 200un", qty: 200 } },
  { name: "Tubo uPVC Ø110mm", unit: "ml", baseUnitCost: 350, purchasePackage: { label: "Vara 6m", qty: 6 } },
  { name: "Tubo uPVC Ø40mm", unit: "ml", baseUnitCost: 120, purchasePackage: { label: "Vara 6m", qty: 6 } },
  { name: "Tubo PVC Ø80mm (queda)", unit: "ml", baseUnitCost: 250, purchasePackage: { label: "Vara 6m", qty: 6 } },
  { name: "Acessórios uPVC (colarinhos, curvas, sifões)", unit: "vg", baseUnitCost: 100 },
  { name: "Membrana polietileno 275 micron", unit: "m2", baseUnitCost: 90, purchasePackage: { label: "Rolo 100m²", qty: 100 } },
  { name: "Malhasol AQ38", unit: "m2", baseUnitCost: 220, purchasePackage: { label: "Folha 14,4m²", qty: 14.4 } },
  { name: "Produto anti-térmitas", unit: "un", baseUnitCost: 3500 },
  { name: "Tijolo furado 30x20x15", unit: "un", baseUnitCost: 22, purchasePackage: { label: "Milheiro (1000 un)", qty: 1000 } },
  { name: "Tela asfáltica impermeabilizante", unit: "m2", baseUnitCost: 480, purchasePackage: { label: "Rolo 10m²", qty: 10 } },
  { name: "Primário betuminoso", unit: "m2", baseUnitCost: 60 },
  { name: "Poliestireno expandido (isolamento)", unit: "m2", baseUnitCost: 350, purchasePackage: { label: "Placa 2m²", qty: 2 } },
  { name: "Tela betuminosa para fundações", unit: "m2", baseUnitCost: 420, purchasePackage: { label: "Rolo 10m²", qty: 10 } },
  { name: "Rodapé cerâmico", unit: "ml", baseUnitCost: 180 },
  { name: "Placa de gesso cartonado", unit: "m2", baseUnitCost: 650, purchasePackage: { label: "Placa 2,88m²", qty: 2.88 } },
  { name: "Perfilaria metálica para tecto falso", unit: "m2", baseUnitCost: 280 },
  { name: "Janela de alumínio com vidro incolor (kit)", unit: "m2", baseUnitCost: 8500 },
  { name: "Porta interior de madeira (kit completo)", unit: "un", baseUnitCost: 6500 },
  { name: "Porta exterior metálica (kit completo)", unit: "un", baseUnitCost: 12000 },
  { name: "Guarda-corpos metálico (fabricado)", unit: "ml", baseUnitCost: 3200 },
  { name: "Chapa metálica ondulada para cobertura", unit: "m2", baseUnitCost: 950 },
  { name: "Vigamento de madeira para cobertura", unit: "ml", baseUnitCost: 650 },
  { name: "Cumeeira metálica", unit: "ml", baseUnitCost: 550 },
  { name: "Caixa de visita pré-fabricada", unit: "un", baseUnitCost: 4500 },
  { name: "Tubo PPR 20mm (água)", unit: "ml", baseUnitCost: 95, purchasePackage: { label: "Vara 4m", qty: 4 } },
  { name: "Acessórios de canalização (água)", unit: "vg", baseUnitCost: 250 },
  { name: "Torneira/registo", unit: "un", baseUnitCost: 850 },
  { name: "Cabo eléctrico 2.5mm²", unit: "ml", baseUnitCost: 65, purchasePackage: { label: "Rolo 100m", qty: 100 } },
  { name: "Tomada/interruptor", unit: "un", baseUnitCost: 320 },
  { name: "Luminária LED", unit: "un", baseUnitCost: 950 },
  { name: "Quadro eléctrico parcial", unit: "un", baseUnitCost: 3500 },
  { name: "Disjuntores e acessórios eléctricos", unit: "vg", baseUnitCost: 600 },
  {
    name: "Sanita completa com autoclismo (kit)",
    unit: "un",
    baseUnitCost: 4500,
    category: "Aparelhos sanitários",
    specification: "Sanita de louça vitrificada branca, autoclismo de dupla descarga 3/6 L, assento, mecanismo, válvula, flexível, fixações e vedantes. Saída horizontal ou vertical conforme a rede do projecto; conjunto completo instalado, ensaiado e estanque; ou equivalente aprovado.",
  },
  {
    name: "Lavatório com torneira (kit)",
    unit: "un",
    baseUnitCost: 2800,
    category: "Aparelhos sanitários",
    specification: "Lavatório de louça vitrificada branca com 50–60 cm, pedestal ou suportes conforme projecto, torneira monocomando cromada, válvula, sifão, flexíveis e fixações; conjunto completo instalado e ensaiado; ou equivalente aprovado.",
  },
  {
    name: "Chuveiro com misturadora (kit)",
    unit: "un",
    baseUnitCost: 2200,
    category: "Aparelhos sanitários",
    specification: "Misturadora de duche cromada para água quente e fria, ligações 1/2 polegada, chuveiro, flexível, suportes, excêntricos e vedantes; pressão de serviço compatível com a rede, instalação e ensaio incluídos; ou equivalente aprovado.",
  },
  {
    name: "Pia de cozinha inox com torneira (kit)",
    unit: "un",
    baseUnitCost: 3200,
    category: "Aparelhos sanitários",
    specification: "Lava-louça em aço inoxidável AISI 304, uma cuba, espessura mínima 0,8 mm, válvula e sifão, torneira monocomando cromada, flexíveis, fixações e vedação; dimensões conforme bancada do projecto; ou equivalente aprovado.",
  },
  {
    name: "Tanque de lavandaria com torneira (kit)",
    unit: "un",
    baseUnitCost: 1800,
    category: "Aparelhos sanitários",
    specification: "Tanque de lavandaria resistente, capacidade e dimensões conforme projecto, torneira de serviço cromada, válvula, sifão, ligações, suportes e vedação; conjunto instalado e ensaiado; ou equivalente aprovado.",
  },
  { name: "Reservatório de água 500L com suportes (kit)", unit: "un", baseUnitCost: 18000 },
];

type CompositionSpec = {
  name: string;
  category: string;
  outputUnit: "m" | "m2" | "m3" | "ml" | "kg" | "un" | "vg" | "h";
  labour: Array<[string, number]>;
  mats: Array<[string, number]>;
  equip: Array<[string, number]>;
};

const COMPOSITIONS: CompositionSpec[] = [
  // ---- Preliminares e Estaleiro ----
  { name: "Remoção e limpeza do terreno até 20cm de profundidade", category: "Preliminares e Estaleiro", outputUnit: "m2", labour: [["Servente", 0.6]], mats: [], equip: [] },
  { name: "Implantação da obra / montagem de cangalho", category: "Preliminares e Estaleiro", outputUnit: "ml", labour: [["Carpinteiro B", 0.25], ["Servente", 0.25], ["Topógrafo", 0.1]], mats: [["Madeira de cofragem", 0.002], ["Prego", 0.1]], equip: [] },
  { name: "Tratamento anti-térmitas do solo", category: "Preliminares e Estaleiro", outputUnit: "m2", labour: [["Servente", 0.15]], mats: [["Produto anti-térmitas", 0.02], ["Água", 0.005]], equip: [] },

  // ---- Movimentos de Terra ----
  { name: "Escavação manual em fundações (incl. baldeação)", category: "Movimentos de Terra", outputUnit: "m3", labour: [["Servente", 3.0]], mats: [], equip: [] },
  { name: "Reaterro compactado com solos da escavação", category: "Movimentos de Terra", outputUnit: "m3", labour: [["Servente", 2.3]], mats: [["Água", 0.05]], equip: [["Placa compactadora", 0.8]] },
  { name: "Aterro com terras de empréstimo compactado", category: "Movimentos de Terra", outputUnit: "m3", labour: [["Servente", 2.3]], mats: [["Terras de empréstimo (posto em obra)", 1.15], ["Água", 0.05]], equip: [["Placa compactadora", 0.8]] },
  { name: "Enrocamento com pedra em fundações/pavimentos", category: "Movimentos de Terra", outputUnit: "m3", labour: [["Servente", 2.3]], mats: [["Brita 3/4", 1.05]], equip: [["Placa compactadora", 0.7]] },
  { name: "Membrana de polietileno em caixas de pavimento", category: "Movimentos de Terra", outputUnit: "m2", labour: [["Servente", 0.05]], mats: [["Membrana polietileno 275 micron", 1.1]], equip: [] },

  // ---- Betões, Aços e Cofragens ----
  { name: "Betão B15 (betão de limpeza)", category: "Betões, Aços e Cofragens", outputUnit: "m3", labour: [["Pedreiro A", 2.0], ["Servente", 5.0]], mats: [["Cimento (saco 50kg)", 5], ["Areia grossa", 0.55], ["Brita 3/4", 0.85], ["Água", 0.2]], equip: [["Betoneira", 1.0]] },
  { name: "Betão B20 (estrutural leve)", category: "Betões, Aços e Cofragens", outputUnit: "m3", labour: [["Pedreiro A", 2.5], ["Servente", 5.5]], mats: [["Cimento (saco 50kg)", 6], ["Areia grossa", 0.52], ["Brita 3/4", 0.82], ["Água", 0.2]], equip: [["Betoneira", 1.1]] },
  { name: "Betão B25 (estrutural)", category: "Betões, Aços e Cofragens", outputUnit: "m3", labour: [["Pedreiro A", 3.0], ["Servente", 6.0]], mats: [["Cimento (saco 50kg)", 7], ["Areia grossa", 0.5], ["Brita 3/4", 0.8], ["Água", 0.2]], equip: [["Betoneira", 1.2]] },
  { name: "Betão B30 (alta resistência)", category: "Betões, Aços e Cofragens", outputUnit: "m3", labour: [["Pedreiro A", 3.5], ["Servente", 6.5]], mats: [["Cimento (saco 50kg)", 8.5], ["Areia grossa", 0.48], ["Brita 3/4", 0.78], ["Água", 0.2]], equip: [["Betoneira", 1.3]] },
  { name: "Aço A400 aplicado (corte, dobragem e amarração)", category: "Betões, Aços e Cofragens", outputUnit: "kg", labour: [["Armador de Ferro", 0.1], ["Servente", 0.1]], mats: [["Aço A400", 1.05], ["Arame de amarração", 0.02]], equip: [] },
  { name: "Malhasol AQ38 aplicado", category: "Betões, Aços e Cofragens", outputUnit: "m2", labour: [["Armador de Ferro", 0.05], ["Servente", 0.05]], mats: [["Malhasol AQ38", 1.1]], equip: [] },
  { name: "Cofragem e descofragem de madeira", category: "Betões, Aços e Cofragens", outputUnit: "m2", labour: [["Carpinteiro B", 1.2], ["Servente", 1.2]], mats: [["Madeira de cofragem", 0.035], ["Prego", 0.15]], equip: [] },

  // ---- Alvenarias ----
  { name: "Alvenaria de bloco 20 (400x200x200mm)", category: "Alvenarias", outputUnit: "m2", labour: [["Pedreiro A", 1.1], ["Servente", 1.6]], mats: [["Bloco de cimento 20x20x40", 12.5], ["Cimento (saco 50kg)", 0.3], ["Areia grossa", 0.03], ["Água", 0.01]], equip: [] },
  { name: "Alvenaria de bloco 15 (400x200x150mm)", category: "Alvenarias", outputUnit: "m2", labour: [["Pedreiro A", 1.0], ["Servente", 1.5]], mats: [["Bloco de cimento 15x20x40", 12.5], ["Cimento (saco 50kg)", 0.25], ["Areia grossa", 0.025], ["Água", 0.01]], equip: [] },
  { name: "Alvenaria de tijolo furado 30x20x15", category: "Alvenarias", outputUnit: "m2", labour: [["Pedreiro A", 0.9], ["Servente", 1.3]], mats: [["Tijolo furado 30x20x15", 16], ["Cimento (saco 50kg)", 0.22], ["Areia grossa", 0.022], ["Água", 0.01]], equip: [] },

  // ---- Impermeabilizações e Isolamentos ----
  { name: "Impermeabilização de laje de cobertura (tela asfáltica)", category: "Impermeabilizações e Isolamentos", outputUnit: "m2", labour: [["Servente", 0.3], ["Pedreiro A", 0.2]], mats: [["Tela asfáltica impermeabilizante", 1.1], ["Primário betuminoso", 1.0]], equip: [] },
  { name: "Isolamento térmico com poliestireno expandido", category: "Impermeabilizações e Isolamentos", outputUnit: "m2", labour: [["Servente", 0.15]], mats: [["Poliestireno expandido (isolamento)", 1.05]], equip: [] },
  { name: "Impermeabilização de fundações (tela betuminosa)", category: "Impermeabilizações e Isolamentos", outputUnit: "m2", labour: [["Servente", 0.25]], mats: [["Tela betuminosa para fundações", 1.1], ["Primário betuminoso", 1.0]], equip: [] },

  // ---- Rebocos, Betonilhas e Revestimentos ----
  { name: "Reboco interior estanhado", category: "Rebocos, Betonilhas e Revestimentos", outputUnit: "m2", labour: [["Pedreiro A", 0.8], ["Servente", 1.0]], mats: [["Cimento (saco 50kg)", 0.15], ["Areia fina", 0.02], ["Água", 0.008]], equip: [] },
  { name: "Reboco exterior hidrófugo", category: "Rebocos, Betonilhas e Revestimentos", outputUnit: "m2", labour: [["Pedreiro A", 0.9], ["Servente", 1.1]], mats: [["Cimento (saco 50kg)", 0.18], ["Areia fina", 0.022], ["Água", 0.009]], equip: [] },
  { name: "Betonilha de regularização", category: "Rebocos, Betonilhas e Revestimentos", outputUnit: "m2", labour: [["Pedreiro A", 0.7], ["Servente", 0.9]], mats: [["Cimento (saco 50kg)", 0.2], ["Areia grossa", 0.03], ["Água", 0.01]], equip: [] },
  { name: "Assentamento de mosaico cerâmico", category: "Rebocos, Betonilhas e Revestimentos", outputUnit: "m2", labour: [["Pedreiro A", 1.0], ["Servente", 1.0]], mats: [["Mosaico cerâmico", 1.05], ["Cimento cola", 4], ["Cruzetas para juntas", 20]], equip: [] },
  { name: "Rodapé cerâmico assente", category: "Rebocos, Betonilhas e Revestimentos", outputUnit: "ml", labour: [["Pedreiro A", 0.25], ["Servente", 0.15]], mats: [["Rodapé cerâmico", 1.05], ["Cimento cola", 0.5]], equip: [] },
  { name: "Tecto falso em gesso cartonado", category: "Rebocos, Betonilhas e Revestimentos", outputUnit: "m2", labour: [["Carpinteiro de Tectos (Gesseiro)", 0.6], ["Servente", 0.3]], mats: [["Placa de gesso cartonado", 1.05], ["Perfilaria metálica para tecto falso", 1.1]], equip: [] },

  // ---- Pinturas ----
  { name: "Pintura acrílica exterior (2 demãos + primário)", category: "Pinturas", outputUnit: "m2", labour: [["Pintor", 0.4], ["Servente", 0.2]], mats: [["Tinta acrílica exterior", 0.02]], equip: [] },
  { name: "Pintura esmalte aquoso interior (2 demãos + primário)", category: "Pinturas", outputUnit: "m2", labour: [["Pintor", 0.35], ["Servente", 0.2]], mats: [["Tinta esmalte aquoso interior", 0.018]], equip: [] },
  { name: "Verniz em madeira (portas, estruturas)", category: "Pinturas", outputUnit: "m2", labour: [["Pintor", 0.3]], mats: [["Verniz para madeira", 0.025]], equip: [] },

  // ---- Caixilharias e Serralharias ----
  { name: "Janela de alumínio com vidro incolor montada", category: "Caixilharias e Serralharias", outputUnit: "m2", labour: [["Serralheiro", 0.6], ["Vidraceiro", 0.4]], mats: [["Janela de alumínio com vidro incolor (kit)", 1.0]], equip: [] },
  { name: "Porta interior de madeira montada", category: "Caixilharias e Serralharias", outputUnit: "un", labour: [["Carpinteiro B", 1.5], ["Servente", 0.5]], mats: [["Porta interior de madeira (kit completo)", 1.0]], equip: [] },
  { name: "Porta exterior metálica montada", category: "Caixilharias e Serralharias", outputUnit: "un", labour: [["Serralheiro", 2.0], ["Servente", 0.5]], mats: [["Porta exterior metálica (kit completo)", 1.0]], equip: [] },
  { name: "Guarda-corpos metálico montado", category: "Caixilharias e Serralharias", outputUnit: "ml", labour: [["Serralheiro", 0.8]], mats: [["Guarda-corpos metálico (fabricado)", 1.0]], equip: [] },

  // ---- Coberturas ----
  { name: "Cobertura em chapa metálica ondulada", category: "Coberturas", outputUnit: "m2", labour: [["Carpinteiro B", 0.5], ["Servente", 0.5]], mats: [["Chapa metálica ondulada para cobertura", 1.1], ["Vigamento de madeira para cobertura", 0.6], ["Prego", 0.1]], equip: [] },
  { name: "Cumeeira / remate de cobertura", category: "Coberturas", outputUnit: "ml", labour: [["Carpinteiro B", 0.3]], mats: [["Cumeeira metálica", 1.05]], equip: [] },

  // ---- Redes de Águas e Esgotos ----
  { name: "Tubagem uPVC Ø110mm assente (esgotos)", category: "Redes de Águas e Esgotos", outputUnit: "ml", labour: [["Canalizador", 0.5], ["Servente", 0.5]], mats: [["Tubo uPVC Ø110mm", 1.05], ["Acessórios uPVC (colarinhos, curvas, sifões)", 0.3]], equip: [] },
  { name: "Tubagem uPVC Ø40mm assente (esgotos)", category: "Redes de Águas e Esgotos", outputUnit: "ml", labour: [["Canalizador", 0.4], ["Servente", 0.4]], mats: [["Tubo uPVC Ø40mm", 1.05], ["Acessórios uPVC (colarinhos, curvas, sifões)", 0.2]], equip: [] },
  { name: "Tubo de queda PVC Ø80mm montado (pluviais)", category: "Redes de Águas e Esgotos", outputUnit: "m", labour: [["Canalizador", 0.4], ["Servente", 0.3]], mats: [["Tubo PVC Ø80mm (queda)", 1.05], ["Acessórios uPVC (colarinhos, curvas, sifões)", 0.2]], equip: [] },
  { name: "Ponto de água (canalização) instalado", category: "Redes de Águas e Esgotos", outputUnit: "un", labour: [["Canalizador", 1.5]], mats: [["Tubo PPR 20mm (água)", 6], ["Acessórios de canalização (água)", 1], ["Torneira/registo", 1]], equip: [] },
  { name: "Caixa de visita de esgotos montada", category: "Redes de Águas e Esgotos", outputUnit: "un", labour: [["Canalizador", 1.0], ["Servente", 2.0]], mats: [["Caixa de visita pré-fabricada", 1.0], ["Cimento (saco 50kg)", 1], ["Areia grossa", 0.05]], equip: [] },
  { name: "Rede de distribuição de água fria (tubo PPR Ø20mm)", category: "Redes de Águas e Esgotos", outputUnit: "ml", labour: [["Canalizador", 0.3], ["Servente", 0.2]], mats: [["Tubo PPR 20mm (água)", 1.05], ["Acessórios de canalização (água)", 0.3]], equip: [] },

  // ---- Aparelhos Sanitários ----
  { name: "Sanita completa montada (com autoclismo)", category: "Aparelhos Sanitários", outputUnit: "un", labour: [["Canalizador", 2.0], ["Servente", 1.0]], mats: [["Sanita completa com autoclismo (kit)", 1]], equip: [] },
  { name: "Lavatório com torneira montado", category: "Aparelhos Sanitários", outputUnit: "un", labour: [["Canalizador", 1.2], ["Servente", 0.5]], mats: [["Lavatório com torneira (kit)", 1]], equip: [] },
  { name: "Chuveiro com misturadora montado", category: "Aparelhos Sanitários", outputUnit: "un", labour: [["Canalizador", 1.5], ["Servente", 0.5]], mats: [["Chuveiro com misturadora (kit)", 1]], equip: [] },
  { name: "Pia de cozinha com torneira montada", category: "Aparelhos Sanitários", outputUnit: "un", labour: [["Canalizador", 1.3], ["Servente", 0.5]], mats: [["Pia de cozinha inox com torneira (kit)", 1]], equip: [] },
  { name: "Tanque de lavandaria com torneira montado", category: "Aparelhos Sanitários", outputUnit: "un", labour: [["Canalizador", 1.0], ["Servente", 0.5]], mats: [["Tanque de lavandaria com torneira (kit)", 1]], equip: [] },
  { name: "Reservatório de água instalado (500L, com suportes)", category: "Aparelhos Sanitários", outputUnit: "un", labour: [["Canalizador", 3.0], ["Servente", 3.0]], mats: [["Reservatório de água 500L com suportes (kit)", 1]], equip: [] },

  // ---- Instalações Eléctricas ----
  { name: "Ponto de electricidade (tomada/interruptor)", category: "Instalações Eléctricas", outputUnit: "un", labour: [["Electricista", 1.2]], mats: [["Cabo eléctrico 2.5mm²", 8], ["Tomada/interruptor", 1]], equip: [] },
  { name: "Ponto de iluminação com luminária", category: "Instalações Eléctricas", outputUnit: "un", labour: [["Electricista", 1.5]], mats: [["Cabo eléctrico 2.5mm²", 6], ["Luminária LED", 1]], equip: [] },
  { name: "Quadro eléctrico parcial montado", category: "Instalações Eléctricas", outputUnit: "un", labour: [["Electricista", 4.0]], mats: [["Quadro eléctrico parcial", 1], ["Disjuntores e acessórios eléctricos", 1]], equip: [] },
];

async function ensureExtraLabour() {
  for (const cat of EXTRA_LABOUR) {
    const [existing] = await db
      .select()
      .from(labourCategories)
      .where(and(eq(labourCategories.name, cat.name), isNull(labourCategories.companyId)))
      .limit(1);
    if (existing) continue;
    const hourlyRate = computeHourlyRate(cat.monthlySalary, WORKING_DAYS, WORKING_HOURS);
    await db.insert(labourCategories).values({
      companyId: null,
      name: cat.name,
      monthlySalary: cat.monthlySalary.toString(),
      hourlyRate: hourlyRate.toString(),
      currency: "MZN",
    });
  }
}

async function ensureExtraMaterials() {
  for (const m of EXTRA_MATERIALS) {
    const [existing] = await db
      .select()
      .from(materials)
      .where(and(eq(materials.name, m.name), isNull(materials.companyId)))
      .limit(1);
    if (existing) {
      if (
        (m.category && existing.category !== m.category) ||
        (m.specification && existing.specification !== m.specification)
      ) {
        await db
          .update(materials)
          .set({
            category: m.category ?? existing.category,
            specification: m.specification ?? existing.specification,
          })
          .where(eq(materials.id, existing.id));
      }
      continue;
    }
    await db.insert(materials).values({
      companyId: null,
      name: m.name,
      category: m.category ?? "Outros",
      specification: m.specification ?? null,
      unit: m.unit,
      baseUnitCost: m.baseUnitCost.toString(),
      importFactor: (m.importFactor ?? 1).toString(),
      currency: "MZN",
      purchasePackageLabel: m.purchasePackage?.label ?? null,
      purchasePackageQty: m.purchasePackage ? m.purchasePackage.qty.toString() : null,
    });
  }
}

async function lookupIds() {
  const [labourRows, materialRows, equipmentRows] = await Promise.all([
    db.select().from(labourCategories).where(isNull(labourCategories.companyId)),
    db.select().from(materials).where(isNull(materials.companyId)),
    db.select().from(equipment).where(isNull(equipment.companyId)),
  ]);
  return {
    labour: new Map(labourRows.map((r) => [r.name, r.id])),
    material: new Map(materialRows.map((r) => [r.name, r.id])),
    equip: new Map(equipmentRows.map((r) => [r.name, r.id])),
  };
}

export async function seedCompositions() {
  await ensureExtraLabour();
  await ensureExtraMaterials();
  const ids = await lookupIds();

  let created = 0;
  let updated = 0;
  for (const spec of COMPOSITIONS) {
    const [existing] = await db
      .select()
      .from(costCompositions)
      .where(and(eq(costCompositions.name, spec.name), isNull(costCompositions.companyId)))
      .limit(1);

    if (existing) {
      // Já existia de uma ronda de seed anterior (sem categoria) — actualiza a categoria.
      if (existing.category !== spec.category) {
        await db.update(costCompositions).set({ category: spec.category }).where(eq(costCompositions.id, existing.id));
        updated++;
      }
      continue;
    }

    const [composition] = await db
      .insert(costCompositions)
      .values({ companyId: null, name: spec.name, category: spec.category, outputUnit: spec.outputUnit, currency: "MZN" })
      .returning();

    for (const [name, qty] of spec.labour) {
      const refId = ids.labour.get(name);
      if (!refId) throw new Error(`Categoria de mão-de-obra em falta no seed: ${name}`);
      await db.insert(compositionLabourLines).values({ compositionId: composition.id, labourCategoryId: refId, qtyPerUnit: qty.toString() });
    }
    for (const [name, qty] of spec.mats) {
      const refId = ids.material.get(name);
      if (!refId) throw new Error(`Material em falta no seed: ${name}`);
      await db.insert(compositionMaterialLines).values({ compositionId: composition.id, materialId: refId, qtyPerUnit: qty.toString() });
    }
    for (const [name, qty] of spec.equip) {
      const refId = ids.equip.get(name);
      if (!refId) throw new Error(`Equipamento em falta no seed: ${name}`);
      await db.insert(compositionEquipmentLines).values({ compositionId: composition.id, equipmentId: refId, qtyPerUnit: qty.toString() });
    }
    created++;
  }
  console.log(`biblioteca de composições: ${created} novas, ${updated} categorias actualizadas (total no ficheiro: ${COMPOSITIONS.length})`);
}

async function main() {
  await seedCompositions();
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
