import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_TOOLS, DEFAULT_BUILTIN_TOOL_NAMES } from "./registry.js";

const BUILTIN_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Every built-in must have a dedicated test module (see TOOL_TESTING.md). */
const REQUIRED_TOOL_TESTS: Record<string, string[]> = {
  Read: ["read.test.ts"],
  Grep: ["grep.test.ts"],
  Glob: ["grep.test.ts"],
  Write: ["write.test.ts"],
  Edit: ["edit.test.ts"],
  NotebookEdit: ["notebook-edit.test.ts", "notebook.test.ts"],
  Bash: ["bash.test.ts"],
  Monitor: ["monitor.test.ts"],
  TaskOutput: ["task-output.test.ts"],
  TaskStop: ["task-stop.test.ts"],
  AskUserQuestion: ["ask-user-question.test.ts", "ask-user-question.integration.test.ts"],
  CronCreate: ["cron-create.test.ts"],
  CronDelete: ["cron-delete.test.ts"],
  CronList: ["cron-list.test.ts"],
  DesignSync: ["design-sync.test.ts"],
  ScheduleWakeup: ["schedule-wakeup.test.ts"],
  TaskCreate: ["task-create.test.ts"],
  TaskGet: ["task-get.test.ts"],
  TaskList: ["task-list.test.ts"],
  TaskUpdate: ["task-update.test.ts"],
  PushNotification: ["push-notification.test.ts"],
  WebFetch: ["web-fetch.test.ts"],
  WebSearch: ["web-search.test.ts"],
  EnterPlanMode: ["plan-mode.test.ts"],
  ExitPlanMode: ["plan-mode.test.ts"],
  EnterWorktree: ["enter-worktree.test.ts", "worktree.test.ts"],
  ExitWorktree: ["enter-worktree.test.ts", "exit-worktree.test.ts"],
  Skill: ["skill.test.ts"],
  Workflow: ["workflow.test.ts"],
  MemorySearch: ["memory-search.test.ts"],
  MemoryGet: ["memory-get.test.ts"],
  MemoryPin: ["memory-pin.test.ts"],
};

describe("builtin tool test coverage gate", () => {
  it("every registered built-in has required test files", () => {
    for (const tool of BUILTIN_TOOLS) {
      const name = tool.definition.name;
      const required = REQUIRED_TOOL_TESTS[name];
      expect(required, `missing REQUIRED_TOOL_TESTS entry for ${name}`).toBeDefined();
      for (const file of required!) {
        expect(existsSync(join(BUILTIN_DIR, file)), `${name} missing ${file}`).toBe(true);
      }
    }
  });

  it("REQUIRED_TOOL_TESTS covers all default built-ins", () => {
    for (const name of DEFAULT_BUILTIN_TOOL_NAMES) {
      expect(REQUIRED_TOOL_TESTS[name], `add test file + gate entry for ${name}`).toBeDefined();
    }
  });
});
