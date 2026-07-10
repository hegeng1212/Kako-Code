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
import { validateToolCallInput } from "./tool-input-validation.js";

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
  private sessionAllowedHosts = new Set<string>();
  private sessionAllowedMcpTools = new Set<string>();
  private sessionAllowedWorkspacePaths = new Set<string>();
  private securityPolicy?: SecurityPolicy;
  private networkPolicy?: NetworkPolicy;

  constructor(options: ToolRegistryOptions) {
    this.options = options;
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
      sessionAllowedHosts: this.sessionAllowedHosts,
      sessionAllowedMcpTools: this.sessionAllowedMcpTools,
      sessionAllowedWorkspacePaths: this.sessionAllowedWorkspacePaths,
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
    if (toolCall.name.startsWith("mcp/") && this.sessionAllowedMcpTools.has(toolCall.name)) {
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
      this.sessionWritesAllowed = true;
      return;
    }
    if (sessionAllow === "bash-command" && toolCall.name === "Bash") {
      const command = String(toolCall.input.command ?? "").trim();
      if (command) this.sessionAllowedBashCommands.add(command);
    }
    if (sessionAllow === "network-host" && extras?.networkHost) {
      this.sessionAllowedHosts.add(extras.networkHost.toLowerCase());
    }
    if (sessionAllow === "mcp-tool" && extras?.mcpTool) {
      this.sessionAllowedMcpTools.add(extras.mcpTool);
    }
    if (sessionAllow === "workspace-path" && extras?.workspacePath) {
      this.sessionAllowedWorkspacePaths.add(resolve(extras.workspacePath));
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
    const skipTrustedWorkspaceWrite =
      gate.trustedWorkspaceWrite &&
      (toolCall.name === "Write" ||
        toolCall.name === "Edit" ||
        toolCall.name === "NotebookEdit");
    const needsConfirm =
      !skipTrustedWorkspaceWrite &&
      !this.isSessionAllowed(toolCall) &&
      (gate.needsConfirm ||
        (!gate.allowlistedNetwork &&
          toolCallNeedsUserConfirm(
            toolCall,
            definition,
            mode,
            policies.security,
            gate.mcpApproval,
          )));

    let approvedPermissionMode: PermissionMode | undefined;
    let audit: ToolAuditMetadata = { ...gate.audit };

    if (needsConfirm && this.options.confirm) {
      audit.approvalRequired = true;
      const confirmResult = normalizeToolConfirmResult(await this.options.confirm(toolCall));
      if (!confirmResult.allowed) {
        audit.approvalResult = "denied";
        return this.result(
          toolCall,
          start,
          "denied",
          undefined,
          confirmResult.denialReason ?? "User denied tool execution",
          audit,
        );
      }
      audit.approvalResult = "allowed";
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
      approvedPermissionMode = confirmResult.permissionMode;
      if (confirmResult.inputPatch) {
        Object.assign(toolCall.input, confirmResult.inputPatch);
      }
    } else if (needsConfirm && !this.options.confirm) {
      audit.approvalResult = "skipped";
    } else {
      audit.approvalResult = gate.audit.approvalResult ?? "skipped";
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
          sessionAllowedHosts: this.sessionAllowedHosts,
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
          const skill = await findSkillByMdPath(String(readPath), this.options.cwd);
          if (skill) {
            this.activatedSkills.add(skill.name);
          }
        }
      }
      if (toolCall.name === "Write") {
        const writtenPath = filePathFromToolInput(toolCall.input, this.options.cwd);
        if (writtenPath) {
          this.markFileRead(writtenPath);
        }
      }
      const redacted = redactSecretsInValue(output, policies.security);
      const result = this.result(toolCall, start, "success", redacted, undefined, audit);
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
