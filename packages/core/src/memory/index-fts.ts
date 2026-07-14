import Database from "better-sqlite3";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  MemoryInjectCaps,
  MemoryLayer,
  MemorySearchOptions,
  SearchHit,
  SessionId,
} from "@kako/shared";
import { DEFAULT_MEMORY_INJECT_CAPS } from "@kako/shared";
import {
  getIndexDir,
  getMemoryDir,
  getSessionMemoryDir,
} from "../config/paths.js";
import { listFacts } from "./facts.js";

export function getMemoryFtsDbPath(): string {
  return join(getIndexDir(), "memory-fts.db");
}

let dbInstance: Database.Database | null = null;

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED,
      layer UNINDEXED,
      path UNINDEXED,
      session_id UNINDEXED,
      updated_at UNINDEXED,
      body
    );
  `);
}

export function getMemoryFtsDb(): Database.Database {
  if (dbInstance) return dbInstance;
  mkdirSync(getIndexDir(), { recursive: true });
  dbInstance = new Database(getMemoryFtsDbPath());
  initSchema(dbInstance);
  return dbInstance;
}

export function closeMemoryFtsDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function upsertMemoryDoc(doc: {
  id: string;
  layer: MemoryLayer;
  path: string;
  sessionId?: SessionId;
  body: string;
  updatedAt?: string;
}): void {
  const db = getMemoryFtsDb();
  db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(doc.id);
  db.prepare(
    `INSERT INTO memory_fts(id, layer, path, session_id, updated_at, body)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    doc.id,
    doc.layer,
    doc.path,
    doc.sessionId ?? null,
    doc.updatedAt ?? new Date().toISOString(),
    doc.body,
  );
}

