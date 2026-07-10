import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSecurityPolicy } from "./policy-store.js";
import { isPathWithinRoots, resolveSafePath } from "./workspace-guard.js";
import { withTempDir } from "../tools/builtin/test-helpers.js";

function policyFor(cwd: string, extra?: { trusted?: string[]; denied?: string[] }) {
  return normalizeSecurityPolicy(
    {
      version: 1,
      workspace: {
        trustedRoots: extra?.trusted ?? [cwd],
        deniedRoots: extra?.denied ?? [],
        outsidePolicy: "deny",
      },
      capabilities: { default: "WorkspaceWrite" },
      approval: { byRisk: {}, unknownRiskPolicy: "onRequest" },
      bash: { safeTier: "never", riskyTier: "onRequest", dangerousTier: "deny" },
      delete: { protectBulk: true },
      secrets: { redactPatterns: [], redactEnvKeys: [] },
      resources: {
        bashTimeoutMs: 120_000,
        bashMaxTimeoutMs: 600_000,
        bashMaxOutputBytes: 10_485_760,
      },
      bypass: {
        secretsEnforced: true,
        networkEnforced: true,
        workspaceDenyEnforced: true,
      },
    },
    cwd,
  );
}

describe("workspace-guard", () => {
  it("allows paths within trusted roots", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "src"), { recursive: true });
      const policy = policyFor(dir);
      const check = await resolveSafePath(dir, join(dir, "src/a.ts"), policy);
      expect(check.allowed).toBe(true);
    });
  });

  it("rejects paths outside trusted roots", async () => {
    await withTempDir(async (dir) => {
      const policy = policyFor(dir);
      const check = await resolveSafePath(dir, "/etc/passwd", policy);
      expect(check.allowed).toBe(false);
      expect(check.violation).toMatch(/outside workspace/i);
    });
  });

  it("rejects denied roots", async () => {
    await withTempDir(async (dir) => {
      const denied = join(dir, "secret-config");
      await mkdir(denied, { recursive: true });
      const policy = policyFor(dir, { denied: [denied] });
      const check = await resolveSafePath(dir, join(denied, "keys.json"), policy);
      expect(check.allowed).toBe(false);
      expect(check.inDenied).toBe(true);
    });
  });

  it("isPathWithinRoots handles parent traversal", () => {
    const root = "/tmp/project";
    expect(isPathWithinRoots("/tmp/project/src/a.ts", [root])).toBe(true);
    expect(isPathWithinRoots("/tmp/other/a.ts", [root])).toBe(false);
  });
});
