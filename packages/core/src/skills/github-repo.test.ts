import { describe, expect, it } from "vitest";
import { parseGithubRepoUrl } from "./github-repo.js";

describe("parseGithubRepoUrl", () => {
  it("parses standard repo URL", () => {
    expect(parseGithubRepoUrl("https://github.com/obra/superpowers")).toEqual({
      owner: "obra",
      repo: "superpowers",
      branch: undefined,
      subpath: undefined,
    });
  });

  it("parses tree URL with branch", () => {
    expect(parseGithubRepoUrl("https://github.com/obra/superpowers/tree/main")).toEqual({
      owner: "obra",
      repo: "superpowers",
      branch: "main",
      subpath: undefined,
    });
  });

  it("parses tree URL with branch and skill subpath", () => {
    expect(
      parseGithubRepoUrl("https://github.com/obra/superpowers/tree/main/skills/brainstorming"),
    ).toEqual({
      owner: "obra",
      repo: "superpowers",
      branch: "main",
      subpath: "skills/brainstorming",
    });
  });

  it("parses single-skill repo URL", () => {
    expect(parseGithubRepoUrl("https://github.com/op7418/guizang-ppt-skill")).toEqual({
      owner: "op7418",
      repo: "guizang-ppt-skill",
      branch: undefined,
      subpath: undefined,
    });
  });
});
