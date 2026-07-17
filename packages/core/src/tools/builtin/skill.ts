import type { LLMMessage, ToolDefinition, ToolHandler } from "@kako/shared";
import { wrapUserMessageForLlm } from "../../agent/context.js";
import { loadSkill } from "../../skills/loader.js";
import {
  getSystemSkillEntry,
  getSystemSkillHandler,
  isSlashOnlySystemSkill,
  isSystemSkill,
  type SystemSkillEntry,
} from "../../skills/system-skills.js";
import {
  buildDynamicWorkflowSlashMessage,
  INIT_SLASH_CORE_PROMPT,
} from "../../skills/slash-command-message.js";
import { formatSessionWorkflowsStatus } from "../../workflows/status-summary.js";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import {
  CLAUDE_SKILL_ARGS_DESCRIPTION,
  CLAUDE_SKILL_DESCRIPTION,
  CLAUDE_SKILL_SKILL_DESCRIPTION,
} from "../claude-tool-text.js";

export const SKILL_DESCRIPTION = adaptClaudeCodeToolText(CLAUDE_SKILL_DESCRIPTION);

export const skillToolDefinition: ToolDefinition = {
  name: "Skill",
  description: SKILL_DESCRIPTION,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      skill: {
        type: "string",
        description: CLAUDE_SKILL_SKILL_DESCRIPTION,
      },
      args: {
        type: "string",
        description: CLAUDE_SKILL_ARGS_DESCRIPTION,
      },
    },
    required: ["skill"],
  },
};

export interface ParsedSkillInput {
  skill: string;
  args?: string;
}

export function parseSkillInput(raw: Record<string, unknown>): ParsedSkillInput {
  const skill = String(raw.skill ?? raw.command ?? "").trim();
  if (!skill) {
    throw new Error("Skill requires skill");
  }
  if (skill.startsWith("/")) {
    throw new Error("Skill name must not include a leading slash");
  }
  const args = raw.args !== undefined ? String(raw.args) : undefined;
  return { skill, args };
}

export function assertSkillAllowed(skillName: string, allowedSkills: string[] | undefined): void {
  if (isSystemSkill(skillName)) return;
  if (!allowedSkills?.length) return;
  if (!allowedSkills.includes(skillName)) {
    throw new Error(`Skill "${skillName}" is not available for this agent`);
  }
}

/** Tool result logged when Skill succeeds (activation ack; dynamic-workflow may append launch details). */
export function formatSkillActivationResult(skillName: string, skillMdPath: string): string {
  if (skillName === "init" || getSystemSkillHandler(skillName) === "dynamic-workflow") {
    return `Launching skill: ${skillName}`;
  }
  return `Skill "${skillName}" activated from ${skillMdPath}. Instructions loaded into system-reminder.`;
}

/**
 * Claude Code parity for dynamic-workflow skills (e.g. deep-research):
 * after Skill(tool), re-inject the same Invoke: Workflow guide as `/skill` slash,
 * with refined args — do not pivot onto SKILL.md alone.
 * (Slash path still uses this; tool path uses harness Workflow follow-through.)
 */
export async function buildDynamicWorkflowSkillActivatedMessages(input: {
  systemPromptBase: string;
  transcript: Array<{ role: string; content: string }>;
  entry: SystemSkillEntry;
  skillArgs?: string;
  workspaceKakoMd?: string;
  cwd?: string;
  now?: Date;
}): Promise<LLMMessage[]> {
  const now = input.now ?? new Date();
  const messages: LLMMessage[] = [{ role: "system", content: input.systemPromptBase }];
  for (const msg of input.transcript) {
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: wrapUserMessageForLlm(msg.content, input.workspaceKakoMd, now),
      });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    }
  }
  const guide = await buildDynamicWorkflowSlashMessage(
    input.entry,
    input.skillArgs ?? "",
    input.cwd,
  );
  const reinvoke =
    `(Re-invocation of /${input.entry.name} — the skill instructions were previously loaded; ` +
    `the arguments or dynamic output below are new.)\n\n`;
  messages.push({
    role: "user",
    content: wrapUserMessageForLlm(`${reinvoke}${guide}`, input.workspaceKakoMd, now),
  });
  return messages;
}

/**
 * After Skill(dynamic-workflow) with args: copy template JS, launch in background,
 * return Skill ack + synthetic Workflow tool call/result for the next model turn.
 */
