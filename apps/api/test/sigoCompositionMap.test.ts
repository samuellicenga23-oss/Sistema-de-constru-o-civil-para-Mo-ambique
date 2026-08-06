import { describe, expect, it } from "vitest";
import {
  isMetalStructureWork,
  isPrimarilyConcreteWork,
  mapDescriptionToSigoComposition,
} from "../src/services/sigoCompositionMap.js";

const TOWER_DESC =
  "Fornecimento e montagem de torre treliçada de base triangular com 12 metros de altura, " +
  "em secções modulares de 3m em cantoneiras de aço galvanizado 30x3 e 25x3, incluindo todos " +
  "os acessórios (anilhas, porcas, contra-porcas) para ancoragem à fundação de betão, e pintura " +
  "com tinta CIN Sintecin sobre primário acrílico.";

describe("mapeamento SIGO — sentido semântico", () => {
  it("reconhece torre treliçada como estrutura metálica, não betão", () => {
    const d = TOWER_DESC.toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
    expect(isMetalStructureWork(d)).toBe(true);
    expect(isPrimarilyConcreteWork(d)).toBe(false);
  });

  it("mapeia torre 11.3.3 para composição metálica, nunca Betão B25", () => {
    const hit = mapDescriptionToSigoComposition(TOWER_DESC, "un");
    expect(hit).not.toBeNull();
    expect(hit!.compositionName).toBe("Estrutura metálica treliçada / torre montada");
    expect(hit!.compositionName).not.toMatch(/Betão|B25/i);
  });

  it("mantém betão estrutural para vigas/pilares reais", () => {
    const hit = mapDescriptionToSigoComposition("Vigas de pavimento em betão armado B25", "m3");
    expect(hit?.compositionName).toBe("Betão B25 (estrutural)");
  });
});
