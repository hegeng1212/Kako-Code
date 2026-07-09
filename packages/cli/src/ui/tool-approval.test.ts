import { describe, expect, it } from "vitest";
import {
  buildToolApprovalContent,
  toolApprovalDecisionFromRow,
  toolApprovalPanelRowCount,
  toolConfirmResultFromDecision,
} from "./tool-approval.js";

describe("tool-approval", () => {
  it("builds create-file preview with path and content", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "Write",
        input: { file_path: "/tmp/add.py", content: "print('hi')\n" },
      },
      "/tmp",
      80,
    );
    expect(content.title).toBe("Create file");
    expect(content.subtitle).toContain("add.py");
    expect(content.previewLines.join("\n")).toContain("print");
    expect(content.rows[0]?.label).toBe("Yes");
    expect(content.rows[1]?.label).toContain("allow all edits");
  });

  it("builds bash command preview", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "Bash",
        input: { command: "python add.py" },
      },
      "/tmp",
      80,
    );
    expect(content.title).toBe("Run command");
    expect(content.subtitle).toBe("python add.py");
    expect(content.rows[1]?.label).toContain("this command");
  });

  it("maps session allow decision to ToolConfirmResult", () => {
    expect(
      toolConfirmResultFromDecision(
        { id: "1", name: "Write", input: {} },
        toolApprovalDecisionFromRow({ kind: "option", label: "session", optionIndex: 1 }),
      ),
    ).toEqual({ allowed: true, sessionAllow: "writes" });
  });

  it("builds bash delete preview", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "Bash",
        input: { command: "rm /tmp/old.txt" },
      },
      "/tmp",
      80,
    );
    expect(content.title).toBe("Delete file");
    expect(content.subtitle).toBe("rm /tmp/old.txt");
    expect(content.question).toContain("delete");
  });

  it("sizes footer from wrapped session-allow labels", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "Write",
        input: { file_path: "/tmp/report.md", content: "# Title\n" },
      },
      "/tmp",
      40,
    );
    const narrow = toolApprovalPanelRowCount(40, content);
    const wide = toolApprovalPanelRowCount(120, content);
    expect(narrow).toBeGreaterThanOrEqual(wide);
    expect(narrow).toBeGreaterThan(6);
  });
});
