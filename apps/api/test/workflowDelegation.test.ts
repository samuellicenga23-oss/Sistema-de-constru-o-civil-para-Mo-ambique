import { describe, expect, it } from "vitest";
import { isUserAbsent, saveUserDelegationSettings } from "../src/services/workflowDelegation.js";

describe("delegação de workflow tasks", () => {
  it("detecta ausência dentro do intervalo", () => {
    expect(isUserAbsent({ absentFrom: "2026-01-01", absentTo: "2026-12-31" }, "2026-06-15")).toBe(true);
    expect(isUserAbsent({ absentFrom: "2026-01-01", absentTo: "2026-12-31" }, "2025-12-31")).toBe(false);
  });

  it("rejeita delegação para si próprio", async () => {
    const result = await saveUserDelegationSettings({
      userId: "00000000-0000-4000-8000-000000000001",
      companyId: "00000000-0000-4000-8000-000000000002",
      actorUserId: "00000000-0000-4000-8000-000000000001",
      settings: {
        absentFrom: null,
        absentTo: null,
        delegateUserId: "00000000-0000-4000-8000-000000000001",
        delegateTaskTypes: [],
        notificationPrefs: { digestEmail: false },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/si próprio/i);
  });
});
