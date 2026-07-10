import { describe, expect, it } from "vitest";
import { bashToolDefinition } from "../tools/builtin/bash.js";
import { writeToolDefinition } from "../tools/builtin/write.js";
import { classifyBashCommand } from "./bash-policy.js";
import { normalizeSecurityPolicy } from "./policy-store.js";
import { evaluateToolRisk } from "./risk-evaluator.js";

function policyFor(cwd: string) {
  return normalizeSecurityPolicy(
    {
      version: 1,
      workspace: { outsidePolicy: "approve" },
      capabilities: { default: "WorkspaceWrite" },
      approval: { byRisk: {}, unknownRiskPolicy: "onRequest" },
      bash: { safeTier: "never", riskyTier: "onRequest", dangerousTier: "deny" },
      delete: { protectBulk: true },
      secrets: { redactPatterns: [], redactEnvKeys: [] },
      resources: {
        bashTimeoutMs: 120_000,
        bashMaxTimeoutMs: 600_000,
        bashMaxOutputBytes: 10_485_760,
      },
      bypass: {
        secretsEnforced: true,
        networkEnforced: true,
        workspaceDenyEnforced: true,
      },
    },
    cwd,
  );
}

describe("risk-evaluator", () => {
  it("classifies safe bash as low risk", () => {
    expect(classifyBashCommand("git status")).toBe("safe");
    const assessment = evaluateToolRisk(
      { id: "1", name: "Bash", input: { command: "git status" } },
      bashToolDefinition,
      "/tmp",
      policyFor("/tmp"),
    );
    expect(assessment.bashTier).toBe("safe");
    expect(assessment.level).toBe("medium");
  });

  it("classifies dangerous bash as critical", () => {
    const assessment = evaluateToolRisk(
      { id: "1", name: "Bash", input: { command: "rm -rf /tmp/foo" } },
      bashToolDefinition,
      "/tmp",
      policyFor("/tmp"),
    );
    expect(assessment.bashTier).toBe("dangerous");
    expect(assessment.level).toBe("critical");
  });

  it("extracts workspace paths from write tools", () => {
    const assessment = evaluateToolRisk(
      {
        id: "1",
        name: "Write",
        input: { file_path: "/tmp/a.txt", content: "x" },
      },
      writeToolDefinition,
      "/tmp",
      policyFor("/tmp"),
    );
    expect(assessment.workspacePaths).toContain("/tmp/a.txt");
    expect(assessment.level).toBe("medium");
  });

  it("flags WebFetch as requiring network", () => {
    const assessment = evaluateToolRisk(
      { id: "1", name: "WebFetch", input: { url: "https://example.com" } },
      {
        name: "WebFetch",
        description: "fetch",
        inputSchema: { type: "object" },
        security: { requiresNetwork: true, capability: ["network"] },
      },
      "/tmp",
      policyFor("/tmp"),
    );
    expect(assessment.requiresNetwork).toBe(true);
    expect(assessment.networkTargets[0]).toBe("https://example.com");
  });

  it("extracts bash curl URLs into network targets", () => {
    const assessment = evaluateToolRisk(
      { id: "1", name: "Bash", input: { command: "curl -s https://api.example.com" } },
      bashToolDefinition,
      "/tmp",
      policyFor("/tmp"),
    );
    expect(assessment.requiresNetwork).toBe(true);
    expect(assessment.networkTargets).toEqual(["https://api.example.com"]);
  });
});
