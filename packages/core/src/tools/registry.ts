import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  AgentId,
  AskUserQuestionPrompt,
  LLMMessage,
  PermissionMode,
  SessionAllowKind,
  SessionCapability,
  SessionId,
  ToolAuditMetadata,
  ToolCall,
  ToolConfirmResult,
  ToolDefinition,
  ToolHandler,
  ToolResult,
  ToolUseId,
  WorktreeSessionInfo,
} from "@kako/shared";
import { normalizeToolConfirmResult } from "@kako/shared";
import type { NetworkPolicy } from "../config/network-store.js";
import { addHostsToUserAllowlist, loadNetworkPolicy } from "../config/network-store.js";
import { loadMcpRegistry } from "../mcp/config.js";
import { resolveMcpExceptionHosts } from "../mcp/network-access.js";
import { runWithFetchSecurityScope } from "../net/isolated-fetch.js";
import { collectUserTextFromMessages } from "../locale/user-timezone.js";
import { defaultSessionCapability, loadSecurityPolicy, type SecurityPolicy } from "../security/policy-store.js";
import { runSecurityGate, type SecurityContext } from "../security/pipeline.js";
import { redactSecretsInValue } from "../security/secret-guard.js";
import { resolvePath } from "./builtin/path.js";
import { buildWebSearchDescription } from "./builtin/web-search.js";
import { findSkillByMdPath } from "../skills/loader.js";
import { toolCallNeedsUserConfirm } from "./confirm-policy.js";
import {
  fileVersionChanged,
  snapshotFileVersion,
  type FileVersionSnapshot,
} from "./file-version.js";
import { validateToolCallInput } from "./tool-input-validation.js";
import { boundToolResultForModel } from "./oversized-result.js";

export interface ToolRegistryOptions {
  cwd: string;
  sessionId: SessionId;
  agentId: AgentId;
  permissionMode?: PermissionMode;
  capability?: SessionCapability;
  confirm?: (toolCall: ToolCall) => Promise<ToolConfirmResult>;
  askUserQuestion?: AskUserQuestionPrompt;
  allowedSkills?: string[];
  /** Skills pre-activated via slash harness (skip Skill tool round-trip). */
  initialActivatedSkills?: string[];
  /** Active plan file path when in plan mode (Write/Edit allowed only here). */
  planFilePath?: string;
  worktreeSession?: WorktreeSessionInfo;
  /**
   * Shared across turn registries for the same chat session so "allow during
   * this session" survives createToolRegistry-per-turn.
   */
  sessionAllows?: SessionToolAllows;
  /** Auto-mode LLM security monitor (bypassPermissions only). */
  classifyAction?: (
    toolCall: ToolCall,
    definition: ToolDefinition,
  ) => Promise<{ shouldBlock: boolean; category?: string; reason?: string }>;
}

/** Mutable session-scoped approvals (shared by reference across turn registries). */
export interface SessionToolAllows {
  writesAllowed: boolean;
  bashCommands: Set<string>;
  hosts: Set<string>;
  mcpTools: Set<string>;
  workspacePaths: Set<string>;
}

