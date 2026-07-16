import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session, SlashCommandContext } from "@kako/shared";
import { handleSlashCommand } from "./slash.js";

function makeSession(id: string, cwd: string): Session {
  const now = new Date().toISOString();
  return {
    id,
    agentName: "main",
    status: "active",
    createdAt: now,
    updatedAt: now,
    cwd,
  };
}

describe("handleSlashCommand", () => {
  let cwd: string;
  let session: Session;
  let ctx: SlashCommandContext;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "kako-slash-"));
    session = makeSession("sess-abc12345", cwd);
    ctx = {
      cwd,
      session,
      listSessions: async () => [session],
      createSession: async () => makeSession("sess-new12345", cwd),
      endSession: async () => {},
      resumeSession: async (id) => ({ ...session, id, status: "active" }),
      updateTitle: async (id, title) => ({
        ...session,
        id,
        metadata: { title },
      }),
    };
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns exit for /quit", async () => {
    const result = await handleSlashCommand("/quit", ctx);
    expect(result.type).toBe("exit");
  });

  it("returns clear for /clear without creating a session", async () => {
    const result = await handleSlashCommand("/clear", ctx);
    expect(result).toEqual({ type: "clear", displayText: "/clear" });
  });

  it("does not treat /new as a builtin session switch", async () => {
    const result = await handleSlashCommand("/new", ctx);
    expect(result.type).toBe("error");
  });

  it("passes through non-slash input as message", async () => {
    const result = await handleSlashCommand("hello", ctx);
    expect(result).toEqual({ type: "message", text: "hello" });
  });

  it("passes through absolute file paths as message, not slash commands", async () => {
    const path = "/Users/hegeng/Pictures/photo.jpeg";
    const result = await handleSlashCommand(`${path} 这是什么`, ctx);
    expect(result).toEqual({ type: "message", text: `${path} 这是什么` });
  });

  it("still treats /help as a slash command", async () => {
    const result = await handleSlashCommand("/help", ctx);
    expect(result.type).toBe("handled");
  });

  it("expands yaml slash command", async () => {
    await mkdir(join(cwd, ".kako", "config"), { recursive: true });
    await writeFile(
      join(cwd, ".kako", "config", "skills.yaml"),
      "slashCommands:\n  commit: Generate a commit message\n",
      "utf-8",
    );
    const result = await handleSlashCommand("/commit", ctx);
    expect(result).toEqual({ type: "message", text: "Generate a commit message" });
  });

  it("returns workflows-panel for /workflows", async () => {
    const result = await handleSlashCommand("/workflows", ctx);
    expect(result).toEqual({ type: "workflows-panel" });
  });

  it("returns skill-slash for deep-research", async () => {
    const result = await handleSlashCommand("/deep-research test topic", ctx);
    expect(result.type).toBe("skill-slash");
    if (result.type === "skill-slash") {
      expect(result.name).toBe("deep-research");
      expect(result.handler).toBe("dynamic-workflow");
      expect(result.args).toBe("test topic");
    }
  });

  it("returns plan-view for bare /plan", async () => {
    const result = await handleSlashCommand("/plan", ctx);
    expect(result).toEqual({
      type: "plan-view",
      displayText: "/plan",
    });
  });

  it("returns plan-enter with question for /plan foo", async () => {
    const result = await handleSlashCommand("/plan design API", ctx);
    expect(result).toEqual({
      type: "plan-enter",
      question: "design API",
      displayText: "/plan design API",
    });
  });

  it("returns plan-open for /plan open", async () => {
    const result = await handleSlashCommand("/plan open", ctx);
    expect(result).toEqual({
      type: "plan-open",
      displayText: "/plan open",
    });
  });

  it("returns auto-enter for /auto with optional question", async () => {
    expect(await handleSlashCommand("/auto", ctx)).toEqual({
      type: "auto-enter",
      question: undefined,
      displayText: "/auto",
    });
    expect(await handleSlashCommand("/auto ship it", ctx)).toEqual({
      type: "auto-enter",
      question: "ship it",
      displayText: "/auto ship it",
    });
  });

  it("returns manual-enter for /manual", async () => {
    expect(await handleSlashCommand("/manual", ctx)).toEqual({
      type: "manual-enter",
      displayText: "/manual",
    });
  });

  it("returns message for /init so the model can invoke Skill(init)", async () => {
    const result = await handleSlashCommand("/init", ctx);
    expect(result).toEqual({ type: "message", text: "init" });
  });

  it("passes args through /init", async () => {
    const result = await handleSlashCommand("/init focus on tests", ctx);
    expect(result).toEqual({ type: "message", text: "init focus on tests" });
  });
});
