import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolLogEntry, ToolResult } from "@kako/shared";
import { parseMcpToolName } from "@kako/shared";
import { getToolLogsDir } from "../config/paths.js";
import { insertToolLogEntry } from "./store.js";

export class ToolLogger {
  async log(result: ToolResult): Promise<void> {
    const parsed = parseMcpToolName(result.name);
    const entry: ToolLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: result.sessionId,
      agentId: result.agentId,
      toolUseId: result.toolUseId,
      toolName: result.name,
      input: result.input,
      output: result.output,
      status: result.status,
      durationMs: result.durationMs,
      ...(parsed
        ? { mcpServerId: parsed.serverId, mcpToolName: parsed.toolName }
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
