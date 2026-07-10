import { describe, expect, it } from "vitest";
import { extractHttpUrlsFromBash } from "./bash-policy.js";

describe("extractHttpUrlsFromBash", () => {
  it("extracts http(s) URLs from curl commands", () => {
    expect(extractHttpUrlsFromBash('curl -s https://api.example.com/data')).toEqual([
      "https://api.example.com/data",
    ]);
    expect(
      extractHttpUrlsFromBash('curl https://a.com && curl https://b.com'),
    ).toEqual(["https://a.com", "https://b.com"]);
  });
});
