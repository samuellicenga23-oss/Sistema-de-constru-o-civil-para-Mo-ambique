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

describe("código igual / composição não confiável", () => {
  it("marca código igual com domínio diferente como não confiável", async () => {
    const { catalogCompositionUntrusted } = await import("../src/services/measurementImport.js");
    expect(
      catalogCompositionUntrusted(
        "Pintura de paredes interiores com tinta óleo",
        "Cobertura em chapa metálica ondulada",
        "Cobertura em chapa zincada",
      ),
    ).toBe(true);
  });

  it("aceita código igual com descrição alinhada", async () => {
    const { catalogCompositionUntrusted } = await import("../src/services/measurementImport.js");
    expect(
      catalogCompositionUntrusted(
        "Cobertura em chapa metálica ondulada",
        "Cobertura em chapa metálica ondulada tipo IBR",
        "Cobertura em chapa zincada",
      ),
    ).toBe(false);
  });

  it("extrai snapshot estável das linhas do preview", async () => {
    const { parsedRowsFromPreview } = await import("../src/services/measurementImport.js");
    const snap = parsedRowsFromPreview({
      rows: [
        {
          rowKey: "PDF|1|10.2",
          sheet: "PDF",
          rowNumber: 1,
          code: "10.2",
          quantity: 12,
          description: "Pintura interior",
          unitRaw: "m2",
          unit: "m2",
          scope: "",
          unitPrice: null,
          action: "map",
          targetCode: "10.2",
          targetItemId: null,
          targetDescription: "Pintura interior",
          matchMethod: "code",
          confidence: 0.45,
          note: "x",
          compositionName: null,
          compositionId: null,
          priceSource: "composition",
          codeCollision: true,
          needsReview: true,
          willCreateComposition: false,
        },
      ],
      catalog: [],
      compositionOptions: [],
      aiUsed: false,
      aiError: null,
      rowsRead: 1,
    });
    expect(snap).toEqual([
      {
        rowKey: "PDF|1|10.2",
        sheet: "PDF",
        rowNumber: 1,
        code: "10.2",
        quantity: 12,
        description: "Pintura interior",
        unitRaw: "m2",
        unit: "m2",
        scope: "",
        unitPrice: null,
      },
    ]);
  });
});

describe("memória de importação", () => {
  it("gera chaves estáveis por código+descrição e por descrição", async () => {
    const { importMappingCodeDescKey, importMappingDescriptionKey, lookupImportMemory } = await import(
      "../src/services/importCompositionMemory.js"
    );
    expect(importMappingCodeDescKey("10.2", "Pintura de paredes")).toBe(importMappingCodeDescKey("10,2", "pintura de paredes"));
    expect(importMappingDescriptionKey("Pintura interior")).toMatch(/^d:pintura interior$/);

    const memory = {
      byKey: new Map([
        [
          importMappingCodeDescKey("10.2", "Pintura de paredes"),
          { compositionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", compositionName: "Pintura acrílica", matchKey: "x" },
        ],
      ]),
    };
    expect(lookupImportMemory(memory, "10.2", "Pintura de paredes")?.compositionName).toBe("Pintura acrílica");
    expect(lookupImportMemory(memory, "99", "Outra coisa")).toBeNull();
  });
});
