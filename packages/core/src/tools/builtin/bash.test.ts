import { describe, expect, it } from "vitest";
import {
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  assertBashInputSupported,
  bashHandler,
  bashToolDefinition,
  resolveBashTimeoutMs,
} from "./bash.js";
import { toolContext, withTempDir } from "./test-helpers.js";

describe("bashToolDefinition", () => {
  it("exposes standard Bash tool schema fields", () => {
    const props = bashToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(
      ["command", "dangerouslyDisableSandbox", "description", "run_in_background", "timeout"].sort(),
    );
    expect(bashToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(bashToolDefinition.inputSchema.required).toEqual(["command"]);
  });

  it("includes operational guidance in description", () => {
    expect(bashToolDefinition.description).toContain("Executes a bash command");
    expect(bashToolDefinition.description).toContain("timeout");
    expect(bashToolDefinition.description).toContain("gh");
    expect(bashToolDefinition.description).toContain("Monitor with an until-loop");
    expect(bashToolDefinition.description).toContain("Co-Authored-By: Kako");
    expect(bashToolDefinition.description).toContain("Generated with Kako");
    expect(bashToolDefinition.description).not.toContain("Claude Opus");
    expect(bashToolDefinition.description).not.toContain("claude.com");
  });
});

describe("resolveBashTimeoutMs", () => {
  it("defaults to 120s", async () => {
    expect(await resolveBashTimeoutMs({})).toBe(BASH_DEFAULT_TIMEOUT_MS);
  });

  it("reads timeout field", async () => {
    expect(await resolveBashTimeoutMs({ timeout: 60_000 })).toBe(60_000);
  });

  it("falls back to legacy timeout_ms", async () => {
    expect(await resolveBashTimeoutMs({ timeout_ms: 45_000 })).toBe(45_000);
  });

  it("caps at max", async () => {
    expect(await resolveBashTimeoutMs({ timeout: 999_999 })).toBe(BASH_MAX_TIMEOUT_MS);
  });
});

describe("assertBashInputSupported", () => {
  it("rejects run_in_background", () => {
    expect(() => assertBashInputSupported({ run_in_background: true })).toThrow(
      /not supported yet/,
    );
  });
});

describe("bashHandler", () => {
  it("runs a simple command and returns stdout", async () => {
    await withTempDir(async (dir) => {
      const out = await bashHandler({ command: "echo hello-kako" }, toolContext(dir));
      expect(out.trim()).toBe("hello-kako");
    });
  });

  it("returns stderr+stdout on non-zero exit when output exists", async () => {
    await withTempDir(async (dir) => {
      const out = await bashHandler(
        { command: "node -e \"console.log('out'); console.error('err'); process.exit(1)\"" },
        toolContext(dir),
      );
      expect(out).toContain("out");
      expect(out).toContain("err");
    });
  });

  it("treats grep with no matches as empty output instead of failure", async () => {
    await withTempDir(async (dir) => {
      const out = await bashHandler(
        { command: "env | grep -i __kako_no_match_xyz__ 2>/dev/null" },
        toolContext(dir),
      );
      expect(out).toBe("(no output)");
    });
  });
});

describe("bashHandler adversarial", () => {
  it("rejects run_in_background before execution", async () => {
    await withTempDir(async (dir) => {
      await expect(
        bashHandler({ command: "echo x", run_in_background: true }, toolContext(dir)),
      ).rejects.toThrow(/not supported yet/);
    });
  });

  it("throws when command fails with no output", async () => {
    await withTempDir(async (dir) => {
      await expect(
        bashHandler({ command: "exit 42" }, toolContext(dir)),
      ).rejects.toThrow();
    });
  });

  it("uses legacy timeout_ms when timeout omitted", async () => {
    expect(await resolveBashTimeoutMs({ timeout_ms: 5_000 })).toBe(5_000);
  });

  it("ignores invalid timeout and falls back to default", async () => {
    expect(await resolveBashTimeoutMs({ timeout: -1 })).toBe(BASH_DEFAULT_TIMEOUT_MS);
    expect(await resolveBashTimeoutMs({ timeout: NaN })).toBe(BASH_DEFAULT_TIMEOUT_MS);
  });
});
