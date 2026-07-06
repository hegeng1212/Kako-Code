import { describe, expect, it } from "vitest";
import {
  MONITOR_DEFAULT_TIMEOUT_MS,
  MONITOR_MAX_TIMEOUT_MS,
  assertMonitorSupported,
  monitorHandler,
  monitorToolDefinition,
  parseMonitorInput,
} from "./monitor.js";
import { toolContext } from "./test-helpers.js";

describe("monitorToolDefinition", () => {
  it("matches Claude Code schema and description", () => {
    const props = monitorToolDefinition.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(
      ["command", "description", "persistent", "timeout_ms"].sort(),
    );
    expect(monitorToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(monitorToolDefinition.inputSchema.required).toEqual([
      "description",
      "timeout_ms",
      "persistent",
      "command",
    ]);
    expect(props.timeout_ms?.minimum).toBe(1000);
    expect(props.timeout_ms?.default).toBe(MONITOR_DEFAULT_TIMEOUT_MS);
    expect(props.persistent?.default).toBe(false);
  });

  it("includes operational guidance in description", () => {
    expect(monitorToolDefinition.description).toContain("background monitor");
    expect(monitorToolDefinition.description).toContain("run_in_background");
    expect(monitorToolDefinition.description).toContain("silence is not success");
    expect(monitorToolDefinition.description).toContain("TaskStop");
    expect(monitorToolDefinition.description).toContain("--line-buffered");
    expect(monitorToolDefinition.description).not.toContain("Claude Code");
  });
});

describe("parseMonitorInput", () => {
  it("parses required fields with defaults", () => {
    expect(
      parseMonitorInput({
        command: "tail -f log",
        description: "errors in deploy.log",
        timeout_ms: 300_000,
        persistent: false,
      }),
    ).toEqual({
      command: "tail -f log",
      description: "errors in deploy.log",
      persistent: false,
      timeoutMs: 300_000,
    });
  });

  it("caps timeout at max", () => {
    expect(
      parseMonitorInput({
        command: "echo x",
        description: "x",
        timeout_ms: 9_999_999,
        persistent: false,
      }).timeoutMs,
    ).toBe(MONITOR_MAX_TIMEOUT_MS);
  });

  it("rejects missing command or description", () => {
    expect(() =>
      parseMonitorInput({ description: "x", timeout_ms: 1000, persistent: false }),
    ).toThrow(/requires command/);
    expect(() =>
      parseMonitorInput({ command: "echo x", timeout_ms: 1000, persistent: false }),
    ).toThrow(/requires description/);
  });
});

describe("monitorHandler", () => {
  it("rejects before starting a monitor", async () => {
    await expect(
      monitorHandler(
        {
          command: "tail -f log",
          description: "errors",
          timeout_ms: 60_000,
          persistent: false,
        },
        toolContext("/tmp"),
      ),
    ).rejects.toThrow(/not supported yet/);
  });
});

describe("assertMonitorSupported", () => {
  it("always throws", () => {
    expect(() => assertMonitorSupported()).toThrow(/not supported yet/);
  });
});
