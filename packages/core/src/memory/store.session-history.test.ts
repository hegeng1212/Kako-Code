import { describe, expect, it } from "vitest";
import {
  createMessage,
  FileMemoryStore,
  getTranscriptLength,
  sessionInputHistory,
  truncateSessionTranscript,
} from "./store.js";

describe("sessionInputHistory", () => {
  it("collects only cliInput user prompts without consecutive duplicates", () => {
    const transcript = [
      createMessage("user", "hello", { metadata: { cliInput: true } }),
      createMessage("assistant", "hi"),
      createMessage("user", "hello", { metadata: { cliInput: true } }),
      createMessage("user", "Dynamic workflow completed · 12m 34s"),
      createMessage("user", "next", { metadata: { cliInput: true } }),
    ];
    expect(sessionInputHistory(transcript)).toEqual(["hello", "next"]);
  });

  it("excludes harness-injected user rows", () => {
    const transcript = [
      createMessage("user", "/path/report.md 转成ppt", { metadata: { cliInput: true } }),
      createMessage("user", "文件内容：报告摘要…"),
    ];
    expect(sessionInputHistory(transcript)).toEqual(["/path/report.md 转成ppt"]);
  });
});

describe("truncateSessionTranscript", () => {
  it("removes messages appended after a turn starts", async () => {
    const sessionId = `truncate-${Date.now()}`;
    const store = new FileMemoryStore(sessionId);
    await store.append(createMessage("user", "before"));
    expect(await getTranscriptLength(sessionId)).toBe(1);
    await store.append(createMessage("user", "cancelled"));
    await store.append(createMessage("assistant", "partial"));
    await truncateSessionTranscript(sessionId, 1);
    const transcript = await store.loadTranscript();
    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.content).toBe("before");
  });
});
