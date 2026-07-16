import { ansi } from "./ansi.js";
import type { ChoiceRow } from "./choice-picker.js";

export const AGENT_RESUME_CONFIRM_TITLE = "Resume interrupted background agent?";

export const AGENT_RESUME_CONFIRM_HINT = `${ansi.muted}Enter to select · ↑/↓ navigate · Esc to cancel${ansi.reset}`;

export type AgentResumeDecision = "continue" | "cancel";

export function buildAgentResumeConfirmRows(): ChoiceRow[] {
  return [
    { kind: "option", label: "Yes, continue", optionIndex: 0 },
    { kind: "option", label: "No", optionIndex: 1 },
  ];
}

export function agentResumeDecisionFromRow(row: ChoiceRow): AgentResumeDecision | undefined {
  if (row.kind !== "option") return undefined;
  if (row.optionIndex === 0) return "continue";
  if (row.optionIndex === 1) return "cancel";
  return undefined;
}

export function formatAgentResumeSummary(item: {
  description: string;
  subagentName: string;
  prompt: string;
}): string[] {
  const promptPreview = item.prompt.trim().replace(/\s+/g, " ").slice(0, 160);
  return [
    `${ansi.text}${AGENT_RESUME_CONFIRM_TITLE}${ansi.reset}`,
    `${ansi.muted}Agent: ${item.subagentName}${ansi.reset}`,
    `${ansi.muted}Task: ${item.description.trim() || "(no description)"}${ansi.reset}`,
    `${ansi.muted}Prompt: ${promptPreview || "(empty)"}${ansi.reset}`,
  ];
}
