import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { summaryPath } from "./compact.js";
import { clearSessionConversation, createMessage, FileMemoryStore } from "./store.js";
import { writeFile, mkdir } from "node:fs/promises";
import { getSessionMemoryDir } from "../config/paths.js";

describe("clearSessionConversation", () => {
  it("wipes transcript and L1 summary", async () => {
    const sessionId = `clear-conv-${Date.now()}`;
    const store = new FileMemoryStore(sessionId);
    await store.append(createMessage("user", "before"));
    await store.append(createMessage("assistant", "reply"));
    await mkdir(getSessionMemoryDir(sessionId), { recursive: true });
    await writeFile(summaryPath(sessionId), "## Goal\nold\n", "utf-8");

    await clearSessionConversation(sessionId);

    expect(await store.loadTranscript()).toEqual([]);
    await expect(readFile(summaryPath(sessionId), "utf-8")).rejects.toThrow();
  });
});
