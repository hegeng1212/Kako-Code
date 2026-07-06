import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  AgentId,
  AskUserQuestionPrompt,
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
import { resolvePath } from "./builtin/path.js";
import { findSkillByMdPath } from "../skills/loader.js";
import { isToolCallInTrustedScope } from "./permission-scope.js";

export interface ToolRegistryOptions {
  cwd: string;
  sessionId: SessionId;
  agentId: AgentId;
  permissionMode?: PermissionMode;
  confirm?: (toolCall: ToolCall) => Promise<ToolConfirmResult>;
  askUserQuestion?: AskUserQuestionPrompt;
  allowedSkills?: string[];
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

  constructor(options: ToolRegistryOptions) {
    this.options = options;
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

  toLLMTools(names?: string[]) {
    return this.getDefinitions(names).map((tool) => ({
      name: tool.name,
      description: tool.description,
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
    const mode = this.options.permissionMode ?? "default";
    const needsConfirm =
      definition.requiresConfirmation &&
      mode !== "bypassPermissions" &&
      !(mode === "acceptEdits" &&
        (toolCall.name === "Write" ||
          toolCall.name === "Edit" ||
          toolCall.name === "NotebookEdit")) &&
      !isToolCallInTrustedScope(toolCall, this.options.cwd);

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
      approvedPermissionMode = confirmResult.permissionMode;
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
        const skillName = toolCall.input.command ?? toolCall.input.skill;
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
