import type {
  SkillHubAnalyzeRepoResult,
  SkillHubImportResult,
  SkillHubSearchHit,
} from "@kako/shared";
import { fetchWithTimeout } from "../net/fetch-with-timeout.js";

const DEFAULT_BASE = "https://agentskillhub.dev";
const SKILLHUB_FETCH_TIMEOUT_MS = 8_000;

export function getSkillHubBaseUrl(): string {
  return process.env.SKILLSHUB_API_URL ?? process.env.SKHUB_API_URL ?? DEFAULT_BASE;
}

function apiUrl(path: string): string {
  return `${getSkillHubBaseUrl()}${path}`;
}

export function parseSkillHubSlug(slug: string): { username: string; skillSlug: string } {
  const trimmed = slug.trim().replace(/^@/, "");
  const slash = trimmed.indexOf("/");
  if (slash <= 0) {
    throw new Error(`Invalid SkillHub slug: ${slug}. Expected username/skill-name`);
  }
  return {
    username: trimmed.slice(0, slash),
    skillSlug: trimmed.slice(slash + 1),
  };
}

/** Build install slug username/skill from search hit or short slug + hints. */
export function resolveSkillHubInstallSlug(
  slug: string,
  hints?: { ownerUsername?: string; sourceIdentifier?: string },
): string {
  const trimmed = slug.trim().replace(/^@/, "");
  if (trimmed.includes("/")) return trimmed;

  if (hints?.ownerUsername) {
    return `${hints.ownerUsername}/${trimmed}`;
  }

  if (hints?.sourceIdentifier) {
    const owner = hints.sourceIdentifier.split("/")[0];
    if (owner) return `${owner}/${trimmed}`;
  }

  throw new Error(
    `Invalid SkillHub slug: ${slug}. Expected username/skill-name (e.g. anthropics/${trimmed})`,
  );
}

function enrichSearchHit(hit: SkillHubSearchHit): SkillHubSearchHit {
  try {
    const installSlug = resolveSkillHubInstallSlug(hit.slug, {
      ownerUsername: hit.ownerUsername,
      sourceIdentifier: hit.sourceIdentifier,
    });
    return { ...hit, installSlug };
  } catch {
    return hit;
  }
}

export interface SkillHubSkillVersion {
  id: string;
  version: string;
  commitSha: string;
  skillMdRaw: string;
  fileManifest?: Array<{ path: string; size?: number }>;
}

export interface SkillHubSkillResponse {
  skill: {
    slug: string;
    name: string;
    description: string;
    skillPath: string;
    ownerUsername: string;
    displaySlug?: string;
  };
  latestVersion: SkillHubSkillVersion;
}

async function skillHubFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init, SKILLHUB_FETCH_TIMEOUT_MS);
}

export async function searchSkillHub(query: string, limit = 10): Promise<SkillHubSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = apiUrl(`/api/v1/search?q=${encodeURIComponent(q)}&limit=${Math.min(limit, 10)}`);
  const res = await skillHubFetch(url);
  if (!res.ok) {
    throw new Error(`SkillHub search failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { skills?: SkillHubSearchHit[] };
  return (body.skills ?? []).map(enrichSearchHit);
}

const POPULAR_SEARCH_SEEDS = ["ai", "sk", "co", "pr"];

/** Aggregate search results and return top skills by install count. */
export async function fetchPopularSkillHub(limit = 10): Promise<SkillHubSearchHit[]> {
  const capped = Math.min(Math.max(limit, 1), 20);
  const batches = await Promise.all(
    POPULAR_SEARCH_SEEDS.map((seed) => searchSkillHub(seed, 10).catch(() => null)),
  );
  const hits = batches.flatMap((batch) => batch ?? []);
  if (hits.length === 0) {
    throw new Error("无法连接 SkillHub，请检查网络后重试");
  }
  const byKey = new Map<string, SkillHubSearchHit>();
  for (const hit of hits) {
    const key = hit.installSlug ?? hit.slug;
    const prev = byKey.get(key);
    if (!prev || (hit.totalInstalls ?? 0) > (prev.totalInstalls ?? 0)) {
      byKey.set(key, hit);
    }
  }
  return [...byKey.values()]
    .sort(
      (a, b) =>
        (b.totalInstalls ?? 0) - (a.totalInstalls ?? 0) || a.name.localeCompare(b.name),
    )
    .slice(0, capped);
}

export async function fetchSkillHubSkill(slug: string): Promise<SkillHubSkillResponse> {
  const { username, skillSlug } = parseSkillHubSlug(slug);
  const url = apiUrl(`/api/v1/u/${encodeURIComponent(username)}/skills/${encodeURIComponent(skillSlug)}`);
  const res = await skillHubFetch(url);
  if (!res.ok) {
    throw new Error(`SkillHub skill not found: ${slug} (${res.status})`);
  }
  return (await res.json()) as SkillHubSkillResponse;
}

export async function analyzeSkillHubRepo(url: string): Promise<SkillHubAnalyzeRepoResult> {
  const res = await skillHubFetch(apiUrl("/api/v1/repos/analyze"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(`SkillHub repo analyze failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as SkillHubAnalyzeRepoResult;
}

export async function importSkillHubRepo(
  repoFullName: string,
  selectedPaths: string[],
): Promise<SkillHubImportResult> {
  const res = await skillHubFetch(apiUrl("/api/v1/repos/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoFullName, selectedPaths }),
  });
  if (!res.ok) {
    throw new Error(`SkillHub repo import failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as SkillHubImportResult;
}

export async function recordSkillHubInstall(versionId: string): Promise<void> {
  await skillHubFetch(apiUrl("/api/v1/installs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      versionId,
      channel: "kako",
      agentTarget: "kako",
      cliVersion: "0.2.0",
    }),
  }).catch(() => {
    // telemetry is best-effort
  });
}
