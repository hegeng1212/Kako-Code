import { describe, expect, it } from "vitest";
import { parseMacScutilProxy, resolveProxyUrlFromEnv } from "./proxy-fetch.js";

describe("resolveProxyUrlFromEnv", () => {
  it("reads KAKO_PROXY before generic env vars", () => {
    const prev = { ...process.env };
    process.env.KAKO_PROXY = "http://127.0.0.1:7890";
    process.env.HTTPS_PROXY = "http://other:8080";
    expect(resolveProxyUrlFromEnv()).toBe("http://127.0.0.1:7890");
    process.env = prev;
  });
});

describe("parseMacScutilProxy", () => {
  it("parses enabled HTTP proxy from scutil output", () => {
    const stdout = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
}`;
    expect(parseMacScutilProxy(stdout)).toBe("http://127.0.0.1:7890");
  });

  it("returns undefined when proxy disabled", () => {
    expect(parseMacScutilProxy("HTTPEnable : 0")).toBeUndefined();
  });
});
