import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPopularSkillHub, resolveSkillHubInstallSlug } from "./skillhub-client.js";

vi.mock("../net/fetch-with-timeout.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from "../net/fetch-with-timeout.js";

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

describe("fetchPopularSkillHub", () => {
  afterEach(() => {
    vi.mocked(fetchWithTimeout).mockReset();
  });

  it("aggregates search hits and sorts by install count", async () => {
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      const q = new URL(String(url)).searchParams.get("q");
      const skills =
        q === "ai"
          ? [{ slug: "acme/alpha", name: "Alpha", description: "A", totalInstalls: 10 }]
          : [{ slug: "beta", name: "Beta", description: "B", totalInstalls: 50, ownerUsername: "team" }];
      return new Response(JSON.stringify({ skills }), { status: 200 });
    });

    const hits = await fetchPopularSkillHub(5);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.name).toBe("Beta");
    expect(hits[0]?.installSlug).toBe("team/beta");
  });

  it("throws when SkillHub is unreachable", async () => {
    vi.mocked(fetchWithTimeout).mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(fetchPopularSkillHub()).rejects.toThrow(/无法连接 SkillHub/);
  });
});
