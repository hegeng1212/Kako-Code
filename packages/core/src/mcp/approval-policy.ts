import type { McpApprovalMode, McpServerConfig } from "@kako/shared";
import { parseMcpToolName, resolveMcpToolApprovalMode } from "@kako/shared";

/** Resolve effective MCP approval for a prefixed tool name. */
export function resolveMcpApprovalForToolCall(
  toolName: string,
  servers: McpServerConfig[],
): McpApprovalMode | undefined {
  const parsed = parseMcpToolName(toolName);
  if (!parsed) return undefined;
  const server = servers.find((s) => s.id === parsed.serverId);
  return resolveMcpToolApprovalMode(server, parsed.toolName);
}
