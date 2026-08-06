import { describe, expect, it } from "vitest";
import {
  constructionDomainsConflict,
  detectConstructionDomains,
  primaryConstructionDomain,
} from "@sigo/shared";
import { mapDescriptionToSigoComposition } from "../src/services/sigoCompositionMap.js";

describe("domínios de construção — anti-colisão", () => {
  it("detecta pintura vs cobertura", () => {
    expect(primaryConstructionDomain("Pintura de paredes interiores e tecto falso")).toBe("pintura");
    expect(primaryConstructionDomain("Cobertura em chapa metálica ondulada")).toBe("cobertura");
    expect(
      constructionDomainsConflict(
        "Pintura de paredes interiores com tinta óleo",
        "Cobertura em chapa metálica ondulada",
      ),
    ).toBe(true);
  });

  it("detecta muro vs sanita", () => {
    expect(detectConstructionDomains("contrução de murro de vedacao com blocos")).toContain("alvenaria");
    expect(
      constructionDomainsConflict(
        "contrução de murro de vedacao com blocos de 15cm",
        "Sanita completa com autoclismo",
      ),
    ).toBe(true);
  });

  it("detecta ligação eléctrica vs fossa", () => {
    expect(primaryConstructionDomain("Pagamento do contrato de ligacao da corrente electrica")).toBe(
      "ligacao_utilidade",
    );
    expect(
      constructionDomainsConflict(
        "Pagamento do contrato de ligacao da corrente electrica",
        "Fossa séptica pré-fabricada instalada",
      ),
    ).toBe(true);
  });
});

describe("mapeamento SIGO — casos do mapa de qty", () => {
  it("mapeia pintura interior para composição de pintura", () => {
    const hit = mapDescriptionToSigoComposition(
      "Pintura de paredes interiores e tecto falso com tinta óleo",
      "m2",
    );
    expect(hit?.compositionName).toMatch(/Pintura|esmalte|acrílica/i);
    expect(hit?.compositionName).not.toMatch(/Cobertura|chapa/i);
  });

  it("mapeia muro/vedação (com typo murro)", () => {
    const hit = mapDescriptionToSigoComposition(
      "contrução de murro de vedacao com blocos de 15cm, com 200m de extencao",
      "vg",
    );
    expect(hit?.compositionName).toMatch(/Muro|vedação|Alvenaria/i);
    expect(hit?.compositionName).not.toMatch(/Sanita/i);
  });

  it("mapeia ligação eléctrica", () => {
    const hit = mapDescriptionToSigoComposition("Pagamento do contrato de ligacao da corrente electrica", "vg");
    expect(hit?.compositionName).toMatch(/Quadro|eléctri|Rede/i);
    expect(hit?.compositionName).not.toMatch(/Fossa/i);
  });

  it("mapeia ligação de água", () => {
    const hit = mapDescriptionToSigoComposition("Pagamento do contrato de ligacao da agua.", "vg");
    expect(hit?.compositionName).toMatch(/água|Ponto/i);
    expect(hit?.compositionName).not.toMatch(/Vala|fossa|infiltra/i);
  });
});
