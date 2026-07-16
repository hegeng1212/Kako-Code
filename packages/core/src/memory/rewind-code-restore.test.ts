import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@kako/shared";
import {
  restoreCodeChangesFromTranscript,
  summarizeCodeChanges,
} from "./rewind-code-restore.js";

function msg(
  partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "role" | "content">,
): TranscriptMessage {
  return {
    id: partial.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: partial.timestamp ?? "2026-07-14T00:00:00.000Z",
    ...partial,
  };
}

describe("summarizeCodeChanges", () => {
  it("returns null when the turn has no mutating tools", () => {
    const transcript = [
      msg({ id: "u1", role: "user", content: "你好", metadata: { cliInput: true } }),
      msg({ id: "a1", role: "assistant", content: "hi" }),
    ];
    expect(summarizeCodeChanges(transcript, 0)).toBeNull();
  });

  it("counts Write/Edit files in the turn", () => {
    const transcript = [
      msg({ id: "u1", role: "user", content: "改代码", metadata: { cliInput: true } }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t1",
            name: "Edit",
            input: {
              file_path: "/tmp/a.go",
              old_string: "one\ntwo",
              new_string: "one\ntwo\nthree",
            },
          },
          {
            id: "t2",
            name: "Write",
            input: { file_path: "/tmp/b.go", content: "line1\nline2" },
          },
        ],
      }),
      msg({
        id: "r1",
        role: "tool",
        toolCallId: "t1",
        toolName: "Edit",
        content: "Replaced 1 occurrence in /tmp/a.go",
      }),
      msg({
        id: "r2",
        role: "tool",
        toolCallId: "t2",
        toolName: "Write",
        content: "File created successfully at: /tmp/b.go",
      }),
    ];
    const summary = summarizeCodeChanges(transcript, 0);
    expect(summary).toEqual({
      count: 2,
      additions: 5,
      deletions: 2,
      primaryFile: "a.go",
    });
  });
});

describe("restoreCodeChangesFromTranscript", () => {
  it("reverses Edit and deletes created Write files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kako-rewind-code-"));
    const editPath = join(dir, "edit.txt");
    const createPath = join(dir, "created.txt");
    await writeFile(editPath, "hello world", "utf-8");
    await writeFile(createPath, "new", "utf-8");

    const transcript = [
      msg({ id: "u1", role: "user", content: "edit", metadata: { cliInput: true } }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "t1",
            name: "Edit",
            input: {
              file_path: editPath,
              old_string: "hello",
              new_string: "hello world",
            },
          },
          {
            id: "t2",
            name: "Write",
            input: { file_path: createPath, content: "new" },
          },
        ],
      }),
      msg({
        id: "r1",
        role: "tool",
        toolCallId: "t1",
        toolName: "Edit",
        content: `Replaced 1 occurrence in ${editPath}`,
      }),
      msg({
        id: "r2",
        role: "tool",
        toolCallId: "t2",
        toolName: "Write",
        content: `File created successfully at: ${createPath}`,
      }),
    ];

    // Post-edit workspace state: reverse Edit hello → hello world back to "hello".
    await writeFile(editPath, "hello world", "utf-8");

    const result = await restoreCodeChangesFromTranscript(transcript, 0);
    expect(result.errors).toEqual([]);
    expect(result.restored).toContain(editPath);
    expect(result.restored).toContain(createPath);
    expect(await readFile(editPath, "utf-8")).toBe("hello");
    await expect(readFile(createPath, "utf-8")).rejects.toThrow();
  });
});