export function createSessionToolAllows(): SessionToolAllows {
  return {
    writesAllowed: false,
    bashCommands: new Set(),
    hosts: new Set(),
    mcpTools: new Set(),
    workspacePaths: new Set(),
  };
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
  /** Last known on-disk version after Read/Write/Edit in this session. */
  private fileVersions = new Map<string, FileVersionSnapshot>();
  /** Skills activated during this registry's conversation turn. */
  private activatedSkills = new Set<string>();
  /** Session-wide auto-allows — shared bag when provided by AgentRuntime. */
  private sessionAllows: SessionToolAllows;
  private securityPolicy?: SecurityPolicy;
  private networkPolicy?: NetworkPolicy;
  /**
   * Serializes confirm() so parallel tool clusters cannot race the CLI's
   * single-resolve approval UI. Re-evaluates needsConfirm under the lock so a
   * sessionAllow from an earlier sibling can skip later prompts.
   */
  private confirmChain: Promise<void> = Promise.resolve();

  constructor(options: ToolRegistryOptions) {
    this.options = options;
    this.sessionAllows = options.sessionAllows ?? createSessionToolAllows();
    for (const name of options.initialActivatedSkills ?? []) {
      this.activatedSkills.add(name.trim());
    }
  }

  activateSkill(name: string): void {
    this.activatedSkills.add(name.trim());
  }

  private async ensurePolicies(): Promise<{ security: SecurityPolicy; network: NetworkPolicy }> {
    if (!this.securityPolicy) {
      this.securityPolicy = await loadSecurityPolicy(this.options.cwd);
    }
    if (!this.networkPolicy) {
      this.networkPolicy = await loadNetworkPolicy();
    }
    return { security: this.securityPolicy, network: this.networkPolicy };
  }

  private securityContext(policies: {
    security: SecurityPolicy;
    network: NetworkPolicy;
  }): SecurityContext {
    return {
      cwd: this.options.cwd,
      capability:
        this.options.capability ?? defaultSessionCapability(policies.security),
      policy: policies.security,
      networkPolicy: policies.network,
      permissionMode: this.options.permissionMode ?? "default",
      sessionAllowedHosts: this.sessionAllows.hosts,
      sessionAllowedMcpTools: this.sessionAllows.mcpTools,
      sessionAllowedWorkspacePaths: this.sessionAllows.workspacePaths,
      classifyAction: this.options.classifyAction,
    };
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

  private async noteFileVersion(path: string): Promise<void> {
    const normalized = this.normalizePath(path);
    try {
      this.fileVersions.set(normalized, await snapshotFileVersion(normalized));
    } catch {
      this.fileVersions.delete(normalized);
    }
  }

  private async isFileVersionStale(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);
    const known = this.fileVersions.get(normalized);
    if (!known) return false;
    try {
      const current = await snapshotFileVersion(normalized);
      return fileVersionChanged(known, current);
    } catch {
      return false;
    }
  }

  private isSkillActive(name: string): boolean {
    return this.activatedSkills.has(name.trim());
  }

  private isSessionAllowed(toolCall: ToolCall): boolean {
    if (
      this.sessionAllows.writesAllowed &&
      (toolCall.name === "Write" || toolCall.name === "Edit" || toolCall.name === "NotebookEdit")
    ) {
      return true;
    }
    if (toolCall.name === "Bash") {
      const command = String(toolCall.input.command ?? "").trim();
      if (command && this.sessionAllows.bashCommands.has(command)) {
        return true;
      }
    }
    if (toolCall.name.startsWith("mcp/") && this.sessionAllows.mcpTools.has(toolCall.name)) {
      return true;
    }
    return false;
  }

  private applySessionAllow(
    toolCall: ToolCall,
    sessionAllow?: SessionAllowKind,
    extras?: {
      networkHost?: string;
      mcpTool?: string;
      workspacePath?: string;
    },
  ): void {
    if (sessionAllow === "writes") {
      this.sessionAllows.writesAllowed = true;
      return;
    }
    if (sessionAllow === "bash-command" && toolCall.name === "Bash") {
      const command = String(toolCall.input.command ?? "").trim();
      if (command) this.sessionAllows.bashCommands.add(command);
    }
    if (sessionAllow === "network-host" && extras?.networkHost) {
      this.sessionAllows.hosts.add(extras.networkHost.toLowerCase());
    }
    if (sessionAllow === "mcp-tool" && extras?.mcpTool) {
      this.sessionAllows.mcpTools.add(extras.mcpTool);
    }
    if (sessionAllow === "workspace-path" && extras?.workspacePath) {
      this.sessionAllows.workspacePaths.add(resolve(extras.workspacePath));
    }
  }

  private async withConfirmLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.confirmChain;
    let release!: () => void;
    this.confirmChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private computeNeedsConfirm(
    toolCall: ToolCall,
    definition: ToolDefinition,
    gate: Awaited<ReturnType<typeof runSecurityGate>>,
    mode: PermissionMode,
    security: SecurityPolicy,
  ): boolean {
    const skipTrustedWorkspaceWrite =
      gate.trustedWorkspaceWrite &&
      (toolCall.name === "Write" ||
        toolCall.name === "Edit" ||
        toolCall.name === "NotebookEdit");
    return (
      !skipTrustedWorkspaceWrite &&
      !this.isSessionAllowed(toolCall) &&
      (gate.needsConfirm ||
        (!gate.allowlistedNetwork &&
          toolCallNeedsUserConfirm(
            toolCall,
            definition,
            mode,
            security,
            gate.mcpApproval,
          )))
    );
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

  getCapability(): SessionCapability {
    return this.options.capability ?? "WorkspaceWrite";
  }

  setCapability(capability: SessionCapability): void {
    this.options.capability = capability;
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
    this.securityPolicy = undefined;
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

    const policies = await this.ensurePolicies();
    const mcpRegistry = await loadMcpRegistry();
    const networkDisabled = !policies.network.enabled;
    const mcpExceptionHosts = networkDisabled
      ? resolveMcpExceptionHosts(mcpRegistry.servers, policies.network)
      : undefined;
    const gate = await runSecurityGate(toolCall, definition, this.securityContext(policies));

    if (!gate.allowed) {
      return this.result(
        toolCall,
        start,
        "error",
        undefined,
        gate.error ?? "Denied by security policy",
        gate.audit,
      );
    }

    const mode = this.options.permissionMode ?? "default";
    let needsConfirm = this.computeNeedsConfirm(
      toolCall,
      definition,
      gate,
      mode,
      policies.security,
    );

    let approvedPermissionMode: PermissionMode | undefined;
    let audit: ToolAuditMetadata = { ...gate.audit };
    let liveGate = gate;

    if (needsConfirm && this.options.confirm) {
      const confirmOutcome = await this.withConfirmLock(async () => {
        // Sibling tools may have applied sessionAllow while we waited.
        liveGate = await runSecurityGate(toolCall, definition, this.securityContext(policies));
        if (!liveGate.allowed) {
          return {
            kind: "denied" as const,
            error: liveGate.error ?? "Denied by security policy",
            audit: liveGate.audit,
          };
        }
        needsConfirm = this.computeNeedsConfirm(
          toolCall,
          definition,
          liveGate,
          mode,
          policies.security,
        );
        if (!needsConfirm) {
          return {
            kind: "skipped" as const,
            audit: { ...liveGate.audit, approvalResult: "skipped" as const },
          };
        }
        const confirmResult = normalizeToolConfirmResult(await this.options.confirm!(toolCall));
        if (!confirmResult.allowed) {
          return {
            kind: "denied" as const,
            error: confirmResult.denialReason ?? "User denied tool execution",
            audit: {
              ...liveGate.audit,
              approvalRequired: true,
              approvalResult: "denied" as const,
            },
          };
        }
        this.applySessionAllow(toolCall, confirmResult.sessionAllow, {
          networkHost: confirmResult.networkHost,
          mcpTool: confirmResult.mcpTool,
          workspacePath: confirmResult.workspacePath,
        });
        if (confirmResult.networkAllowlistHosts?.length) {
          policies.network = await addHostsToUserAllowlist(
            confirmResult.networkAllowlistHosts,
            policies.network,
          );
          this.networkPolicy = policies.network;
        }
        if (confirmResult.inputPatch) {
          Object.assign(toolCall.input, confirmResult.inputPatch);
        }
        return {
          kind: "allowed" as const,
          permissionMode: confirmResult.permissionMode,
          audit: {
            ...liveGate.audit,
            approvalRequired: true,
            approvalResult: "allowed" as const,
          },
        };
      });

      if (confirmOutcome.kind === "denied") {
        return this.result(
          toolCall,
          start,
          confirmOutcome.audit.approvalResult === "denied" ? "denied" : "error",
          undefined,
          confirmOutcome.error,
          confirmOutcome.audit,
        );
      }
      audit = confirmOutcome.audit;
      if (confirmOutcome.kind === "allowed") {
        approvedPermissionMode = confirmOutcome.permissionMode;
      }
    } else if (needsConfirm && !this.options.confirm) {
      audit.approvalResult = "skipped";
    } else {
      audit.approvalResult = liveGate.audit.approvalResult ?? "skipped";
    }

    if (mode === "plan" && isWriteTool(toolCall.name)) {
      if (!this.isPlanFileWrite(toolCall)) {
        return this.result(
          toolCall,
          start,
          "denied",
          undefined,
          "Plan mode: write tools disabled",
          audit,
        );
      }
    }

    try {
      const output = await runWithFetchSecurityScope(
        {
          enforceNetworkPolicy: true,
          networkPolicy: policies.network,
          sessionAllowedHosts: this.sessionAllows.hosts,
          mcpContext: networkDisabled && toolCall.name.startsWith("mcp/"),
          mcpExceptionHosts,
        },
        () =>
          handler(toolCall.input, {
            agentId: this.options.agentId,
            sessionId: this.options.sessionId,
            toolUseId: toolCall.id,
            cwd: this.options.cwd,
            askUserQuestion: this.options.askUserQuestion,
            markFileRead: (path) => this.markFileRead(path),
            hasReadFile: (path) => this.hasReadFile(path),
            isFileVersionStale: (path) => this.isFileVersionStale(path),
            noteFileVersion: (path) => this.noteFileVersion(path),
            allowedSkills: this.options.allowedSkills,
            isSkillActive: (name) => this.isSkillActive(name),
            getPermissionMode: () => this.getPermissionMode(),
            setPermissionMode: (m) => this.setPermissionMode(m),
            getCapability: () => this.getCapability(),
            getPlanFilePath: () => this.getPlanFilePath(),
            setPlanFilePath: (path) => this.setPlanFilePath(path),
            getApprovedPermissionMode: () => approvedPermissionMode,
            setCwd: (cwd) => this.setCwd(cwd),
            getWorktreeSession: () => this.getWorktreeSession(),
            setWorktreeSession: (session) => this.setWorktreeSession(session),
          }),
      );
      if (toolCall.name === "Read") {
        const readPath = toolCall.input.file_path ?? toolCall.input.path;
        if (typeof readPath === "string") {
          this.markFileRead(readPath);
          await this.noteFileVersion(String(readPath));
          const skill = await findSkillByMdPath(String(readPath), this.options.cwd);
          if (skill) {
            this.activatedSkills.add(skill.name);
          }
        }
      }
      if (toolCall.name === "Write" || toolCall.name === "Edit") {
        const touchedPath = filePathFromToolInput(toolCall.input, this.options.cwd);
        if (touchedPath) {
          this.markFileRead(touchedPath);
          await this.noteFileVersion(touchedPath);
        }
      }
      const redacted = redactSecretsInValue(output, policies.security);
      let finalOutput: unknown = redacted;
      if (typeof redacted === "string" && redacted.length > 0) {
        finalOutput = await boundToolResultForModel({
          sessionId: this.options.sessionId,
          toolCallId: toolCall.id,
          content: redacted,
        });
      }
      const result = this.result(toolCall, start, "success", finalOutput, undefined, audit);
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
      return this.result(toolCall, start, status, undefined, message, audit);
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
    audit?: ToolAuditMetadata,
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
      audit,
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
