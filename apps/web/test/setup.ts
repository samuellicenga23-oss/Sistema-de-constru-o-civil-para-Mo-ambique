import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// globals:false no vitest.config.ts (import explícito em cada ficheiro de teste, sem poluir o
// espaço global) significa que a limpeza automática do @testing-library/react entre testes não
// se liga sozinha — sem isto, o DOM de um teste ficava visível no seguinte, dentro do mesmo
// ficheiro.
afterEach(() => cleanup());
