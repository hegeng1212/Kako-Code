import { describe, expect, it } from "vitest";
import { parseMemoryFlushPayload } from "./flush-schema.js";

describe("parseMemoryFlushPayload", () => {
  it("parses valid JSON with Option A goal", () => {
    const payload = parseMemoryFlushPayload(
      JSON.stringify({
        l1: {
          Goal: "Ship Option A path layout",
          "Decisions+Why": "Chose Option A for simplicity",
          "Files touched": "a.ts",
          "Open questions": "(none)",
          Next: "Write tests",
        },
        facts: [{ action: "ADD", content: "Prefer Option A", confidence: 0.7, reason: "stated" }],
        pins: ["/tmp/option-a.ts"],
      }),
    );
    expect(payload?.l1.Goal).toContain("Option A");
    expect(payload?.pins).toEqual(["/tmp/option-a.ts"]);
    expect(payload?.facts[0]?.action).toBe("ADD");
  });

  it("accepts fenced JSON and rejects garbage", () => {
    const fenced = parseMemoryFlushPayload(
      '```json\n{"l1":{"Goal":"G","Decisions+Why":"D","Files touched":"F","Open questions":"O","Next":"N"},"facts":[],"pins":[]}\n```',
    );
    expect(fenced?.l1.Goal).toBe("G");
    expect(parseMemoryFlushPayload("not json")).toBeNull();
  });
});
