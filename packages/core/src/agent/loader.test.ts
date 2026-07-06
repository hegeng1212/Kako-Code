import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { findAgentsDir, loadAgent } from "./loader.js";

describe("findAgentsDir", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses project agents/ when present", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-agents-"));
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir);
    await writeFile(join(agentsDir, "main.yaml"), "name: main\n", "utf-8");

    const found = await findAgentsDir(tempDir);
    expect(found).toBe(agentsDir);
  });

  it("falls back to bundled monorepo agents", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kako-no-agents-"));
    const found = await findAgentsDir(tempDir);
    expect(found.endsWith("agents")).toBe(true);

    const agent = await loadAgent("main", tempDir);
    expect(agent.name).toBe("main");
  });
});
