import type { AgentDefinition } from "@kako/shared";

/** Claude Code-style context management note for the main agent. */
export function formatContextManagementReminder(): string {
  return `# Context management
When the conversation grows long, some or all of the current context is summarized; the summary, along with any remaining unsummarized context, is provided in the next context window so work can continue — you don't need to wrap up early or hand off mid-task.`;
}

/** Format the tools clause for a sub-agent catalog line. */
export function formatSubagentToolsClause(def: AgentDefinition): string {
  const tools = def.tools ?? [];
  if (tools.includes("*")) {
    return "Tools: *";
  }
  if (def.disallowedTools?.length) {
    return `Tools: All tools except ${def.disallowedTools.join(", ")}`;
  }
  if (tools.length) {
    return `Tools: ${tools.join(", ")}`;
  }
  return "Tools: (default)";
}

/** One catalog entry: `- explore: Read-only search... (Tools: ...)`. */
export function formatSubagentCatalogLine(def: AgentDefinition): string {
  const desc = def.description.trim().replace(/\s+/g, " ");
  return `- ${def.name}: ${desc} (${formatSubagentToolsClause(def)})`;
}

const PARALLEL_DELEGATION_HINT =
  "When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently.";

/**
 * Full <system-reminder> block listing sub-agents for the Agent tool (Claude Code-style).
 */
export function formatSubagentSystemReminder(subagents: AgentDefinition[]): string {
  if (!subagents.length) return "";

  const lines = [
    formatContextManagementReminder(),
    "",
    "Available agent types for the Agent tool:",
    ...subagents.map(formatSubagentCatalogLine),
    "",
    PARALLEL_DELEGATION_HINT,
  ];

  return `\n\n<system-reminder>\n${lines.join("\n")}\n</system-reminder>`;
}
