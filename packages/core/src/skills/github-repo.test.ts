import { describe, expect, it } from "vitest";
import { parseGithubRepoUrl } from "./github-repo.js";

describe("parseGithubRepoUrl", () => {
  it("parses standard repo URL", () => {
    expect(parseGithubRepoUrl("https://github.com/obra/superpowers")).toEqual({
      owner: "obra",
      repo: "superpowers",
      branch: undefined,
    });
  });

  it("parses tree URL with branch", () => {
    expect(parseGithubRepoUrl("https://github.com/obra/superpowers/tree/main")).toEqual({
      owner: "obra",
      repo: "superpowers",
      branch: "main",
    });
  });
});
