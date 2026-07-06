import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "@kako/shared";
import {
  formatContextManagementReminder,
  formatSubagentCatalogLine,
  formatSubagentSystemReminder,
  formatSubagentToolsClause,
} from "./subagent-catalog.js";

function def(partial: Partial<AgentDefinition> & Pick<AgentDefinition, "name" | "description">): AgentDefinition {
  return {
    model: "",
    systemPrompt: "test",
    ...partial,
  };
}

describe("subagent-catalog", () => {
  it("formats context management reminder", () => {
    expect(formatContextManagementReminder()).toContain("# Context management");
    expect(formatContextManagementReminder()).toContain("don't need to wrap up early");
  });

  it("formats tools clause for wildcard and disallowed lists", () => {
    expect(formatSubagentToolsClause(def({ name: "gp", description: "x", tools: ["*"] }))).toBe(
      "Tools: *",
    );
    expect(
      formatSubagentToolsClause(
        def({
          name: "explore",
          description: "x",
          disallowedTools: ["Agent", "Write"],
        }),
      ),
    ).toBe("Tools: All tools except Agent, Write");
  });

  it("formats full system reminder with parallel delegation hint", () => {
    const text = formatSubagentSystemReminder([
      def({
        name: "explore",
        description: "Read-only search agent.",
        disallowedTools: ["Agent", "Write"],
      }),
      def({ name: "general-purpose", description: "Catch-all agent.", tools: ["*"] }),
    ]);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("Available agent types for the Agent tool:");
    expect(text).toContain("- explore: Read-only search agent.");
    expect(text).toContain("All tools except Agent, Write");
    expect(text).toContain("- general-purpose: Catch-all agent. (Tools: *)");
    expect(text).toContain("multiple tool uses so they run concurrently");
  });

  it("formats catalog line", () => {
    const line = formatSubagentCatalogLine(
      def({ name: "plan", description: "Architect agent.", tools: ["Read"] }),
    );
    expect(line).toBe("- plan: Architect agent. (Tools: Read)");
  });
});
