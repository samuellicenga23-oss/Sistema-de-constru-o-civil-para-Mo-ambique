import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOfflineOutbox,
  dequeueOfflineDraft,
  enqueueOfflineDraft,
  flushOfflineOutboxOnOnline,
  listPendingOfflineDrafts,
} from "../src/lib/offlineOutbox";

describe("offline outbox", () => {
  beforeEach(async () => {
    await clearOfflineOutbox();
  });

  afterEach(async () => {
    await clearOfflineOutbox();
  });

  it("enfileira e remove rascunhos de diário", async () => {
    const item = await enqueueOfflineDraft({
      kind: "diary_draft",
      projectId: "proj-1",
      payload: { workDone: "Betão lançado" },
      idempotencyKey: "idem-1",
    });
    expect(item.id).toBeTruthy();
    expect(item.kind).toBe("diary_draft");

    const pending = await listPendingOfflineDrafts("proj-1");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload.workDone).toBe("Betão lançado");

    const removed = await dequeueOfflineDraft(item.id);
    expect(removed).toBe(true);
    expect(await listPendingOfflineDrafts("proj-1")).toHaveLength(0);
  });

  it("rejeita tipos financeiros ou de aprovação", async () => {
    await expect(
      enqueueOfflineDraft({ kind: "payment", projectId: "p", payload: {} }),
    ).rejects.toThrow(/não permitido offline/i);
    await expect(
      enqueueOfflineDraft({ kind: "approval", projectId: "p", payload: {} }),
    ).rejects.toThrow(/não permitido offline/i);
  });

  it("flush-on-online é stub sem remover fila", async () => {
    await enqueueOfflineDraft({
      kind: "observation_draft",
      projectId: "proj-2",
      payload: { note: "Fissura detectada" },
    });
    const result = await flushOfflineOutboxOnOnline();
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(1);
  });
});
