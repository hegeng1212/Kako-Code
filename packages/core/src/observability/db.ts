import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { ToolLogEntry } from "@kako/shared";
import { getIndexDir, getObservabilityDbPath, getToolLogsDir } from "../config/paths.js";

let dbInstance: Database.Database | null = null;

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      tool_use_id TEXT NOT NULL UNIQUE,
      tool_name TEXT NOT NULL,
      mcp_server_id TEXT,
      mcp_tool_name TEXT,
      input_json TEXT NOT NULL,
      output_json TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_logs_ts ON tool_call_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_logs_mcp_server ON tool_call_logs(mcp_server_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_logs_mcp_tool ON tool_call_logs(mcp_server_id, mcp_tool_name, timestamp DESC);
    CREATE TABLE IF NOT EXISTS observability_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  try {
    sqliteVec.load(db);
    db.prepare(
      "INSERT OR IGNORE INTO observability_meta(key, value) VALUES ('sqlite_vec', 'loaded')",
    ).run();
  } catch {
    db.prepare(
      "INSERT OR IGNORE INTO observability_meta(key, value) VALUES ('sqlite_vec', 'unavailable')",
    ).run();
  }
}

async function migrateJsonlIfNeeded(db: Database.Database): Promise<void> {
  const row = db
    .prepare("SELECT value FROM observability_meta WHERE key = 'jsonl_migrated'")
    .get() as { value: string } | undefined;
  if (row?.value === "done") return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tool_call_logs (
      timestamp, session_id, agent_id, tool_use_id, tool_name,
      mcp_server_id, mcp_tool_name, input_json, output_json, status, duration_ms
    ) VALUES (
      @timestamp, @session_id, @agent_id, @tool_use_id, @tool_name,
      @mcp_server_id, @mcp_tool_name, @input_json, @output_json, @status, @duration_ms
    )
  `);

  const dir = getToolLogsDir();
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    db.prepare(
      "INSERT OR REPLACE INTO observability_meta(key, value) VALUES ('jsonl_migrated', 'done')",
    ).run();
    return;
  }

  const migrate = db.transaction((entries: ToolLogEntry[]) => {
    for (const e of entries) {
      insert.run({
        timestamp: e.timestamp,
        session_id: e.sessionId,
        agent_id: e.agentId,
        tool_use_id: e.toolUseId,
        tool_name: e.toolName,
        mcp_server_id: e.mcpServerId ?? null,
        mcp_tool_name: e.mcpToolName ?? null,
        input_json: JSON.stringify(e.input ?? {}),
        output_json: e.output === undefined ? null : JSON.stringify(e.output),
        status: e.status,
        duration_ms: e.durationMs,
      });
    }
  });

  for (const file of files) {
    const text = await readFile(join(dir, file), "utf-8").catch(() => "");
    const batch: ToolLogEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        batch.push(JSON.parse(line) as ToolLogEntry);
      } catch {
        /* skip */
      }
    }
    if (batch.length) migrate(batch);
  }

  db.prepare(
    "INSERT OR REPLACE INTO observability_meta(key, value) VALUES ('jsonl_migrated', 'done')",
  ).run();
}

export async function getObservabilityDb(): Promise<Database.Database> {
  if (dbInstance) return dbInstance;
  await mkdir(getIndexDir(), { recursive: true });
  const db = new Database(getObservabilityDbPath());
  db.pragma("journal_mode = WAL");
  initSchema(db);
  await migrateJsonlIfNeeded(db);
  dbInstance = db;
  return db;
}

export function closeObservabilityDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
