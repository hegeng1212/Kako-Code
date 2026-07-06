import type {
  Session,
  SessionId,
  SessionStartOptions,
  SlashCommandContext,
  SlashResult,
} from "@kako/shared";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { getConfigDir, getGlobalKakoMdPath, getSkillsDir } from "../config/paths.js";
import { findBundledAssetDir } from "../config/bundled-assets.js";
import { sessionManager } from "./manager.js";

const BUILTIN_HELP = `
Slash commands:
  /help              Show this help
  /exit, /quit       End session and exit
  /new, /clear       Start a new session in the same project
  /sessions          List sessions for current project
  /resume <id>       Switch to an existing session
  /title <text>      Set session title
`.trim();

interface SlashConfig {
  slashCommands?: Record<string, string>;
}

async function readYamlFile(path: string): Promise<SlashConfig | null> {
  try {
    const text = await readFile(path, "utf-8");
    return parseYaml(text) as SlashConfig;
  } catch {
    return null;
  }
}

async function loadSlashConfig(cwd: string): Promise<Record<string, string>> {
  const globalConfig = await readYamlFile(join(getConfigDir(), "skills.yaml"));
  const projectConfig = await readYamlFile(join(resolve(cwd), ".kako", "config", "skills.yaml"));
  return {
    ...(globalConfig?.slashCommands ?? {}),
    ...(projectConfig?.slashCommands ?? {}),
  };
}

async function findSkillPath(skillName: string, cwd: string): Promise<string | null> {
  const candidates = [
    join(resolve(cwd), ".kako", "skills", skillName, "SKILL.md"),
    join(getSkillsDir(), skillName, "SKILL.md"),
  ];
  const bundledSkills = await findBundledAssetDir("skills");
  if (bundledSkills) {
    candidates.push(join(bundledSkills, skillName, "SKILL.md"));
  }
  for (const path of candidates) {
    try {
      await readFile(path, "utf-8");
      return path;
    } catch {
      // try next
    }
  }
  return null;
}

async function expandSlashValue(value: string, cwd: string): Promise<string> {
  const trimmed = value.trim();
  if (trimmed.includes("\n") || trimmed.includes(" ")) {
    return trimmed;
  }
  const skillPath = await findSkillPath(trimmed, cwd);
  if (!skillPath) return trimmed;
  return readFile(skillPath, "utf-8");
}

async function resolveYamlSlashCommand(
  cmd: string,
  arg: string,
  cwd: string,
): Promise<SlashResult | null> {
  const mapping = await loadSlashConfig(cwd);
  const value = mapping[cmd];
  if (!value) return null;
  const text = await expandSlashValue(arg ? `${value}\n\n${arg}` : value, cwd);
  return { type: "message", text };
}

function matchSessionId(input: string, sessions: Session[]): Session | undefined {
  const needle = input.trim().toLowerCase();
  return sessions.find((s) => s.id.toLowerCase() === needle || s.id.toLowerCase().startsWith(needle));
}

export async function handleSlashCommand(
  input: string,
  ctx: SlashCommandContext,
): Promise<SlashResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { type: "message", text: input };
  }

  const body = trimmed.slice(1);
  const spaceIdx = body.indexOf(" ");
  const cmd = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? "" : body.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case "help":
      return { type: "handled" };
    case "exit":
    case "quit":
      return { type: "exit" };
    case "new":
    case "clear": {
      await ctx.endSession(ctx.session.id);
      const session = await ctx.createSession(ctx.session.agentName);
      return { type: "switch", session };
    }
    case "sessions":
      return { type: "handled" };
    case "resume": {
      if (!arg) return { type: "error", message: "Usage: /resume <session-id>" };
      const sessions = await ctx.listSessions();
      const target = matchSessionId(arg, sessions);
      if (!target) return { type: "error", message: `Session not found: ${arg}` };
      if (target.id === ctx.session.id) {
        return { type: "error", message: "Already in this session." };
      }
      await ctx.endSession(ctx.session.id);
      const session = await ctx.resumeSession(target.id);
      return { type: "switch", session };
    }
    case "title": {
      if (!arg) return { type: "error", message: "Usage: /title <text>" };
      await ctx.updateTitle(ctx.session.id, arg);
      return { type: "handled" };
    }
    default: {
      const yamlResult = await resolveYamlSlashCommand(cmd, arg, ctx.cwd);
      if (yamlResult) return yamlResult;
      return { type: "error", message: `Unknown command: /${cmd}` };
    }
  }
}

export function formatSlashHelp(): string {
  return BUILTIN_HELP;
}

export async function formatSessionList(sessions: Session[]): Promise<string> {
  if (!sessions.length) return "No sessions for this project.";
  const lines = await Promise.all(
    sessions.map(async (s) => {
      const meta = await sessionManager.getSessionMeta(s.id);
      const title = meta?.title ?? s.id;
      return `  ${s.id}  [${s.status}]  ${title}  (${s.updatedAt})`;
    }),
  );
  return ["Sessions:", ...lines].join("\n");
}
