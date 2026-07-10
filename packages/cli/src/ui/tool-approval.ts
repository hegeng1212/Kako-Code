import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import type { SessionAllowKind, ToolCall, ToolConfirmResult } from "@kako/shared";
import { parseMcpToolName } from "@kako/shared";
import { listAllCachedTools } from "@kako/core";
import { ansi } from "./ansi.js";
import type { ChoiceRow } from "./choice-picker.js";
import { padChoiceLine, renderChoicePanelLines } from "./choice-picker.js";
import { wrapContentLines } from "./text-wrap.js";
import {
  applyEditPreview,
  renderFilePreviewLines,
} from "./tool-content-preview.js";

export const TOOL_APPROVAL_HINT = `${ansi.muted}Enter to select · ↑/↓ navigate · shift+tab session allow · Esc to cancel${ansi.reset}`;

export type ToolApprovalDecision =
  | { action: "allow" }
  | { action: "allow-session" }
  | { action: "allow-allowlist" }
  | { action: "deny" };

export interface ToolApprovalContent {
  title: string;
  subtitle: string;
  previewLines: string[];
  question: string;
  rows: ChoiceRow[];
  networkHosts: string[];
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

function extractHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

const HTTP_URL_IN_BASH = /https?:\/\/[^\s"'<>]+/gi;

function extractHttpUrlsFromBash(command: string): string[] {
  const matches = command.match(HTTP_URL_IN_BASH) ?? [];
  return [...new Set(matches)];
}

function networkHostsFromToolCall(toolCall: ToolCall): string[] {
  if (toolCall.name === "WebFetch") {
    const host = networkHostFromInput(toolCall.input);
    return host ? [host] : [];
  }
  if (toolCall.name === "Bash") {
    const command = String(toolCall.input.command ?? "");
    const hosts = extractHttpUrlsFromBash(command)
      .map((url) => extractHostname(url))
      .filter((host): host is string => Boolean(host));
    return [...new Set(hosts)];
  }
  return [];
}

function networkAllowlistLabel(hosts: string[]): string {
  if (hosts.length === 1) {
    return `Yes, and save ${hosts[0]!} to allowlist (persists permanently)`;
  }
  return `Yes, and save ${hosts.length} hosts to allowlist (persists permanently)`;
}

function networkHostFromInput(raw: Record<string, unknown>): string | undefined {
  const url = String(raw.url ?? "").trim();
  if (!url) return undefined;
  return extractHostname(url) ?? undefined;
}

export function sessionAllowExtras(
  toolCall: ToolCall,
  cwd: string,
): {
  sessionAllow: SessionAllowKind;
  networkHost?: string;
  mcpTool?: string;
  workspacePath?: string;
} {
  if (parseMcpToolName(toolCall.name)) {
    return { sessionAllow: "mcp-tool", mcpTool: toolCall.name };
  }
  if (toolCall.name === "WebFetch" || toolCall.name === "WebSearch") {
    const host = networkHostFromInput(toolCall.input);
    return { sessionAllow: "network-host", networkHost: host };
  }
  if (toolCall.name === "Bash") {
    return { sessionAllow: "bash-command" };
  }
  if (
    toolCall.name === "Write" ||
    toolCall.name === "Edit" ||
    toolCall.name === "NotebookEdit"
  ) {
    const rawPath = String(
      toolCall.input.file_path ?? toolCall.input.path ?? toolCall.input.notebook_path ?? "",
    ).trim();
    if (rawPath) {
      const abs = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
      return { sessionAllow: "workspace-path", workspacePath: abs };
    }
    return { sessionAllow: "writes" };
  }
  return { sessionAllow: "writes" };
}

function sessionAllowLabel(toolCall: ToolCall, cwd: string): string {
  const extras = sessionAllowExtras(toolCall, cwd);
  if (extras.sessionAllow === "network-host" && extras.networkHost) {
    return `Yes, allow ${extras.networkHost} during this session (shift+tab)`;
  }
  if (extras.sessionAllow === "mcp-tool") {
    return "Yes, allow this MCP tool during this session (shift+tab)";
  }
  if (extras.sessionAllow === "workspace-path" && extras.workspacePath) {
    return `Yes, allow paths under ${basename(extras.workspacePath)} during this session (shift+tab)`;
  }
  if (toolCall.name === "Bash") {
    return "Yes, allow this command during this session (shift+tab)";
  }
  if (toolCall.name === "Write" || toolCall.name === "Edit" || toolCall.name === "NotebookEdit") {
    return "Yes, allow all edits during this session (shift+tab)";
  }
  return "Yes, allow during this session (shift+tab)";
}

export function buildToolApprovalRows(networkHosts: string[] = []): ChoiceRow[] {
  const rows: ChoiceRow[] = [
    { kind: "option", label: "Yes", optionIndex: 0 },
    { kind: "option", label: "", optionIndex: 1 },
  ];
  if (networkHosts.length > 0) {
    rows.push({
      kind: "option",
      label: networkAllowlistLabel(networkHosts),
      optionIndex: 2,
    });
    rows.push({ kind: "option", label: "No", optionIndex: 3 });
  } else {
    rows.push({ kind: "option", label: "No", optionIndex: 2 });
  }
  return rows;
}

export function toolApprovalDecisionFromRow(
  row: ChoiceRow,
  networkHosts: string[] = [],
): ToolApprovalDecision {
  if (row.kind !== "option" || row.optionIndex === undefined) {
    return { action: "deny" };
  }
  if (row.optionIndex === 0) return { action: "allow" };
  if (row.optionIndex === 1) return { action: "allow-session" };
  if (networkHosts.length > 0 && row.optionIndex === 2) return { action: "allow-allowlist" };
  return { action: "deny" };
}

export function toolConfirmResultFromDecision(
  toolCall: ToolCall,
  decision: ToolApprovalDecision,
  cwd?: string,
): ToolConfirmResult {
  if (decision.action === "deny") {
    return { allowed: false, denialReason: "User denied tool execution" };
  }
  if (decision.action === "allow-session") {
    const extras = sessionAllowExtras(toolCall, cwd ?? process.cwd());
    return {
      allowed: true,
      sessionAllow: extras.sessionAllow,
      networkHost: extras.networkHost,
      mcpTool: extras.mcpTool,
      workspacePath: extras.workspacePath,
    };
  }
  if (decision.action === "allow-allowlist") {
    const hosts = networkHostsFromToolCall(toolCall);
    return {
      allowed: true,
      networkAllowlistHosts: hosts.length > 0 ? hosts : undefined,
    };
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

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function buildFileDiffPreview(
  before: string,
  after: string,
  cols: number,
  filePath: string,
): Promise<string[]> {
  return renderFilePreviewLines(before, after, cols, {
    collapsed: false,
    filePath,
  });
}

function hasMeaningfulToolInput(input: Record<string, unknown>): boolean {
  return Object.keys(input).length > 0;
}

export function formatMcpToolDescription(raw: string): string {
  return raw.replace(/^\[MCP:[^\]]+\]\s*/, "").trim() || raw.trim();
}

async function resolveMcpToolDescription(toolName: string): Promise<string | undefined> {
  const parsed = parseMcpToolName(toolName);
  if (!parsed) return undefined;
  const tools = await listAllCachedTools();
  const match = tools.find(
    (tool) => tool.serverId === parsed.serverId && tool.name === parsed.toolName,
  );
  if (!match?.description) return undefined;
  return formatMcpToolDescription(match.description);
}

function wrapMutedPreviewLines(text: string, cols: number): string[] {
  return wrapContentLines(text, Math.max(20, cols - 4)).map(
    (line) => `${ansi.muted}${line}${ansi.reset}`,
  );
}

export async function buildToolApprovalContent(
  toolCall: ToolCall,
  cwd: string,
  cols: number,
): Promise<ToolApprovalContent> {
  const networkHosts = networkHostsFromToolCall(toolCall);
  const rows = buildToolApprovalRows(networkHosts);
  rows[1]!.label = sessionAllowLabel(toolCall, cwd);

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
        networkHosts,
      };
    }
    const absPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
    const exists = absPath ? await fileExists(absPath) : false;
    const displayPath = filePathFromInput(toolCall.input, cwd);
    const content = writeContent(toolCall.input);
    const title = exists ? "Update file" : "Create file";
    let preview: string[];
    if (exists) {
      const before = (await readTextFile(absPath)) ?? "";
      preview = await buildFileDiffPreview(before, content, cols, absPath);
    } else {
      preview = await buildFileDiffPreview("", content, cols, absPath);
    }
    return {
      title,
      subtitle: displayPath,
      previewLines: preview,
      question: `Do you want to ${exists ? "update" : "create"} ${basename(displayPath) || displayPath}?`,
      rows,
      networkHosts,
    };
  }

