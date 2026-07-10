import { describe, expect, it, vi } from "vitest";

vi.mock("@kako/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kako/core")>();
  return {
    ...actual,
    listAllCachedTools: vi.fn(async () => [
      {
        serverId: "babytree",
        serverName: "宝宝树",
        name: "bbt_pregnancy.find_baby",
        description: "查询当前用户的宝宝档案信息",
        inputSchema: { type: "object", properties: {} },
      },
    ]),
  };
});

import { stripAnsi } from "./ansi.js";
import {
  buildToolApprovalContent,
  formatMcpToolDescription,
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
    expect(content.rows[1]?.label).toContain("allow paths under add.py");
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

  it("adds allowlist option for WebFetch with host", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "WebFetch",
        input: { url: "https://api.example.com/data", prompt: "x" },
      },
      "/tmp",
      80,
    );
    expect(content.rows).toHaveLength(4);
    expect(content.rows[2]?.label).toContain("api.example.com");
    expect(content.rows[3]?.label).toBe("No");
    expect(
      toolConfirmResultFromDecision(
        {
          id: "1",
          name: "WebFetch",
          input: { url: "https://api.example.com/data", prompt: "x" },
        },
        toolApprovalDecisionFromRow(
          { kind: "option", label: "allowlist", optionIndex: 2 },
          content.networkHosts,
        ),
      ),
    ).toEqual({ allowed: true, networkAllowlistHosts: ["api.example.com"] });
  });

  it("adds allowlist option for bash curl with URL", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "Bash",
        input: { command: "curl -s https://cdn.example.com/pkg.tar.gz" },
      },
      "/tmp",
      80,
    );
    expect(content.rows).toHaveLength(4);
    expect(content.rows[2]?.label).toContain("cdn.example.com");
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

  it("builds mcp tool preview from cached description instead of empty args", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "mcp/babytree/bbt_pregnancy.find_baby",
        input: {},
      },
      "/tmp",
      80,
    );
    expect(content.title).toBe("MCP tool");
    expect(content.previewLines.join("\n")).toContain("宝宝档案");
    expect(content.previewLines.join("\n")).not.toContain("{}");
    expect(content.rows[1]?.label).toContain("MCP tool");
  });

  it("strips MCP server prefix from cached descriptions", () => {
    expect(formatMcpToolDescription("[MCP:宝宝树] 查询宝宝档案")).toBe("查询宝宝档案");
  });

  it("sizes footer from wrapped session-allow labels", async () => {
    const longName = "中国母婴行业近3年市场规模与趋势分析报告-面向投资者.md";
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "Write",
        input: { file_path: `/tmp/${longName}`, content: "# Title\n" },
      },
      "/tmp",
      40,
    );
    const narrow = toolApprovalPanelRowCount(40, content);
    const wide = toolApprovalPanelRowCount(120, content);
    expect(narrow).toBeGreaterThan(wide);
    expect(narrow).toBeGreaterThan(7);
    expect(content.rows[1]?.label).toContain(longName);
  });

  it("renders markdown create preview without diff styling", async () => {
    const content = await buildToolApprovalContent(
      {
        id: "1",
        name: "Write",
        input: { file_path: "/tmp/report.md", content: "# Title\n\nBody\n" },
      },
      "/tmp",
      80,
    );
    const preview = content.previewLines.join("\n");
    expect(preview).toContain("# Title");
    expect(preview).not.toContain("\x1b[48;5;22m");
    expect(stripAnsi(preview)).not.toMatch(/\+# Title/);
  });
});
