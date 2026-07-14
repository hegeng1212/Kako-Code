import { homedir } from "node:os";
import { isLowRiskBashCommand } from "@kako/core";

function trimDetail(detail: string, max = 80): string {
  const t = detail.trim();
  if (!t || t === "{}") return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function parseAgentDescription(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { description?: string };
    if (parsed.description?.trim()) return parsed.description.trim();
  } catch {
    // detail is not JSON — use as-is
  }
  return trimDetail(detail, 60);
}

function mcpToolLabel(name: string): string {
  const parts = name.split("/");
  if (parts.length >= 3) return parts.slice(2).join("/");
  return name;
}

/** Plan file writes are shown as "Updated plan", not a generic write stat. */
export function isPlanFileDetail(detail: string): boolean {
  const d = detail.trim();
  return /(?:^|\/)\.kako\/plans\/[^/]+\.md$/i.test(d) || /\/plans\/[^/]+\.md$/i.test(d);
}

export function isWorkflowDetail(detail: string): boolean {
  return /^dynamic workflow:/i.test(detail.trim());
}

/** True for Bash invocations that run programs / have side effects (not read-only inspection). */
export function isExecutionBashCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  return !isLowRiskBashCommand(cmd);
}

export function shellCommandStat(count: number): string {
  return count === 1 ? "ran 1 shell command" : `ran ${count} shell commands`;
}

interface AggregatedStat {
  key: string;
  amount: number;
  order: number;
}

function parseStatContribution(phrase: string): { key: string; amount: number } {
  if (phrase === "read 1 file" || phrase === "read file") {
    return { key: "read:file", amount: 1 };
  }
  const readFiles = /^read (\d+) files$/.exec(phrase);
  if (readFiles) return { key: "read:file", amount: Number(readFiles[1]) };

  if (phrase === "wrote 1 file") return { key: "wrote:file", amount: 1 };
  const wroteFiles = /^wrote (\d+) files$/.exec(phrase);
  if (wroteFiles) return { key: "wrote:file", amount: Number(wroteFiles[1]) };

  if (phrase === "edited 1 file") return { key: "edited:file", amount: 1 };
  const editedFiles = /^edited (\d+) files$/.exec(phrase);
  if (editedFiles) return { key: "edited:file", amount: Number(editedFiles[1]) };

  const listedDirs = /^listed (\d+) (directory|directories)$/.exec(phrase);
  if (listedDirs) return { key: "list:dir", amount: Number(listedDirs[1]) };

  const foundMatches = /^found (\d+) (match|matches)$/.exec(phrase);
  if (foundMatches) return { key: "found:match", amount: Number(foundMatches[1]) };

  const foundPaths = /^found (\d+) (path|paths)$/.exec(phrase);
  if (foundPaths) return { key: "found:path", amount: Number(foundPaths[1]) };

  if (phrase === "searched content") return { key: "search:content", amount: 1 };
  if (phrase === "searched files") return { key: "search:files", amount: 1 };

  const calledMcp = /^called (.+)$/.exec(phrase);
  if (calledMcp) return { key: `called:${calledMcp[1]}`, amount: 1 };

  if (phrase === "ran 1 shell command") return { key: "bash:exec", amount: 1 };
  const ranShell = /^ran (\d+) shell commands$/.exec(phrase);
  if (ranShell) return { key: "bash:exec", amount: Number(ranShell[1]) };

  return { key: phrase, amount: 1 };
}

function formatAggregatedStat(key: string, amount: number): string {
  switch (key) {
    case "read:file":
      return amount === 1 ? "read 1 file" : `read ${amount} files`;
    case "wrote:file":
      return amount === 1 ? "wrote 1 file" : `wrote ${amount} files`;
    case "edited:file":
      return amount === 1 ? "edited 1 file" : `edited ${amount} files`;
    case "list:dir":
      return `listed ${amount} ${amount === 1 ? "directory" : "directories"}`;
    case "found:match":
      return `found ${amount} ${amount === 1 ? "match" : "matches"}`;
    case "found:path":
      return `found ${amount} ${amount === 1 ? "path" : "paths"}`;
    case "search:content":
      return amount === 1 ? "searched content" : `searched content ${amount} times`;
    case "search:files":
      return amount === 1 ? "searched files" : `searched files ${amount} times`;
    case "bash:exec":
      return shellCommandStat(amount);
    default:
      if (key.startsWith("called:")) {
        const tool = key.slice("called:".length);
        return amount === 1 ? `called ${tool}` : `called ${tool} ${amount} times`;
      }
      return amount === 1 ? key : `${key} (${amount} times)`;
  }
}

/** Merge duplicate activity summary fragments, e.g. read 1 file + read 1 file → read 2 files. */
export function mergeActivityStatPhrases(phrases: string[]): string[] {
  const totals = new Map<string, AggregatedStat>();
  let order = 0;

  for (const phrase of phrases) {
    const { key, amount } = parseStatContribution(phrase);
    const existing = totals.get(key);
    if (existing) {
      existing.amount += amount;
      continue;
    }
    totals.set(key, { key, amount, order: order++ });
  }

  return [...totals.values()]
    .sort((a, b) => a.order - b.order)
    .map((entry) => formatAggregatedStat(entry.key, entry.amount));
}

