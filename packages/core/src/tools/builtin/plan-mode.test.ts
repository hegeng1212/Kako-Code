import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolExecutionContext } from "@kako/shared";
import { enterPlanModeHandler, enterPlanModeToolDefinition } from "./enter-plan-mode.js";
import { exitPlanModeHandler, exitPlanModeToolDefinition } from "./exit-plan-mode.js";
import {
  parseAllowedPrompts,
  parseExitPlanModeInput,
  planFilePathForSession,
} from "./plan-mode-shared.js";
import { ToolRegistry } from "../registry.js";
import { registerBuiltinTools } from "./registry.js";

const baseContext: ToolExecutionContext = {
  agentId: "agent-main",
  sessionId: "sess-plan",
  toolUseId: "tu-plan",
  cwd: "/tmp/project",
};

let tempHome: string | undefined;
let prevHome: string | undefined;

afterEach(async () => {
  if (prevHome !== undefined) {
    process.env.KAKO_HOME = prevHome;
  } else {
    delete process.env.KAKO_HOME;
  }
  if (tempHome) {
    const { rm } = await import("node:fs/promises");
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

async function withTempKakoHome(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  tempHome = await mkdtemp(join(tmpdir(), "kako-plan-"));
  prevHome = process.env.KAKO_HOME;
  process.env.KAKO_HOME = tempHome;
  return tempHome;
}

function harnessContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  let mode: "default" | "plan" = "default";
  let planPath: string | undefined;
  return {
    ...baseContext,
    getPermissionMode: () => mode,
    setPermissionMode: (m) => {
      mode = m;
    },
    getPlanFilePath: () => planPath,
    setPlanFilePath: (p) => {
      planPath = p;
    },
    ...overrides,
  };
}

describe("plan-mode-shared", () => {
  it("parses allowedPrompts", () => {
    expect(
      parseAllowedPrompts([
        { tool: "Bash", prompt: "run tests" },
        { tool: "Read", prompt: "ignored" },
      ]),
    ).toEqual([{ tool: "Bash", prompt: "run tests" }]);
    expect(
      parseExitPlanModeInput({ allowedPrompts: [{ tool: "Bash", prompt: "npm install" }] })
        .allowedPrompts,
    ).toHaveLength(1);
  });
});

describe("EnterPlanMode tool definition", () => {
  it("matches Claude Code schema and description", () => {
    expect(enterPlanModeToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(enterPlanModeToolDefinition.inputSchema.properties).toEqual({});
    expect(enterPlanModeToolDefinition.description).toContain("When to Use This Tool");
    expect(enterPlanModeToolDefinition.description).toContain("What Happens in Plan Mode");
    expect(enterPlanModeToolDefinition.description).toContain("Agent tool with explore agent");
    expect(enterPlanModeToolDefinition.requiresConfirmation).toBe(true);
  });
});

describe("ExitPlanMode tool definition", () => {
  it("matches Claude Code schema and description", () => {
    expect(exitPlanModeToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(exitPlanModeToolDefinition.inputSchema.properties).toHaveProperty("allowedPrompts");
    expect(exitPlanModeToolDefinition.inputSchema.properties).not.toHaveProperty("plan");
    expect(exitPlanModeToolDefinition.description).toContain("How This Tool Works");
    expect(exitPlanModeToolDefinition.description).toContain(
      "does NOT take the plan content as a parameter",
    );
    expect(exitPlanModeToolDefinition.description).toContain("Do NOT use AskUserQuestion");
    expect(exitPlanModeToolDefinition.requiresConfirmation).toBe(true);
  });
});

describe("EnterPlanMode / ExitPlanMode handlers", () => {
  it("enters plan mode and assigns a plan file", async () => {
    await withTempKakoHome();
    const ctx = harnessContext();
    const out = await enterPlanModeHandler({}, ctx);
    expect(String(out)).toContain("Entered plan mode");
    expect(String(out)).toContain(planFilePathForSession("sess-plan"));
    expect(ctx.getPermissionMode?.()).toBe("plan");
    expect(ctx.getPlanFilePath?.()).toBe(planFilePathForSession("sess-plan"));
  });

  it("exits plan mode and returns plan file contents", async () => {
    await withTempKakoHome();
    const planPath = planFilePathForSession("sess-plan");
    await mkdir(join(tempHome!, "plans"), { recursive: true });
    await writeFile(planPath, "# Plan\n\nStep 1", "utf-8");

    const ctx = harnessContext();
    ctx.setPermissionMode?.("plan");
    ctx.setPlanFilePath?.(planPath);

    const out = await exitPlanModeHandler(
      { allowedPrompts: [{ tool: "Bash", prompt: "run tests" }] },
      {
        ...ctx,
        getApprovedPermissionMode: () => "bypassPermissions",
      },
    );
    expect(String(out)).toContain("Exited plan mode");
    expect(String(out)).toContain("Step 1");
    expect(String(out)).toContain("run tests");
    expect(ctx.getPermissionMode?.()).toBe("bypassPermissions");
    expect(ctx.getPlanFilePath?.()).toBeUndefined();
  });
});

describe("plan mode tool gating via registry", () => {
  it("allows Write to plan file only after EnterPlanMode", async () => {
    await withTempKakoHome();
    const registry = new ToolRegistry({
      ...baseContext,
      confirm: async () => true,
    });
    registerBuiltinTools(registry);

    await registry.execute({ id: "tu-enter", name: "EnterPlanMode", input: {} });
    const planPath = registry.getPlanFilePath()!;

    const otherWrite = await registry.execute({
      id: "tu-write",
      name: "Write",
      input: { file_path: join("/tmp/project", "a.txt"), content: "x" },
    });
    expect(otherWrite.status).toBe("denied");

    await writeFile(planPath, "draft", "utf-8");
    const planWrite = await registry.execute({
      id: "tu-plan-write",
      name: "Write",
      input: { file_path: planPath, content: "# Plan\n" },
    });
    expect(planWrite.status).toBe("success");
    expect(await readFile(planPath, "utf-8")).toBe("# Plan\n");
  });
});
