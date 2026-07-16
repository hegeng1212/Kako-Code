import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSessionMetaPath } from "../config/paths.js";
import { parseSessionMetaJson, readSessionMeta } from "./session-meta-io.js";
import { SessionManager } from "./manager.js";

const CORRUPT_TRAILING = `{
  "id": "sess-heal-trail",
  "projectId": "proj-test",
  "cwd": "/tmp",
  "agentName": "main",
  "title": "中文问候会话",
  "status": "active",
  "createdAt": "2026-07-16T08:22:50.188Z",
  "updatedAt": "2026-07-16T08:50:45.471Z",
  "agentState": {
    "state": "done",
    "detail": "turn finished",
    "tempo": "idle",
    "since": "2026-07-16T08:50:45.470Z"
  },
  "jobName": "simple-greeting",
  "jobLabel": "aigc llm agent mapping"
}
,
  "jobName": "simple-greeting",
  "jobLabel": "aigc llm agent mapping"
}
`;

const CORRUPT_MIDDLE = `{
  "id": "sess-heal-middle",
  "projectId": "proj-test",
  "cwd": "/tmp",
  "agentName": "main",
  "title": "撰写bebebus奶瓶geo文",
  "status": "active",
  "createdAt": "2026-07-14T15:04:33.961Z",
  "updatedAt": "2026-07-15T14:41:31.065Z",
  "agentState": {
    "state": "done",
    "detail": "turn finished",
    "tempo": "idle",
    "since": "2026-07-15T14:41:31.065Z"
  },
  "jobLabel": "bebebus geo investor report",
  "jobName": "map-llm-agent-invocations"
}
  },
  "jobLabel": "bebebus geo investor report",
  "jobName": "map-llm-agent-invocations"
}
`;

describe("parseSessionMetaJson", () => {
  it("parses valid meta unchanged", () => {
    const parsed = parseSessionMetaJson('{"id":"sess-a","cwd":"/tmp","agentName":"main"}');
    expect(parsed?.id).toBe("sess-a");
  });

  it("heals trailing duplicate append corruption", () => {
    const parsed = parseSessionMetaJson(CORRUPT_TRAILING);
    expect(parsed?.id).toBe("sess-heal-trail");
    expect(parsed?.jobName).toBe("simple-greeting");
    expect(parsed?.jobLabel).toBe("aigc llm agent mapping");
  });

  it("heals mid-file duplicate append corruption", () => {
    const parsed = parseSessionMetaJson(CORRUPT_MIDDLE);
    expect(parsed?.id).toBe("sess-heal-middle");
    expect(parsed?.jobName).toBe("map-llm-agent-invocations");
  });
});

describe("readSessionMeta", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-meta-heal-"));
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    delete process.env.KAKO_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("rewrites healed meta to a clean file on disk", async () => {
    const mgr = new SessionManager();
    const session = await mgr.createSession({ cwd: home });
    const path = getSessionMetaPath(session.id);
    const corrupt = CORRUPT_TRAILING.replaceAll("sess-heal-trail", session.id);
    await writeFile(path, corrupt, "utf-8");

    const meta = await readSessionMeta(session.id);
    expect(meta?.id).toBe(session.id);
    const onDisk = await readFile(path, "utf-8");
    expect(() => JSON.parse(onDisk)).not.toThrow();
    expect(parseSessionMetaJson(onDisk)?.id).toBe(session.id);
    expect(onDisk).toBe(`${JSON.stringify(meta, null, 2)}\n`);
  });
});

describe("withSessionMetaLock", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-meta-lock-"));
    process.env.KAKO_HOME = home;
  });

  afterEach(async () => {
    delete process.env.KAKO_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("serializes concurrent updateSession writes without corrupting meta.json", async () => {
    const mgr = new SessionManager();
    const session = await mgr.createSession({ cwd: home });

    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        mgr.updateSession(session.id, {
          agentState: {
            state: "working",
            detail: `turn ${i}`,
            tempo: "active",
            since: new Date().toISOString(),
          },
          jobName: i % 2 === 0 ? "job-a" : undefined,
          jobLabel: i % 2 === 1 ? `label-${i}` : undefined,
        }),
      ),
    );

    const onDisk = await readFile(getSessionMetaPath(session.id), "utf-8");
    expect(() => JSON.parse(onDisk)).not.toThrow();
    const listed = await mgr.listSessionMetas({ limit: 10 });
    expect(listed.some((m) => m.id === session.id)).toBe(true);
  });
});
