import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  AgentId,
  AskUserQuestionPrompt,
  LLMMessage,
  PermissionMode,
  SessionId,
  ToolCall,
  ToolConfirmResult,
  ToolDefinition,
  ToolHandler,
  ToolResult,
  ToolUseId,
  WorktreeSessionInfo,
} from "@kako/shared";
import { normalizeToolConfirmResult } from "@kako/shared";
import { collectUserTextFromMessages } from "../locale/user-timezone.js";
import { resolvePath } from "./builtin/path.js";
import { buildWebSearchDescription } from "./builtin/web-search.js";
import { findSkillByMdPath } from "../skills/loader.js";
import { toolCallNeedsUserConfirm } from "./confirm-policy.js";
import { validateToolCallInput } from "./tool-input-validation.js";

export interface ToolRegistryOptions {
  cwd: string;
  sessionId: SessionId;
  agentId: AgentId;
  permissionMode?: PermissionMode;
  confirm?: (toolCall: ToolCall) => Promise<ToolConfirmResult>;
  askUserQuestion?: AskUserQuestionPrompt;
  allowedSkills?: string[];
  /** Skills pre-activated via slash harness (skip Skill tool round-trip). */
  initialActivatedSkills?: string[];
  /** Active plan file path when in plan mode (Write/Edit allowed only here). */
  planFilePath?: string;
  worktreeSession?: WorktreeSessionInfo;
}

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private options: ToolRegistryOptions;
  /** Files successfully Read during this registry's conversation turn. */
  private readFiles = new Set<string>();
  /** Skills activated during this registry's conversation turn. */
  private activatedSkills = new Set<string>();
  /** Session-wide auto-allow for write tools after user approval. */
  private sessionWritesAllowed = false;
  /** Session-wide auto-allow for identical bash commands after user approval. */
  private sessionAllowedBashCommands = new Set<string>();

  constructor(options: ToolRegistryOptions) {
    this.options = options;
    for (const name of options.initialActivatedSkills ?? []) {
      this.activatedSkills.add(name.trim());
    }
  }

  activateSkill(name: string): void {
    this.activatedSkills.add(name.trim());
  }

  private normalizePath(path: string): string {
    return resolve(resolvePath(path, this.options.cwd));
  }

  private markFileRead(path: string): void {
    this.readFiles.add(this.normalizePath(path));
  }

  private hasReadFile(path: string): boolean {
    return this.readFiles.has(this.normalizePath(path));
  }

  private isSkillActive(name: string): boolean {
    return this.activatedSkills.has(name.trim());
  }

  private isSessionAllowed(toolCall: ToolCall): boolean {
    if (
      this.sessionWritesAllowed &&
      (toolCall.name === "Write" || toolCall.name === "Edit" || toolCall.name === "NotebookEdit")
    ) {
      return true;
    }
    if (toolCall.name === "Bash") {
      const command = String(toolCall.input.command ?? "").trim();
      if (command && this.sessionAllowedBashCommands.has(command)) {
        return true;
      }
    }
    return false;
  }

  private applySessionAllow(toolCall: ToolCall, sessionAllow?: "writes" | "bash-command"): void {
    if (sessionAllow === "writes") {
      this.sessionWritesAllowed = true;
      return;
    }
    if (sessionAllow === "bash-command" && toolCall.name === "Bash") {
      const command = String(toolCall.input.command ?? "").trim();
      if (command) this.sessionAllowedBashCommands.add(command);
    }
  }

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getPermissionMode(): PermissionMode {
    return this.options.permissionMode ?? "default";
  }

  setPermissionMode(mode: PermissionMode): void {
    this.options.permissionMode = mode;
  }

  getPlanFilePath(): string | undefined {
    return this.options.planFilePath;
  }

  setPlanFilePath(path: string | undefined): void {
    this.options.planFilePath = path;
  }

  getCwd(): string {
    return this.options.cwd;
  }

  setCwd(cwd: string): void {
    this.options.cwd = resolve(cwd);
  }

  getWorktreeSession(): WorktreeSessionInfo | undefined {
    return this.options.worktreeSession;
  }

  setWorktreeSession(session: WorktreeSessionInfo | undefined): void {
    this.options.worktreeSession = session;
  }

  getDefinitions(names?: string[]): ToolDefinition[] {
    const all = [...this.tools.values()].map((t) => t.definition);
    if (!names?.length) return all;
    const allowed = new Set(names);
    return all.filter((d) => allowed.has(d.name));
  }

  toLLMTools(names?: string[], options?: { messages?: LLMMessage[] }) {
    const userText = options?.messages?.length
      ? collectUserTextFromMessages(options.messages)
      : undefined;
    return this.getDefinitions(names).map((tool) => ({
      name: tool.name,
      description:
        tool.name === "WebSearch" ? buildWebSearchDescription(userText) : tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    const registered = this.tools.get(toolCall.name);

    if (!registered) {
      return this.result(toolCall, start, "error", undefined, `Unknown tool: ${toolCall.name}`);
    }

    const { definition, handler } = registered;

    const inputError = validateToolCallInput(toolCall);
    if (inputError) {
      return this.result(toolCall, start, "error", undefined, inputError);
    }

    const mode = this.options.permissionMode ?? "default";
    const needsConfirm =
      !this.isSessionAllowed(toolCall) &&
      toolCallNeedsUserConfirm(toolCall, definition, mode);

    let approvedPermissionMode: PermissionMode | undefined;

    if (needsConfirm && this.options.confirm) {
      const confirmResult = normalizeToolConfirmResult(await this.options.confirm(toolCall));
      if (!confirmResult.allowed) {
        return this.result(
          toolCall,
          start,
          "denied",
          undefined,
          confirmResult.denialReason ?? "User denied tool execution",
        );
      }
      this.applySessionAllow(toolCall, confirmResult.sessionAllow);
      approvedPermissionMode = confirmResult.permissionMode;
      if (confirmResult.inputPatch) {
        Object.assign(toolCall.input, confirmResult.inputPatch);
      }
    }

    if (mode === "plan" && isWriteTool(toolCall.name)) {
      if (!this.isPlanFileWrite(toolCall)) {
        return this.result(toolCall, start, "denied", undefined, "Plan mode: write tools disabled");
      }
    }

    try {
      const output = await handler(toolCall.input, {
        agentId: this.options.agentId,
        sessionId: this.options.sessionId,
        toolUseId: toolCall.id,
        cwd: this.options.cwd,
        askUserQuestion: this.options.askUserQuestion,
        markFileRead: (path) => this.markFileRead(path),
        hasReadFile: (path) => this.hasReadFile(path),
        allowedSkills: this.options.allowedSkills,
        isSkillActive: (name) => this.isSkillActive(name),
        getPermissionMode: () => this.getPermissionMode(),
        setPermissionMode: (mode) => this.setPermissionMode(mode),
        getPlanFilePath: () => this.getPlanFilePath(),
        setPlanFilePath: (path) => this.setPlanFilePath(path),
        getApprovedPermissionMode: () => approvedPermissionMode,
        setCwd: (cwd) => this.setCwd(cwd),
        getWorktreeSession: () => this.getWorktreeSession(),
        setWorktreeSession: (session) => this.setWorktreeSession(session),
      });
      if (toolCall.name === "Read") {
        const readPath = toolCall.input.file_path ?? toolCall.input.path;
        if (typeof readPath === "string") {
          this.markFileRead(readPath);
          const skill = await findSkillByMdPath(String(readPath), this.options.cwd);
          if (skill) {
            this.activatedSkills.add(skill.name);
          }
        }
      }
      const result = this.result(toolCall, start, "success", output);
      if (toolCall.name === "Skill") {
        const skillName = toolCall.input.skill ?? toolCall.input.command;
        if (typeof skillName === "string") {
          this.activatedSkills.add(String(skillName).trim());
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("TIMEOUT") ? "timeout" : "error";
      return this.result(toolCall, start, status, undefined, message);
    }
  }

  private isPlanFileWrite(toolCall: ToolCall): boolean {
    if (
      toolCall.name !== "Write" &&
      toolCall.name !== "Edit" &&
      toolCall.name !== "NotebookEdit"
    ) {
      return false;
    }
    const planPath = this.options.planFilePath;
    if (!planPath) return false;
    const target = filePathFromToolInput(toolCall.input, this.options.cwd);
    if (!target) return false;
    return resolve(target) === resolve(planPath);
  }

  private result(
    toolCall: ToolCall,
    start: number,
    status: ToolResult["status"],
    output?: unknown,
    error?: string,
  ): ToolResult {
    return {
      toolUseId: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      output,
      status,
      error,
      durationMs: Date.now() - start,
      agentId: this.options.agentId,
      sessionId: this.options.sessionId,
    };
  }
}

export function createToolUseId(): ToolUseId {
  return `tu-${randomUUID().slice(0, 8)}`;
}

function isWriteTool(name: string): boolean {
  return name === "Write" || name === "Edit" || name === "NotebookEdit" || name === "Bash";
}

function filePathFromToolInput(
  input: Record<string, unknown>,
  cwd: string,
): string | null {
  const raw = input.file_path ?? input.path ?? input.notebook_path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return resolve(resolvePath(raw, cwd));
}
