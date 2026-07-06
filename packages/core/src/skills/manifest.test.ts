import { describe, expect, it } from "vitest";
import { loadSkillsManifest, saveSkillsManifest, setSkillEnabled } from "./manifest.js";
import { withTempDir } from "../tools/builtin/test-helpers.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getInstalledSkillsManifestPath } from "../config/paths.js";

describe("setSkillEnabled", () => {
  it("updates enabled flag on manifest record", async () => {
    await withTempDir(async (cwd) => {
      process.env.KAKO_HOME = join(cwd, ".kako");
      await mkdir(join(cwd, ".kako", "config"), { recursive: true });
      await saveSkillsManifest({
        skills: [
          {
            name: "demo",
            description: "Demo",
            source: "local",
            installDir: "/tmp/demo",
            skillMdPath: "/tmp/demo/SKILL.md",
            installedAt: "2026-01-01T00:00:00.000Z",
            enabled: true,
          },
        ],
      });

      const updated = await setSkillEnabled("demo", false);
      expect(updated?.enabled).toBe(false);
      const manifest = await loadSkillsManifest();
      expect(manifest.skills[0]?.enabled).toBe(false);
    });
  });
});

describe("getInstalledSkillsManifestPath", () => {
  it("points under kako home", () => {
    expect(getInstalledSkillsManifestPath()).toContain("installed-skills.json");
  });
});