export function workflowNameFromDetail(detail: string): string {
  const match = detail.trim().match(/^dynamic workflow:\s*(.+)$/i);
  return match?.[1]?.trim() || detail.trim() || "workflow";
}

/** Invocation label for expanded tool rows, e.g. Bash(ls -la /path). */
export function formatToolInvocationLabel(name: string, detail: string): string {
  if (name === "Workflow" && isWorkflowDetail(detail)) {
    return `Workflow(${detail.trim()})`;
  }
  const target = trimDetail(detail, 120);
  if (name === "Bash" && target) return `Bash(${target})`;
  if (target) return `${name}(${target})`;
  return name;
}

function countLsEntries(output: string): { dirs: number; items: number } {
  const lines = output
    .trim()
    .split("\n")
    .filter((line) => /^[d-]/.test(line.trim()));
  const dirs = lines.filter((line) => {
    const name = line.trim().split(/\s+/).pop() ?? "";
    return line.trim().startsWith("d") && name !== "." && name !== "..";
  }).length;
  return { dirs, items: lines.length };
}

/** Short stat fragment for activity summary lines (Claude Code-style). */
export function toolCallStatPhrase(
  name: string,
  detail: string,
  output?: string,
): string | null {
  if (name === "AskUserQuestion") return null;

  const target = trimDetail(detail);

  if ((name === "Write" || name === "Edit") && isPlanFileDetail(detail)) {
    return null;
  }

  switch (name) {
    case "Read":
      return target ? "read 1 file" : "read file";
    case "Write":
      return "wrote 1 file";
    case "Edit":
      return "edited 1 file";
    case "Grep": {
      if (output) {
        const count = output.trim().split("\n").filter(Boolean).length;
        if (count > 0) return `found ${count} ${count === 1 ? "match" : "matches"}`;
      }
      return "searched content";
    }
    case "Glob": {
      if (output) {
        const count = output.trim().split("\n").filter(Boolean).length;
        if (count > 0) return `found ${count} ${count === 1 ? "file" : "files"}`;
      }
      return "searched files";
    }
    case "Bash": {
      const cmd = target.toLowerCase();
      if (/\bls\b/.test(cmd)) {
        if (output?.trim()) {
          const { dirs } = countLsEntries(output);
          if (dirs > 0) {
            return `listed ${dirs} ${dirs === 1 ? "directory" : "directories"}`;
          }
        }
        return "listed 1 directory";
      }
      if (/\bfind\b/.test(cmd) && output?.trim()) {
        const count = output.trim().split("\n").filter(Boolean).length;
        return `found ${count} ${count === 1 ? "path" : "paths"}`;
      }
      if (isExecutionBashCommand(target)) {
        return shellCommandStat(1);
      }
      return target ? `ran ${trimDetail(target, 48)}` : "ran command";
    }
    case "Skill":
      return target ? `activated ${target}` : "activated skill";
    case "EnterPlanMode":
      return "entered plan mode";
    case "ExitPlanMode":
      return "exited plan mode";
    case "Agent": {
      const desc = parseAgentDescription(detail);
      return desc ? `delegated — ${trimDetail(desc, 40)}` : "delegated to agent";
    }
    case "Workflow":
      return null;
    default:
      if (name.startsWith("mcp/")) {
        const tool = mcpToolLabel(name);
        return target ? `called ${tool}` : `called ${tool}`;
      }
      return target ? `ran ${name}` : `ran ${name}`;
  }
}

/** Contextual English phrase for an in-progress tool call. */
export function toolCallWaitingPhrase(name: string, detail: string): string {
  const target = trimDetail(detail);
  switch (name) {
    case "Read":
      return target ? `Reading ${target}` : "Reading file";
    case "Write":
      return target ? `Writing ${target}` : "Writing file";
    case "Edit":
      return target ? `Editing ${target}` : "Editing file";
    case "Bash":
      return target ? `Running ${target}` : "Running command";
    case "Monitor":
      return target ? `Monitoring — ${target}` : "Starting monitor";
    case "TaskStop":
      return target ? `Stopping task — ${target}` : "Stopping task";
    case "Skill":
      return target ? `Activating skill ${target}` : "Activating skill";
    case "Agent": {
      const desc = parseAgentDescription(detail);
      return desc ? `Delegating — ${desc}` : "Delegating to agent";
    }
    case "AskUserQuestion":
      return "Waiting for your choice";
    case "Workflow":
      return isWorkflowDetail(detail)
        ? `Workflow(${detail.trim()})`
        : "Launching workflow";
    case "EnterPlanMode":
      return "Entering plan mode";
    case "ExitPlanMode":
      return "Exiting plan mode";
    case "CronCreate":
      return "Creating cron job";
    case "CronDelete":
      return "Deleting cron job";
    case "CronList":
      return "Listing cron jobs";
    case "ScheduleWakeup":
      return target ? `Scheduling wakeup — ${target}` : "Scheduling wakeup";
    case "TaskCreate":
      return target ? `Creating task — ${target}` : "Creating task";
    case "TaskGet":
      return target ? `Fetching task — ${target}` : "Fetching task";
    case "TaskList":
      return "Listing tasks";
    case "TaskUpdate":
      return target ? `Updating task — ${target}` : "Updating task";
    case "WebFetch":
      return target ? `Fetching ${target}` : "Fetching URL";
    case "WebSearch":
      return target ? `Searching web — ${target}` : "Searching web";
    default:
      if (name.startsWith("mcp/")) {
        const tool = mcpToolLabel(name);
        return target ? `Calling ${tool} ${target}` : `Calling ${tool}`;
      }
      return target ? `Running ${name} ${target}` : `Running ${name}`;
  }
}

