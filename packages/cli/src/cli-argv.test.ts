import { describe, expect, it } from "vitest";
import { normalizeCliArgv } from "./cli-argv.js";

describe("normalizeCliArgv", () => {
  it("rewrites literal -debug to --debug", () => {
    expect(normalizeCliArgv(["node", "kako", "-debug"])).toEqual([
      "node",
      "kako",
      "--debug",
    ]);
  });

  it("leaves --debug and other flags alone", () => {
    expect(normalizeCliArgv(["node", "kako", "chat", "--debug", "-C", "/tmp"])).toEqual([
      "node",
      "kako",
      "chat",
      "--debug",
      "-C",
      "/tmp",
    ]);
  });

  it("does not rewrite -debugish or values", () => {
    expect(normalizeCliArgv(["node", "kako", "-debugish", "--cwd", "-debug"])).toEqual([
      "node",
      "kako",
      "-debugish",
      "--cwd",
      "--debug",
    ]);
  });
});
