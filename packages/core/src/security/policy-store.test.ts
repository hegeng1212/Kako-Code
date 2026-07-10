import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySecuritySettingsPatch,
  inheritedTrustedRoots,
  loadSecurityPolicy,
  saveSecurityPolicy,
  toSecuritySettingsFile,
} from "./policy-store.js";

describe("security settings file", () => {
  let tempHome = "";
  const prevKakoHome = process.env.KAKO_HOME;

  afterEach(async () => {
    process.env.KAKO_HOME = prevKakoHome;
    if (tempHome) await rm(tempHome, { recursive: true, force: true });
  });

  it("merges inherited and extra trusted roots at runtime", async () => {
    tempHome = await mkdtemp(join(tmpdir(), "kako-sec-policy-"));
    process.env.KAKO_HOME = tempHome;
    await mkdir(join(tempHome, "config"), { recursive: true });

    const cwd = "/tmp/project";
    const inherited = inheritedTrustedRoots(cwd);
    const policy = await loadSecurityPolicy(cwd);
    const patched = applySecuritySettingsPatch(
      policy,
      {
        version: 1,
        capabilities: { default: "WorkspaceWrite" },
        workspace: {
          outsidePolicy: "approve",
          extraTrustedRoots: ["/extra/path"],
        },
      },
      cwd,
    );

    expect(patched.workspace.extraTrustedRoots).toEqual(["/extra/path"]);
    expect(patched.workspace.trustedRoots).toEqual(
      expect.arrayContaining([...inherited, "/extra/path"]),
    );
  });

  it("persists only extra trusted roots to security.json", async () => {
    tempHome = await mkdtemp(join(tmpdir(), "kako-sec-policy-"));
    process.env.KAKO_HOME = tempHome;
    await mkdir(join(tempHome, "config"), { recursive: true });

    const cwd = "/tmp/project";
    const policy = await loadSecurityPolicy(cwd);
    const patched = applySecuritySettingsPatch(
      policy,
      {
        version: 1,
        capabilities: { default: "ReadOnly" },
        workspace: {
          outsidePolicy: "deny",
          extraTrustedRoots: ["/custom/root"],
        },
      },
      cwd,
    );
    await saveSecurityPolicy(patched);

    const text = await readFile(join(tempHome, "config", "security.json"), "utf8");
    const saved = JSON.parse(text) as { workspace: { trustedRoots?: string[]; extraTrustedRoots?: string[] } };
    expect(saved.workspace.extraTrustedRoots).toEqual(["/custom/root"]);
    expect(saved.workspace.trustedRoots).toBeUndefined();
  });

  it("defaults capability to FullAccess for fresh policy", async () => {
    const cwd = "/tmp/project";
    const policy = await loadSecurityPolicy(cwd);
    expect(policy.capabilities.default).toBe("FullAccess");
  });

  it("preserves FullAccess in settings patch", async () => {
    const cwd = "/tmp/project";
    const policy = await loadSecurityPolicy(cwd);
    const patched = applySecuritySettingsPatch(
      policy,
      {
        version: 1,
        capabilities: { default: "FullAccess" },
        workspace: { outsidePolicy: "approve", extraTrustedRoots: [] },
      },
      cwd,
    );
    expect(patched.capabilities.default).toBe("FullAccess");
  });

  it("exposes inherited and extra roots for settings UI", async () => {
    const cwd = "/tmp/project";
    const inherited = inheritedTrustedRoots(cwd);
    const policy = await loadSecurityPolicy(cwd);
    const view = toSecuritySettingsFile(
      applySecuritySettingsPatch(policy, {
        version: 1,
        capabilities: { default: "WorkspaceWrite" },
        workspace: { outsidePolicy: "approve", extraTrustedRoots: ["/extra/path"] },
      }, cwd),
      cwd,
    );

    expect(view.workspace.inheritedTrustedRoots).toEqual(inherited);
    expect(view.workspace.extraTrustedRoots).toEqual(["/extra/path"]);
  });
});
