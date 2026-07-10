import { describe, expect, it } from "vitest";
import {
  anyNetworkRuleMatches,
  matchesNetworkRule,
  normalizeNetworkRule,
  parseNetworkTargetFromUrl,
  validateNetworkRule,
} from "./network.js";

describe("network rules", () => {
  it("validates domain and wildcard rules", () => {
    expect(validateNetworkRule("sina.com")).toBeNull();
    expect(validateNetworkRule("*.sina.com")).toBeNull();
    expect(validateNetworkRule("www.sina.com")).toBeNull();
    expect(validateNetworkRule("bad..com")).not.toBeNull();
  });

  it("validates ipv4, cidr, range, and port rules", () => {
    expect(validateNetworkRule("172.3.7.0")).toBeNull();
    expect(validateNetworkRule("172.12.3.*")).toBeNull();
    expect(validateNetworkRule("172.12.3.0/24")).toBeNull();
    expect(validateNetworkRule("172.12.3.0-172.12.3.255")).toBeNull();
    expect(validateNetworkRule("172.3.4.6:8080")).toBeNull();
  });

  it("matches apex and wildcard domains", () => {
    expect(matchesNetworkRule("sina.com", "www.sina.com")).toBe(true);
    expect(matchesNetworkRule("sina.com", "sina.com")).toBe(true);
    expect(matchesNetworkRule("sina.com.cn", "api.sina.com.cn")).toBe(true);
    expect(matchesNetworkRule("*.sina.com", "news.sina.com")).toBe(true);
    expect(matchesNetworkRule("*.sina.com", "sina.com")).toBe(false);
    expect(matchesNetworkRule("www.sina.com", "api.sina.com")).toBe(false);
    expect(matchesNetworkRule("www.sina.com", "www.sina.com")).toBe(true);
  });

  it("matches ipv4 patterns and ports", () => {
    expect(matchesNetworkRule("172.12.3.*", "172.12.3.44")).toBe(true);
    expect(matchesNetworkRule("172.12.3.0/24", "172.12.3.200")).toBe(true);
    expect(matchesNetworkRule("172.12.3.0-172.12.3.255", "172.12.3.10")).toBe(true);
    expect(matchesNetworkRule("172.3.4.6:8080", "172.3.4.6", 8080)).toBe(true);
    expect(matchesNetworkRule("172.3.4.6:8080", "172.3.4.6", 80)).toBe(false);
  });

  it("parses url targets with default ports", () => {
    expect(parseNetworkTargetFromUrl("https://example.com/x")).toEqual({
      host: "example.com",
      port: 443,
    });
    expect(parseNetworkTargetFromUrl("http://127.0.0.1:8080")).toEqual({
      host: "127.0.0.1",
      port: 8080,
    });
  });

  it("normalizes rules", () => {
    expect(normalizeNetworkRule("  SINA.com ")).toBe("sina.com");
    expect(normalizeNetworkRule("172.3.4.6:8080")).toBe("172.3.4.6:8080");
  });

  it("matches any rule in a list", () => {
    expect(anyNetworkRuleMatches(["*.sina.com", "172.3.4.6"], "news.sina.com")).toBe(true);
    expect(anyNetworkRuleMatches(["*.sina.com"], "example.com")).toBe(false);
  });
});