/** Convert free text to a safe FTS5 OR query of tokens. */
export function toFtsQuery(query: string): string {
  const tokens = query
    .split(/[^\p{L}\p{N}_.-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  if (!tokens.length) return `"${query.replace(/"/g, "").slice(0, 40)}"`;
  return tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
}

export function snippetAround(body: string, query: string, maxChars: number): string {
  const lower = body.toLowerCase();
  const q = query.toLowerCase().split(/\s+/).find((t) => t.length >= 2) ?? query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return body.slice(0, maxChars);
  const start = Math.max(0, idx - Math.floor(maxChars / 4));
  return body.slice(start, start + maxChars);
}

function lineRangeForSnippet(
  body: string,
  snippet: string,
): { start: number; end: number } | undefined {
  const needle = snippet.slice(0, Math.min(40, snippet.length));
  const idx = body.indexOf(needle);
  if (idx < 0) return undefined;
  const startLine = body.slice(0, idx).split("\n").length;
  const endLine = startLine + Math.max(0, snippet.split("\n").length - 1);
  return { start: startLine, end: endLine };
}

export function searchMemoryFts(
  options: MemorySearchOptions,
  caps: MemoryInjectCaps = DEFAULT_MEMORY_INJECT_CAPS,
): SearchHit[] {
  const limit = Math.min(options.limit ?? caps.searchDefaultLimit, caps.searchDefaultLimit);
  const query = options.query.trim();
  if (!query) return [];

  const db = getMemoryFtsDb();
  const layers = options.layers;
  const ftsQuery = toFtsQuery(query);

  let sql = `
    SELECT layer, path, session_id, body, updated_at, bm25(memory_fts) as score
    FROM memory_fts
    WHERE memory_fts MATCH ?
  `;
  const params: unknown[] = [ftsQuery];

  if (layers?.length) {
    sql += ` AND layer IN (${layers.map(() => "?").join(",")})`;
    params.push(...layers);
  }
  if (options.sessionId && !options.crossSession) {
    sql += ` AND (session_id = ? OR session_id IS NULL)`;
    params.push(options.sessionId);
  }
  sql += ` LIMIT ?`;
  params.push(Math.max(limit * 4, limit));

  try {
    const rows = db.prepare(sql).all(...params) as Array<{
      layer: MemoryLayer;
      path: string;
      session_id: string | null;
      body: string;
      updated_at: string | null;
      score: number;
    }>;
    const ranked = rows
      .map((row) => {
        const bm25 = typeof row.score === "number" ? -row.score : 0;
        const combined = bm25 + recencyBoost(row.updated_at);
        const snippet = snippetAround(row.body, query, caps.searchHitSnippetChars);
        const lineRange = lineRangeForSnippet(row.body, snippet);
        return {
          layer: row.layer,
          path: row.path,
          score: combined,
          snippet,
          lineRange,
          ...(row.session_id ? { sessionId: row.session_id as SessionId } : {}),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return ranked;
  } catch {
    return [];
  }
}

/** Day-decay boost: newer docs rank higher when relevance is similar. */
export function recencyBoost(updatedAt: string | null | undefined, now = Date.now()): number {
  if (!updatedAt) return 0;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 0;
  const ageDays = Math.max(0, (now - ts) / 86_400_000);
  return 1 / (1 + ageDays);
}

export async function rebuildMemoryFtsIndex(): Promise<{ docs: number }> {
  closeMemoryFtsDb();
  const path = getMemoryFtsDbPath();
  if (existsSync(path)) unlinkSync(path);

  getMemoryFtsDb();
  let docs = 0;

  const sessionsRoot = join(getMemoryDir(), "sessions");
  let sessionIds: string[] = [];
  try {
    sessionIds = await readdir(sessionsRoot);
  } catch {
    sessionIds = [];
  }
  for (const sessionId of sessionIds) {
    const dir = getSessionMemoryDir(sessionId);
    const transcriptPath = join(dir, "transcript.jsonl");
    try {
      const text = await readFile(transcriptPath, "utf-8");
      const bodies: string[] = [];
      for (const line of text.split("\n").filter(Boolean)) {
        try {
          const msg = JSON.parse(line) as { role?: string; content?: string };
          if (msg.role === "user" || msg.role === "assistant") {
            bodies.push(String(msg.content ?? ""));
          }
        } catch {
          /* skip */
        }
      }
      if (bodies.length) {
        upsertMemoryDoc({
          id: `L0:${sessionId}`,
          layer: "L0",
          path: transcriptPath,
          sessionId: sessionId as SessionId,
          body: bodies.join("\n"),
        });
        docs++;
      }
    } catch {
      /* no transcript */
    }
    const summaryFile = join(dir, "summary.md");
    try {
      const summary = await readFile(summaryFile, "utf-8");
      upsertMemoryDoc({
        id: `L1:${sessionId}`,
        layer: "L1",
        path: summaryFile,
        sessionId: sessionId as SessionId,
        body: summary,
      });
      docs++;
    } catch {
      /* no summary */
    }
  }

  const rollingDir = join(getMemoryDir(), "summaries", "rolling");
  try {
    const files = await readdir(rollingDir);
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      const p = join(rollingDir, f);
      const body = await readFile(p, "utf-8");
      upsertMemoryDoc({ id: `L2:${f}`, layer: "L2", path: p, body });
      docs++;
    }
  } catch {
    /* none */
  }

  for (const fact of await listFacts()) {
    const p = join(getMemoryDir(), "facts", `${fact.id}.md`);
    upsertMemoryDoc({
      id: `L3:${fact.id}`,
      layer: "L3",
      path: p,
      body: fact.content,
      updatedAt: fact.updatedAt,
    });
    docs++;
  }

  try {
    const p = join(getMemoryDir(), "profile", "user.md");
    const body = await readFile(p, "utf-8");
    upsertMemoryDoc({ id: "L4:user", layer: "L4", path: p, body });
    docs++;
  } catch {
    /* none */
  }

  try {
    const epDir = join(getMemoryDir(), "episodes");
    const files = await readdir(epDir);
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      const p = join(epDir, f);
      const body = await readFile(p, "utf-8");
      upsertMemoryDoc({ id: `L5:${f}`, layer: "L5", path: p, body });
      docs++;
    }
  } catch {
    /* none */
  }

  return { docs };
}

export async function syncSessionToFts(sessionId: SessionId): Promise<void> {
  const dir = getSessionMemoryDir(sessionId);
  try {
    const text = await readFile(join(dir, "transcript.jsonl"), "utf-8");
    const bodies: string[] = [];
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const msg = JSON.parse(line) as { role?: string; content?: string };
        if (msg.role === "user" || msg.role === "assistant") {
          bodies.push(String(msg.content ?? ""));
        }
      } catch {
        /* skip */
      }
    }
    upsertMemoryDoc({
      id: `L0:${sessionId}`,
      layer: "L0",
      path: join(dir, "transcript.jsonl"),
      sessionId,
      body: bodies.join("\n"),
    });
  } catch {
    /* no transcript */
  }
  try {
    const summary = await readFile(join(dir, "summary.md"), "utf-8");
    upsertMemoryDoc({
      id: `L1:${sessionId}`,
      layer: "L1",
      path: join(dir, "summary.md"),
      sessionId,
      body: summary,
    });
  } catch {
    /* no summary */
  }
}

export async function memoryGet(options: {
  path: string;
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}): Promise<string> {
  const maxChars = options.maxChars ?? 12_000;
  await mkdir(getMemoryDir(), { recursive: true });
  const text = await readFile(options.path, "utf-8");
  const lines = text.split("\n");
  const start = Math.max(1, options.startLine ?? 1);
  const end = Math.min(lines.length, options.endLine ?? lines.length);
  const slice = lines.slice(start - 1, end).join("\n");
  if (slice.length <= maxChars) return slice;
  return `${slice.slice(0, maxChars)}\n… truncated; narrow line range or raise maxChars.`;
}
