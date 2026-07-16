import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { sessionManager } from "../session/manager.js";
import {
  applySecuritySettingsPatch,
  inheritedTrustedRoots,
  loadSecurityPolicy,
  saveSecurityPolicy,
  saveWorkspaceSecuritySettings,
  toSecuritySettingsFile,
} from "./policy-store.js";

describe("security settings file", () => {
  let tempHome = "";
  const prevKakoHome = process.env.KAKO_HOME;

  afterEach(async () => {
    process.env.KAKO_HOME = prevKakoHome;
    if (tempHome) await rm(tempHome, { recursive: true, force: true });
  });

  async function withTempHome(): Promise<string> {
    tempHome = await mkdtemp(join(tmpdir(), "kako-sec-policy-"));
    process.env.KAKO_HOME = tempHome;
    await mkdir(join(tempHome, "config"), { recursive: true });
    await mkdir(join(tempHome, "index"), { recursive: true });
    return tempHome;
  }

  it("merges inherited and extra trusted roots at runtime", async () => {
    await withTempHome();
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

  it("persists only extra trusted roots to security.json via global save", async () => {
    await withTempHome();
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
    const saved = JSON.parse(text) as {
      workspace: { trustedRoots?: string[]; extraTrustedRoots?: string[] };
    };
    expect(saved.workspace.extraTrustedRoots).toEqual(["/custom/root"]);
    expect(saved.workspace.trustedRoots).toBeUndefined();
  });

  it("defaults capability to FullAccess for fresh policy", async () => {
    await withTempHome();
    const cwd = "/tmp/project";
    const policy = await loadSecurityPolicy(cwd);
    expect(policy.capabilities.default).toBe("FullAccess");
  });

  it("preserves FullAccess in settings patch", async () => {
    await withTempHome();
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
    await withTempHome();
    const cwd = "/tmp/project";
    const inherited = inheritedTrustedRoots(cwd);
    const policy = await loadSecurityPolicy(cwd);
    const view = toSecuritySettingsFile(
      applySecuritySettingsPatch(
        policy,
        {
          version: 1,
          capabilities: { default: "WorkspaceWrite" },
          workspace: { outsidePolicy: "approve", extraTrustedRoots: ["/extra/path"] },
        },
        cwd,
      ),
      cwd,
    );

    expect(view.workspace.inheritedTrustedRoots).toEqual(inherited);
    expect(view.workspace.extraTrustedRoots).toEqual(["/extra/path"]);
  });

  it("isolates workspace security settings by project cwd", async () => {
    await withTempHome();
    const a = join(tempHome, "proj-a");
    const b = join(tempHome, "proj-b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await sessionManager.resolveProject(a);
    await sessionManager.resolveProject(b);

    await saveWorkspaceSecuritySettings(a, {
      version: 1,
      capabilities: { default: "ReadOnly" },
      workspace: { outsidePolicy: "deny", extraTrustedRoots: ["/a-root"] },
    });
    await saveWorkspaceSecuritySettings(b, {
      version: 1,
      capabilities: { default: "FullAccess" },
      workspace: { outsidePolicy: "approve", extraTrustedRoots: [] },
    });

    const policyA = await loadSecurityPolicy(a);
    const policyB = await loadSecurityPolicy(b);
    expect(policyA.capabilities.default).toBe("ReadOnly");
    expect(policyA.workspace.outsidePolicy).toBe("deny");
    expect(policyA.workspace.extraTrustedRoots).toEqual(["/a-root"]);
    expect(policyB.capabilities.default).toBe("FullAccess");
    expect(policyB.workspace.outsidePolicy).toBe("approve");
    expect(policyB.workspace.extraTrustedRoots).toEqual([]);
  });

  it("lazily migrates global workspace fields into project.security on first load", async () => {
    await withTempHome();
    await writeFile(
      join(tempHome, "config", "security.json"),
      `${JSON.stringify(
        {
          version: 1,
          capabilities: { default: "WorkspaceWrite" },
          workspace: { outsidePolicy: "allow", extraTrustedRoots: ["/from-global"] },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    const cwd = join(tempHome, "migrated");
    await mkdir(cwd, { recursive: true });
    await sessionManager.resolveProject(cwd);

    const policy = await loadSecurityPolicy(cwd);
    expect(policy.capabilities.default).toBe("WorkspaceWrite");
    expect(policy.workspace.outsidePolicy).toBe("allow");
    expect(policy.workspace.extraTrustedRoots).toEqual(["/from-global"]);
    expect(await sessionManager.getProjectSecurity(cwd)).toEqual({
      capabilities: { default: "WorkspaceWrite" },
      workspace: { outsidePolicy: "allow", extraTrustedRoots: ["/from-global"] },
    });

    await writeFile(
      join(tempHome, "config", "security.json"),
      `${JSON.stringify(
        {
          version: 1,
          capabilities: { default: "ReadOnly" },
          workspace: { outsidePolicy: "deny", extraTrustedRoots: [] },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    const again = await loadSecurityPolicy(cwd);
    expect(again.capabilities.default).toBe("WorkspaceWrite");
    expect(again.workspace.outsidePolicy).toBe("allow");
  });

  it("saveWorkspaceSecuritySettings does not rewrite global workspace fields", async () => {
    await withTempHome();
    await writeFile(
      join(tempHome, "config", "security.json"),
      `${JSON.stringify(
        {
          version: 1,
          capabilities: { default: "FullAccess" },
          workspace: { outsidePolicy: "approve", extraTrustedRoots: [] },
          bash: { safeTier: "never" },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    const cwd = join(tempHome, "save-proj");
    await mkdir(cwd, { recursive: true });

    await saveWorkspaceSecuritySettings(cwd, {
      version: 1,
      capabilities: { default: "ReadOnly" },
      workspace: { outsidePolicy: "deny", extraTrustedRoots: ["/only-project"] },
    });

    const globalText = await readFile(join(tempHome, "config", "security.json"), "utf8");
    const global = JSON.parse(globalText) as {
      capabilities: { default: string };
      workspace: { outsidePolicy: string; extraTrustedRoots: string[] };
    };
    expect(global.capabilities.default).toBe("FullAccess");
    expect(global.workspace.outsidePolicy).toBe("approve");
    expect(global.workspace.extraTrustedRoots).toEqual([]);

    const loaded = await loadSecurityPolicy(cwd);
    expect(loaded.capabilities.default).toBe("ReadOnly");
    expect(loaded.workspace.outsidePolicy).toBe("deny");
    expect(loaded.workspace.extraTrustedRoots).toEqual(["/only-project"]);
  });
});
