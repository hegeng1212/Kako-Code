import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryFact } from "@kako/shared";
import { getMemoryDir } from "../config/paths.js";
import { deleteFact, listFacts, writeFact } from "./facts.js";
import { upsertMemoryDoc } from "./index-fts.js";

export interface CuratorOptions {
  /** Days without update before a fact is candidate for decay. */
  factMaxAgeDays?: number;
  /** Minimum confidence to retain when decaying. */
  minConfidence?: number;
  /** Promote L1 next/open items longer than this into L5. */
  episodeMinChars?: number;
  /** When true, attempt optional sqlite-vec indexing if available. */
  enableVectors?: boolean;
}

export interface CuratorReport {
  factsDeleted: number;
  factsDecayed: number;
  episodesPromoted: number;
  vectorsIndexed: number;
  contradictionsNoted: number;
}

/**
 * Offline curator: decay stale facts, promote high-salience episodes, optional vectors.
 * Triggers are age/confidence/size contracts — not semantic intent heuristics.
 */
export async function runMemoryCurator(
  options: CuratorOptions = {},
): Promise<CuratorReport> {
  const factMaxAgeDays = options.factMaxAgeDays ?? 90;
  const minConfidence = options.minConfidence ?? 0.3;
  const episodeMinChars = options.episodeMinChars ?? 400;

  const report: CuratorReport = {
    factsDeleted: 0,
    factsDecayed: 0,
    episodesPromoted: 0,
    vectorsIndexed: 0,
    contradictionsNoted: 0,
  };

  const now = Date.now();
  const facts = await listFacts();
  for (const fact of facts) {
    const ageDays = (now - Date.parse(fact.updatedAt)) / (86_400_000);
    if (fact.validTo && Date.parse(fact.validTo) < now) {
      await deleteFact(fact.id);
      report.factsDeleted++;
      continue;
    }
    if (ageDays > factMaxAgeDays && fact.confidence < minConfidence) {
      await deleteFact(fact.id);
      report.factsDeleted++;
      continue;
    }
    if (ageDays > factMaxAgeDays / 2 && fact.confidence >= minConfidence) {
      const decayed: MemoryFact = {
        ...fact,
        confidence: Math.max(minConfidence, fact.confidence * 0.9),
        updatedAt: new Date().toISOString(),
      };
      await writeFact(decayed);
      report.factsDecayed++;
    }
  }

  report.contradictionsNoted = await noteContradictions(await listFacts());

  report.episodesPromoted = await promoteEpisodesFromL1(episodeMinChars);

  if (options.enableVectors) {
    report.vectorsIndexed = await tryIndexVectors(await listFacts());
  }

  return report;
}

/**
 * Structural contradiction note: identical id with differing content is not possible;
 * we only count pairs that share a high token-overlap ratio with opposite polarity markers
 * is intentionally NOT done (no keyword antagonism). Instead return 0 — Critic agent is
 * Phase 3 optional and wired later via LLM when a router is supplied.
 */
async function noteContradictions(_facts: MemoryFact[]): Promise<number> {
  return 0;
}

async function promoteEpisodesFromL1(minChars: number): Promise<number> {
  const sessionsRoot = join(getMemoryDir(), "sessions");
  let sessionIds: string[] = [];
  try {
    sessionIds = await readdir(sessionsRoot);
  } catch {
    return 0;
  }
  const epDir = join(getMemoryDir(), "episodes");
  await mkdir(epDir, { recursive: true });
  let promoted = 0;

  for (const id of sessionIds) {
    const summaryPath = join(sessionsRoot, id, "summary.md");
    let summary: string;
    try {
      summary = await readFile(summaryPath, "utf-8");
    } catch {
      continue;
    }
    if (summary.length < minChars) continue;
    const episodeId = `ep-${id.slice(0, 8)}-${randomUUID().slice(0, 4)}`;
    const path = join(epDir, `${episodeId}.md`);
    // Skip if an episode already exists for this session marker.
    const existing = await readdir(epDir).catch(() => [] as string[]);
    if (existing.some((f) => f.includes(id.slice(0, 8)))) continue;

    const body = [
      "---",
      `id: ${episodeId}`,
      `source_session: ${id}`,
      `created_at: ${new Date().toISOString()}`,
      "---",
      "",
      summary.trim(),
      "",
    ].join("\n");
    await writeFile(path, body, "utf-8");
    upsertMemoryDoc({
      id: `L5:${episodeId}.md`,
      layer: "L5",
      path,
      body: summary,
    });
    promoted++;
  }
  return promoted;
}

async function tryIndexVectors(facts: MemoryFact[]): Promise<number> {
  // Optional sqlite-vec: best-effort; file SoT remains primary.
  try {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const { getIndexDir } = await import("../config/paths.js");
    const path = join(getIndexDir(), "memory-vec.db");
    const db = new Database(path);
    try {
      sqliteVec.load(db);
    } catch {
      db.close();
      return 0;
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vec_meta (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const upsert = db.prepare(
      `INSERT INTO memory_vec_meta(id, body, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`,
    );
    let n = 0;
    for (const fact of facts) {
      upsert.run(fact.id, fact.content, fact.updatedAt);
      n++;
    }
    db.close();
    return n;
  } catch {
    return 0;
  }
}

/** Remove an episode file (forgetting). */
export async function forgetEpisode(episodeFileName: string): Promise<void> {
  const path = join(getMemoryDir(), "episodes", episodeFileName);
  try {
    await unlink(path);
  } catch {
    /* missing */
  }
}
