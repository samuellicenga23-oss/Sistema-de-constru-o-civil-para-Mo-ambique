import { describe, expect, it } from "vitest";
import { resolveProjectFloors } from "../src/services/scheduleFloorDetection.js";

describe("detecção de pisos para o cronograma", () => {
  it("não deixa o valor padrão de um piso ocultar o piso superior detectado", () => {
    const result = resolveProjectFloors(1, ["Piso Térreo", "Piso Superior", "Piso Superior"]);
    expect(result.floors).toBe(2);
    expect(result.labels).toEqual(["Piso térreo", "Piso superior"]);
    expect(result.source).toBe("plant");
  });

  it("ignora cobertura, anexo e pisos por confirmar", () => {
    const result = resolveProjectFloors(2, ["Piso térreo", "Piso 1", "Cobertura", "Anexo", "Piso não identificado"]);
    expect(result.floors).toBe(2);
    expect(result.labels).toEqual(["Piso térreo", "Piso 1"]);
  });

  it("respeita um número maior confirmado no cadastro e completa os nomes", () => {
    const result = resolveProjectFloors(3, ["Rés-do-chão", "Piso 1"]);
    expect(result.floors).toBe(3);
    expect(result.labels).toEqual(["Piso térreo", "Piso 1", "Piso 2"]);
    expect(result.source).toBe("combined");
  });

  it("lê pisos dentro das descrições das medições sem transformar compartimentos em pisos", () => {
    const result = resolveProjectFloors(1, ["Piso 1 — quarto 02", "Piso 2 — varanda", "Cozinha", "WC social"]);
    expect(result.floors).toBe(3);
    expect(result.labels).toEqual(["Piso térreo", "Piso 1", "Piso 2"]);
  });

  it("considera caves e todos os níveis de um edifício alto", () => {
    const result = resolveProjectFloors(1, ["Cave", "Rés-do-chão", ...Array.from({ length: 10 }, (_, index) => `Piso ${index + 1}`)]);
    expect(result.floors).toBe(12);
    expect(result.labels[0]).toBe("Cave");
    expect(result.labels.at(-1)).toBe("Piso 10");
  });
});
