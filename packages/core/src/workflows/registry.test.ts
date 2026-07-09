import { describe, expect, it } from "vitest";
import { findBundledWorkflowsDir } from "../config/bundled-assets.js";
import { loadWorkflowTemplate, loadWorkflowTemplateSource } from "./registry.js";

describe("loadWorkflowTemplate", () => {
  it("loads bundled deep-research template from monorepo or install root", async () => {
    const dir = await findBundledWorkflowsDir();
    expect(dir).toBeDefined();

    const template = await loadWorkflowTemplate("deep-research");
    expect(template.meta.name).toBe("deep-research");
    expect(template.meta.description).toContain("research");
    expect(template.templatePath).toContain("deep-research.js");
  });

  it("loads template source without copyFile", async () => {
    const loaded = await loadWorkflowTemplateSource("deep-research");
    expect(loaded.source).toContain("export const meta");
    expect(loaded.meta.name).toBe("deep-research");
  });
});
