import { afterEach, describe, expect, it } from "vitest";
import {
  DATA_SAVER_STORAGE_KEY,
  getPollingInterval,
  isDataSaverEnabled,
  setDataSaverEnabled,
  shouldSkipHeavyPrefetch,
} from "../src/lib/dataSaver";

describe("dataSaver preference", () => {
  afterEach(() => {
    window.localStorage.removeItem(DATA_SAVER_STORAGE_KEY);
  });

  it("está desligado por omissão", () => {
    expect(isDataSaverEnabled()).toBe(false);
    expect(getPollingInterval(12_000)).toBe(12_000);
    expect(shouldSkipHeavyPrefetch()).toBe(false);
  });

  it("triplica intervalos de polling e bloqueia prefetch pesado", () => {
    setDataSaverEnabled(true);
    expect(isDataSaverEnabled()).toBe(true);
    expect(getPollingInterval(12_000)).toBe(36_000);
    expect(getPollingInterval(60_000)).toBe(180_000);
    expect(shouldSkipHeavyPrefetch()).toBe(true);
  });

  it("pode ser desactivado de novo", () => {
    setDataSaverEnabled(true);
    setDataSaverEnabled(false);
    expect(isDataSaverEnabled()).toBe(false);
    expect(getPollingInterval(45_000)).toBe(45_000);
  });
});
