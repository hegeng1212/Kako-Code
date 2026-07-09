import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import type { ToolCall, ToolConfirmResult } from "@kako/shared";
import { ansi } from "./ansi.js";
import type { ChoiceRow } from "./choice-picker.js";
import { padChoiceLine, renderChoicePanelLines } from "./choice-picker.js";
import { renderScriptCodeBlock } from "./script-code-view.js";
import { wrapContentLines } from "./text-wrap.js";

export const TOOL_APPROVAL_HINT = `${ansi.muted}Enter to select · ↑/↓ navigate · shift+tab session allow · Esc to cancel${ansi.reset}`;

export type ToolApprovalDecision =
  | { action: "allow" }
  | { action: "allow-session" }
  | { action: "deny" };

export interface ToolApprovalContent {
  title: string;
  subtitle: string;
  previewLines: string[];
  question: string;
  rows: ChoiceRow[];
}

function formatPathForDisplay(filePath: string, cwd: string): string {
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const home = homedir();
  if (home && resolved.startsWith(home)) {
    return `~${resolved.slice(home.length)}`;
  }
  return resolved;
}

function writeContent(raw: Record<string, unknown>): string {
  return String(raw.content ?? raw.contents ?? "");
}

function filePathFromInput(raw: Record<string, unknown>, cwd: string): string {
  const path = String(raw.file_path ?? raw.path ?? raw.notebook_path ?? "").trim();
  return path ? formatPathForDisplay(path, cwd) : "(unknown path)";
}

function sessionAllowLabel(toolCall: ToolCall): string {
  if (toolCall.name === "Bash") {
    return "Yes, allow this command during this session (shift+tab)";
  }
  if (toolCall.name === "Write" || toolCall.name === "Edit" || toolCall.name === "NotebookEdit") {
    return "Yes, allow all edits during this session (shift+tab)";
  }
  return "Yes, allow during this session (shift+tab)";
}

export function buildToolApprovalRows(): ChoiceRow[] {
  return [
    { kind: "option", label: "Yes", optionIndex: 0 },
    { kind: "option", label: "", optionIndex: 1 },
    { kind: "option", label: "No", optionIndex: 2 },
  ];
}

export function toolApprovalDecisionFromRow(
  row: ChoiceRow,
): ToolApprovalDecision {
  if (row.kind !== "option" || row.optionIndex === undefined) {
    return { action: "deny" };
  }
  if (row.optionIndex === 0) return { action: "allow" };
  if (row.optionIndex === 1) return { action: "allow-session" };
  return { action: "deny" };
}

export function toolConfirmResultFromDecision(
  toolCall: ToolCall,
  decision: ToolApprovalDecision,
): ToolConfirmResult {
  if (decision.action === "deny") {
    return { allowed: false, denialReason: "User denied tool execution" };
  }
  if (decision.action === "allow-session") {
    const sessionAllow =
      toolCall.name === "Bash" ? ("bash-command" as const) : ("writes" as const);
    return { allowed: true, sessionAllow };
  }
  return { allowed: true };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function buildToolApprovalContent(
  toolCall: ToolCall,
  cwd: string,
  cols: number,
): Promise<ToolApprovalContent> {
  const rows = buildToolApprovalRows();
  rows[1]!.label = sessionAllowLabel(toolCall);

  if (toolCall.name === "Write") {
    const rawPath = String(toolCall.input.file_path ?? toolCall.input.path ?? "").trim();
    if (!rawPath) {
      const snippet = JSON.stringify(toolCall.input).slice(0, 120);
      return {
        title: "Create file",
        subtitle: "(tool arguments incomplete)",
        previewLines: snippet
          ? [`${ansi.muted}${snippet}${ansi.reset}`]
          : [`${ansi.muted}(no file path or content received)${ansi.reset}`],
        question: "Tool arguments are incomplete — allow anyway?",
        rows,
      };
    }
    const absPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
    const exists = absPath ? await fileExists(absPath) : false;
    const displayPath = filePathFromInput(toolCall.input, cwd);
    const content = writeContent(toolCall.input);
    const title = exists ? "Update file" : "Create file";
    const preview = renderScriptCodeBlock(content, cols);
    return {
      title,
      subtitle: displayPath,
      previewLines: preview,
      question: `Do you want to ${exists ? "update" : "create"} ${basename(displayPath) || displayPath}?`,
      rows,
    };
  }

  if (toolCall.name === "Edit" || toolCall.name === "NotebookEdit") {
    const displayPath = filePathFromInput(toolCall.input, cwd);
    const newText = String(toolCall.input.new_string ?? toolCall.input.new_str ?? "");
    const preview = newText
      ? renderScriptCodeBlock(newText, cols)
      : [`${ansi.muted}(edit preview unavailable)${ansi.reset}`];
    return {
      title: "Edit file",
      subtitle: displayPath,
      previewLines: preview,
      question: `Do you want to edit ${basename(displayPath) || displayPath}?`,
      rows,
    };
  }

  if (toolCall.name === "Bash") {
    const command = String(toolCall.input.command ?? "").trim();
    const isDelete = /\brm\b/.test(command);
    const title = isDelete ? "Delete file" : "Run command";
    const preview = wrapContentLines(command, Math.max(20, cols - 4)).map(
      (line) => `${ansi.text}${line}${ansi.reset}`,
    );
    return {
      title,
      subtitle: command,
      previewLines: preview,
      question: isDelete
        ? "Do you want to run this delete command?"
        : "Do you want to run this command?",
      rows,
    };
  }

  const detail = JSON.stringify(toolCall.input).slice(0, 200);
  return {
    title: toolCall.name,
    subtitle: detail,
    previewLines: [],
    question: `Allow ${toolCall.name}?`,
    rows,
  };
}

export function renderToolApprovalContentLines(content: ToolApprovalContent, cols: number): string[] {
  const lines: string[] = [
    `${ansi.bold}${content.title}${ansi.reset}`,
    `${ansi.text}${content.subtitle}${ansi.reset}`,
    "",
    ...content.previewLines,
  ];
  return lines;
}

export function defaultToolApprovalSizingRows(): ChoiceRow[] {
  const rows = buildToolApprovalRows();
  rows[1]!.label = "Yes, allow this command during this session (shift+tab)";
  return rows;
}

export function toolApprovalPanelRowCount(
  cols: number,
  content?: Pick<ToolApprovalContent, "question" | "rows">,
): number {
  const rows = content?.rows ?? defaultToolApprovalSizingRows();
  const panel = renderChoicePanelLines({
    header: "",
    question: content?.question ?? "Do you want to run this command?",
    rows,
    selectedIndex: 0,
    cols,
    showHeader: false,
  });
  return 1 + panel.length + 1 + 1;
}

export function renderToolApprovalPanelLines(opts: {
  content: ToolApprovalContent;
  selectedIndex: number;
  cols: number;
}): string[] {
  const panel = renderChoicePanelLines({
    header: "",
    question: opts.content.question,
    rows: opts.content.rows,
    selectedIndex: opts.selectedIndex,
    cols: opts.cols,
    showHeader: false,
  });
  return panel;
}

export function padToolApprovalLines(lines: string[], cols: number): string[] {
  return lines.map((line) => padChoiceLine(line, cols));
}
