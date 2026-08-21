import { describe, expect, it } from "vitest";
import { auditSecurityHeaders, SECURITY_HEADERS } from "../src/services/httpSecurity.js";
import { buildUploadsBackupManifest } from "../src/services/backupManifest.js";

describe("release gates — segurança e backup", () => {
  it("audit de security headers detecta conjunto completo", () => {
    const headers = Object.fromEntries(Object.entries(SECURITY_HEADERS).map(([k, v]) => [k.toLowerCase(), v]));
    const audit = auditSecurityHeaders(headers);
    expect(audit.ok).toBe(true);
    expect(audit.missing).toHaveLength(0);
  });

  it("backup manifest lista categorias de uploads", async () => {
    const manifest = await buildUploadsBackupManifest();
    expect(manifest.uploadsRoot).toBeTruthy();
    expect(Array.isArray(manifest.categories)).toBe(true);
    expect(manifest.categories.some((c) => c.name === "plants")).toBe(true);
    expect(manifest.notes.length).toBeGreaterThan(0);
  });
});
