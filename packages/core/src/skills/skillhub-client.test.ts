import { describe, expect, it } from "vitest";
import { resolveSkillHubInstallSlug } from "./skillhub-client.js";

describe("resolveSkillHubInstallSlug", () => {
  it("passes through full slug", () => {
    expect(resolveSkillHubInstallSlug("anthropics/docx")).toBe("anthropics/docx");
  });

  it("builds slug from sourceIdentifier", () => {
    expect(
      resolveSkillHubInstallSlug("docx", { sourceIdentifier: "anthropics/skills" }),
    ).toBe("anthropics/docx");
  });

  it("prefers ownerUsername over sourceIdentifier", () => {
    expect(
      resolveSkillHubInstallSlug("gstack", {
        ownerUsername: "garrytan",
        sourceIdentifier: "garrytan/gstack",
      }),
    ).toBe("garrytan/gstack");
  });

  it("throws when slug is short and no hints", () => {
    expect(() => resolveSkillHubInstallSlug("docx")).toThrow(/username\/skill-name/);
  });
});