export async function launchDynamicWorkflowFromSkill(input: {
  skillName: string;
  skillArgs?: string;
  skillOutput: string;
  sessionId: string;
  cwd: string;
}): Promise<{
  skillOutput: string;
  workflowToolCall: { id: string; name: "Workflow"; input: Record<string, unknown> };
  workflowOutput: string;
} | null> {
  if (getSystemSkillHandler(input.skillName) !== "dynamic-workflow") {
    return null;
  }
  if (!getSystemSkillEntry(input.skillName)) {
    return null;
  }
  const args = input.skillArgs?.trim() ?? "";
  if (!args) {
    return null;
  }
  const { formatWorkflowToolResult, launchWorkflow } = await import("../../workflows/runner.js");
  const { randomBytes } = await import("node:crypto");
  const launch = await launchWorkflow({
    sessionId: input.sessionId,
    cwd: input.cwd,
    name: input.skillName,
    args,
  });
  return {
    skillOutput: input.skillOutput || formatSkillActivationResult(input.skillName, input.skillName),
    workflowToolCall: {
      id: `call_${randomBytes(12).toString("hex")}`,
      name: "Workflow",
      input: { name: input.skillName, args },
    },
    workflowOutput: formatWorkflowToolResult(launch),
  };
}

/** Claude-style init pivot: inject core prompt as a follow-up user message (not SKILL.md). */
export function buildInitSkillActivatedMessages(input: {
  systemPromptBase: string;
  transcript: Array<{ role: string; content: string }>;
  skillArgs?: string;
  workspaceKakoMd?: string;
  now?: Date;
}): LLMMessage[] {
  const now = input.now ?? new Date();
  const messages: LLMMessage[] = [{ role: "system", content: input.systemPromptBase }];
  for (const msg of input.transcript) {
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: wrapUserMessageForLlm(msg.content, input.workspaceKakoMd, now),
      });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    }
  }
  let prompt = INIT_SLASH_CORE_PROMPT;
  if (input.skillArgs?.trim()) {
    prompt += `\n\nAdditional focus from the user:\n${input.skillArgs.trim()}`;
  }
  messages.push({
    role: "user",
    content: wrapUserMessageForLlm(prompt, input.workspaceKakoMd, now),
  });
  return messages;
}

/** Full skill body injected into system-reminder after Skill tool activation. */
export function formatActiveSkillReminder(skillName: string, instructions: string): string {
  return `\n\n<system-reminder>
Active skill: **${skillName}**

${instructions.trim()}
</system-reminder>`;
}

export function buildSkillActivatedMessages(input: {
  systemPromptBase: string;
  transcript: Array<{ role: string; content: string }>;
  skillName: string;
  skillInstructions: string;
  skillArgs?: string;
  workspaceKakoMd?: string;
  now?: Date;
}): LLMMessage[] {
  const now = input.now ?? new Date();
  let system = input.systemPromptBase;
  system += formatActiveSkillReminder(input.skillName, input.skillInstructions);

  const messages: LLMMessage[] = [{ role: "system", content: system }];
  for (const msg of input.transcript) {
    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: wrapUserMessageForLlm(msg.content, input.workspaceKakoMd, now),
      });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    }
  }
  if (input.skillArgs?.trim()) {
    messages.push({
      role: "user",
      content: wrapUserMessageForLlm(input.skillArgs.trim(), input.workspaceKakoMd, now),
    });
  }
  return messages;
}

/** Wrap skill body after Read loads SKILL.md (used by read handler). */
export function formatSkillToolResult(skillName: string, instructions: string, args?: string): string {
  let body = instructions.trim();
  if (args?.trim()) {
    body += `\n\n## Skill arguments\n\n${args.trim()}`;
  }
  return `<command-${skillName}>\n${body}\n</command-${skillName}>`;
}

export const skillHandler: ToolHandler = async (input, context) => {
  const parsed = parseSkillInput(input);

  if (context.isSkillActive?.(parsed.skill)) {
    throw new Error(`Skill "${parsed.skill}" is already active in this turn`);
  }

  assertSkillAllowed(parsed.skill, context.allowedSkills);

  // Slash-only names are CLI commands, not Skill tool targets.
  if (isSlashOnlySystemSkill(parsed.skill)) {
    throw new Error(`Skill "${parsed.skill}" is only available as a slash command (/${parsed.skill})`);
  }

  // Default (system) skills: run the registered handler — do not load user skill dirs first.
  if (parsed.skill === "workflows") {
    return formatSessionWorkflowsStatus(context.sessionId);
  }
  if (parsed.skill === "init") {
    return formatSkillActivationResult("init", "init");
  }
  if (getSystemSkillHandler(parsed.skill) === "dynamic-workflow") {
    if (!getSystemSkillEntry(parsed.skill)) {
      throw new Error(`Unknown skill: ${parsed.skill}`);
    }
    // Launch happens in the agent-loop follow-through (Skill ack + Workflow tool result).
    return formatSkillActivationResult(parsed.skill, parsed.skill);
  }

  // User / bundled file skills: load SKILL.md from the skill directory.
  const loaded = await loadSkill(parsed.skill, context.cwd);
  if (
    context.allowedSkills?.length &&
    !isSystemSkill(loaded.name) &&
    !context.allowedSkills.includes(loaded.name)
  ) {
    throw new Error(`Skill "${parsed.skill}" is not available for this agent`);
  }
  return formatSkillActivationResult(loaded.name, loaded.skillMdPath);
};
