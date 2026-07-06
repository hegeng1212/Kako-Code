import { describe, expect, it } from "vitest";
import { loadSkillsManifest, saveSkillsManifest } from "./manifest.js";
import { listInstalledSkills } from "./install.js";
import { withTempDir } from "../tools/builtin/test-helpers.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

describe("listInstalledSkills", () => {
  it("sorts enabled skills before disabled", async () => {
    await withTempDir(async (cwd) => {
      process.env.KAKO_HOME = join(cwd, ".kako");
      await mkdir(join(cwd, ".kako", "config"), { recursive: true });
      await saveSkillsManifest({
        skills: [
          {
            name: "z-disabled",
            description: "",
            source: "local",
            installDir: "/a",
            skillMdPath: "/a/SKILL.md",
            installedAt: "2026-01-01T00:00:00.000Z",
            enabled: false,
          },
          {
            name: "a-enabled",
            description: "",
            source: "local",
            installDir: "/b",
            skillMdPath: "/b/SKILL.md",
            installedAt: "2026-01-01T00:00:00.000Z",
            enabled: true,
          },
        ],
      });

      const skills = await listInstalledSkills();
      expect(skills.map((s) => s.name)).toEqual(["a-enabled", "z-disabled"]);
    });
  });
});

describe("loadSkillsManifest", () => {
  it("returns empty list when missing", async () => {
    await withTempDir(async (cwd) => {
      process.env.KAKO_HOME = join(cwd, ".kako-new");
      const manifest = await loadSkillsManifest();
      expect(manifest.skills).toEqual([]);
    });
  });
});
