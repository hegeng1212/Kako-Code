import { describe, expect, it } from "vitest";
import { createMessage, sessionInputHistory } from "./store.js";

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
