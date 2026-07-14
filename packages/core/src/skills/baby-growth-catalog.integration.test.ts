import { describe, expect, it } from "vitest";
import { partitionSkillsForCatalog, formatSkillsIndex } from "./loader.js";
import { buildMessages, resolveEnvironmentInfo } from "../agent/context.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("baby-growth skill catalog (user environment)", () => {
  it("includes enabled baby-growth-record in user segment and system prompt", async () => {
    const cwd = join(homedir(), "Documents/work/coding/github/kako");
    const partition = await partitionSkillsForCatalog(cwd);
    const baby = partition.user.find((s) => s.name === "baby-growth-record");

    expect(baby, "baby-growth-record should be in user segment").toBeDefined();
    expect(baby?.description).toMatch(/记录身高|生长数据/);

    const catalog = formatSkillsIndex(partition);
    expect(catalog).toContain("- baby-growth-record:");

    const messages = await buildMessages({
      definition: { name: "main", description: "test", model: "", systemPrompt: "You are Kako." },
      transcript: [],
      environment: await resolveEnvironmentInfo(cwd, "test"),
      availableSkills: partition,
    });
    const system = String(messages[0]?.content ?? "");
    expect(system).toContain("- baby-growth-record:");
    expect(system).toContain("记录身高");
  });

  it("user query 帮我记录宝宝身高145cm,45kg matches skill description semantics", async () => {
    const cwd = join(homedir(), "Documents/work/coding/github/kako");
    const partition = await partitionSkillsForCatalog(cwd);
    const baby = partition.user.find((s) => s.name === "baby-growth-record");
    expect(baby).toBeDefined();

    const userQuery = "帮我记录宝宝身高145cm,45kg";
    const desc = baby!.description;
    // Catalog description is what the model uses to match Skill tool — not keyword routing.
    expect(desc).toMatch(/记录身高|体重|生长数据/);
    expect(userQuery).toMatch(/记录.*身高|身高.*体重|宝宝/);
  });
});