/** Contextual English phrase for a completed tool call. */
export function toolCallSuccessPhrase(name: string, detail: string): string {
  const target = trimDetail(detail);
  switch (name) {
    case "Read":
      return target ? `Read ${target}` : "Read file";
    case "Write":
      return target ? `Wrote ${target}` : "Wrote file";
    case "Edit":
      return target ? `Edited ${target}` : "Edited file";
    case "Bash":
      return target ? `Ran ${target}` : "Ran command";
    case "Monitor":
      return target ? `Monitored — ${target}` : "Started monitor";
    case "TaskStop":
      return target ? `Stopped task — ${target}` : "Stopped task";
    case "Skill":
      return target ? `Activated skill ${target}` : "Activated skill";
    case "Agent": {
      const desc = parseAgentDescription(detail);
      return desc ? `Delegated — ${desc}` : "Delegated to agent";
    }
    case "AskUserQuestion":
      return "Recorded your choice";
    case "Workflow":
      return isWorkflowDetail(detail)
        ? `Workflow(${detail.trim()})`
        : "Launched workflow";
    case "EnterPlanMode":
      return "Entered plan mode";
    case "ExitPlanMode":
      return "Exited plan mode";
    case "CronCreate":
      return "Created cron job";
    case "CronDelete":
      return "Deleted cron job";
    case "CronList":
      return "Listed cron jobs";
    case "ScheduleWakeup":
      return target ? `Scheduled wakeup — ${target}` : "Scheduled wakeup";
    case "TaskCreate":
      return target ? `Created task — ${target}` : "Created task";
    case "TaskGet":
      return target ? `Fetched task — ${target}` : "Fetched task";
    case "TaskList":
      return "Listed tasks";
    case "TaskUpdate":
      return target ? `Updated task — ${target}` : "Updated task";
    case "WebFetch":
      return target ? `Fetched ${target}` : "Fetched URL";
    case "WebSearch":
      return target ? `Searched web — ${target}` : "Searched web";
    default:
      if (name.startsWith("mcp/")) {
        const tool = mcpToolLabel(name);
        return target ? `Called ${tool}` : `Called ${tool}`;
      }
      return target ? `Ran ${name} ${target}` : `Ran ${name}`;
  }
}

/** Neutral timeline label — same wording for success and failure; dot color shows status. */
export function toolCallTimelinePhrase(name: string, detail: string): string {
  if (name === "Skill") return "use skill";
  const stat = toolCallStatPhrase(name, detail);
  if (stat) return stat;
  const success = toolCallSuccessPhrase(name, detail);
  if (!success) return name;
  return `${success.charAt(0).toLowerCase()}${success.slice(1)}`;
}

/** Contextual English phrase for a failed tool call. */
export function toolCallFailurePhrase(
  name: string,
  detail: string,
  errorDetail?: string,
): string {
  const waiting = toolCallWaitingPhrase(name, detail);
  let phrase: string;
  if (/^Reading /.test(waiting)) phrase = waiting.replace(/^Reading /, "Failed to read ");
  else if (/^Writing /.test(waiting)) phrase = waiting.replace(/^Writing /, "Failed to write ");
  else if (/^Editing /.test(waiting)) phrase = waiting.replace(/^Editing /, "Failed to edit ");
  else if (/^Running /.test(waiting)) phrase = waiting.replace(/^Running /, "Failed to run ");
  else if (/^Activating /.test(waiting)) phrase = waiting.replace(/^Activating /, "Failed to activate ");
  else if (/^Delegating/.test(waiting)) phrase = waiting.replace(/^Delegating/, "Delegation failed");
  else if (/^Calling /.test(waiting)) phrase = waiting.replace(/^Calling /, "Failed to call ");
  else if (/^Waiting /.test(waiting)) phrase = waiting.replace(/^Waiting /, "Failed while ");
  else phrase = `Failed — ${waiting.charAt(0).toLowerCase()}${waiting.slice(1)}`;

  const err = errorDetail?.trim();
  if (err && !trimDetail(detail)) {
    const short = err.length > 72 ? `${err.slice(0, 71)}…` : err;
    return `${phrase} — ${short}`;
  }
  return phrase;
}

export function formatPlanPathForPreview(detail: string): string {
  const d = detail.trim();
  const home = homedir();
  if (home && d.startsWith(home)) {
    return `~${d.slice(home.length)}`;
  }
  return d;
}
