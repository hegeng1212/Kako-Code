import { homedir } from "node:os";

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
    case "Glob": {
      if (output) {
        const count = output.trim().split("\n").filter(Boolean).length;
        if (count > 0) {
          return `found ${count} ${count === 1 ? "match" : "matches"}`;
        }
      }
      return "searched files";
    }
    case "Grep": {
      if (output) {
        const count = output.trim().split("\n").filter(Boolean).length;
        if (count > 0) return `found ${count} ${count === 1 ? "match" : "matches"}`;
      }
      return "searched content";
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
