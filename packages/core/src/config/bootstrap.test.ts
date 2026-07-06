import { access } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeKakoHome } from "./bootstrap.js";
import { getAgentsDir, getConfigDir, getGlobalKakoMdPath, getSkillsDir } from "./paths.js";

describe("initializeKakoHome", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-bootstrap-"));
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    delete process.env.KAKO_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("creates standard layout and seeds agents", async () => {
    const result = await initializeKakoHome();
    expect(result.home).toBe(home);

    await access(join(getConfigDir(), "skills.yaml"));
    await access(join(getAgentsDir(), "main.yaml"));
    await access(getGlobalKakoMdPath());
    await access(join(getSkillsDir(), "brainstorming", "SKILL.md"));
  });
});
