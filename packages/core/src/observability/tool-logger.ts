import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolLogEntry, ToolResult } from "@kako/shared";
import { parseMcpToolName } from "@kako/shared";
import { getToolLogsDir } from "../config/paths.js";
import { loadSecurityPolicy } from "../security/policy-store.js";
import { redactSecretsInValue } from "../security/secret-guard.js";
import { insertToolLogEntry } from "./store.js";

export class ToolLogger {
  async log(result: ToolResult): Promise<void> {
    const parsed = parseMcpToolName(result.name);
    const policy = await loadSecurityPolicy(process.cwd());
    const entry: ToolLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: result.sessionId,
      agentId: result.agentId,
      toolUseId: result.toolUseId,
      toolName: result.name,
      input: redactSecretsInValue(result.input, policy) as Record<string, unknown>,
      output: redactSecretsInValue(result.output, policy),
      status: result.status,
      durationMs: result.durationMs,
      ...(parsed
        ? { mcpServerId: parsed.serverId, mcpToolName: parsed.toolName }
        : {}),
      ...(result.audit?.riskLevel ? { riskLevel: result.audit.riskLevel } : {}),
      ...(result.audit?.approvalRequired !== undefined
        ? { approvalRequired: result.audit.approvalRequired }
        : {}),
      ...(result.audit?.approvalResult
        ? { approvalResult: result.audit.approvalResult }
        : {}),
      ...(result.audit?.approvalMode ? { approvalMode: result.audit.approvalMode } : {}),
      ...(result.audit?.capability ? { capability: result.audit.capability } : {}),
      ...(result.audit?.workspaceViolation
        ? { workspaceViolation: result.audit.workspaceViolation }
        : {}),
      ...(result.audit?.networkTarget ? { networkTarget: result.audit.networkTarget } : {}),
      ...(result.audit?.networkDecision
        ? { networkDecision: result.audit.networkDecision }
        : {}),
    };

    await insertToolLogEntry(entry);

    const date = entry.timestamp.slice(0, 10);
    const dir = getToolLogsDir();
    await mkdir(dir, { recursive: true });
    await appendFile(
      join(dir, `${date}.jsonl`),
      `${JSON.stringify(entry)}\n`,
      "utf-8",
    );
  }
}