  if (toolCall.name === "Edit" || toolCall.name === "NotebookEdit") {
    const displayPath = filePathFromInput(toolCall.input, cwd);
    const rawPath = String(
      toolCall.input.file_path ?? toolCall.input.path ?? toolCall.input.notebook_path ?? "",
    ).trim();
    const absPath = rawPath
      ? isAbsolute(rawPath)
        ? resolve(rawPath)
        : resolve(cwd, rawPath)
      : "";
    const oldString = String(toolCall.input.old_string ?? "");
    const newString = String(toolCall.input.new_string ?? toolCall.input.new_str ?? "");
    const replaceAll = toolCall.input.replace_all === true;
    let preview: string[];
    if (absPath) {
      const before = (await readTextFile(absPath)) ?? "";
      const after = applyEditPreview(before, oldString, newString, replaceAll);
      preview = await buildFileDiffPreview(before, after, cols, absPath);
    } else if (newString || oldString) {
      preview = await buildFileDiffPreview(oldString, newString, cols, displayPath);
    } else {
      preview = [`${ansi.muted}(edit preview unavailable)${ansi.reset}`];
    }
    return {
      title: "Edit file",
      subtitle: displayPath,
      previewLines: preview,
      question: `Do you want to edit ${basename(displayPath) || displayPath}?`,
      rows,
      networkHosts,
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
      networkHosts,
    };
  }

