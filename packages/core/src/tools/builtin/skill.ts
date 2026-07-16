import type { LLMMessage, ToolDefinition, ToolHandler } from "@kako/shared";
import { wrapUserMessageForLlm } from "../../agent/context.js";
import { loadSkill } from "../../skills/loader.js";
import { isSlashOnlySystemSkill, isSystemSkill } from "../../skills/system-skills.js";
import { INIT_SLASH_CORE_PROMPT } from "../../skills/slash-command-message.js";
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

/** Tool result logged when Skill succeeds (harness pivots context; model does not see this as a tool message). */
export function formatSkillActivationResult(skillName: string, skillMdPath: string): string {
  if (skillName === "init") {
    return "Launching skill: init";
  }
  return `Skill "${skillName}" activated from ${skillMdPath}. Instructions loaded into system-reminder.`;
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

  if (parsed.skill === "workflows") {
    return formatSessionWorkflowsStatus(context.sessionId);
  }

  if (isSlashOnlySystemSkill(parsed.skill)) {
    throw new Error(`Skill "${parsed.skill}" is only available as a slash command (/${parsed.skill})`);
  }

  if (parsed.skill === "init") {
    return formatSkillActivationResult("init", "init");
  }

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