  if (toolCall.name === "WebFetch" || toolCall.name === "WebSearch") {
    const host = networkHostFromInput(toolCall.input);
    const url = String(toolCall.input.url ?? toolCall.input.query ?? "").trim();
    return {
      title: toolCall.name === "WebFetch" ? "Fetch URL" : "Web search",
      subtitle: host ? `${host}${url ? ` — ${url}` : ""}` : url || toolCall.name,
      previewLines: [],
      question: host
        ? `Allow network access to ${host}?`
        : `Allow ${toolCall.name}?`,
      rows,
      networkHosts,
    };
  }

  if (parseMcpToolName(toolCall.name)) {
    const description = await resolveMcpToolDescription(toolCall.name);
    const preview = description
      ? wrapMutedPreviewLines(description, cols)
      : hasMeaningfulToolInput(toolCall.input)
        ? wrapMutedPreviewLines(JSON.stringify(toolCall.input, null, 2).slice(0, 500), cols)
        : [];
    return {
      title: "MCP tool",
      subtitle: toolCall.name,
      previewLines: preview,
      question: `Allow ${toolCall.name}?`,
      rows,
      networkHosts,
    };
  }

  const detail = JSON.stringify(toolCall.input).slice(0, 200);
  return {
    title: toolCall.name,
    subtitle: detail,
    previewLines: [],
    question: `Allow ${toolCall.name}?`,
    rows,
    networkHosts,
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
  const rows = buildToolApprovalRows(["example.com"]);
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
