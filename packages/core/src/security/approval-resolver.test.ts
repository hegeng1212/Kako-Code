import { describe, expect, it } from "vitest";
import { resolveApprovalDecision } from "./approval-resolver.js";
import type { RiskAssessment } from "./risk-evaluator.js";
import { normalizeSecurityPolicy } from "./policy-store.js";

const lowReadAssessment: RiskAssessment = {
  level: "low",
  reasons: [],
  requiresNetwork: false,
  networkTargets: [],
  workspacePaths: ["/tmp/project/hello.py"],
};

function policy() {
  return normalizeSecurityPolicy(
    {
      version: 1,
      approval: {
        byRisk: {
          none: "never",
          low: "onRequest",
          medium: "onRequest",
          high: "always",
          critical: "deny",
        },
        unknownRiskPolicy: "onRequest",
      },
    },
    "/tmp/project",
  );
}

describe("resolveApprovalDecision", () => {
  it("allows readonly in-workspace without confirmation", () => {
    const decision = resolveApprovalDecision(policy(), lowReadAssessment, "default", {
      readonlyInWorkspace: true,
    });
    expect(decision.action).toBe("allow");
    expect(decision.mode).toBe("never");
  });

  it("still confirms readonly reads outside workspace", () => {
    const decision = resolveApprovalDecision(policy(), lowReadAssessment, "default", {
      readonlyInWorkspace: true,
      workspaceNeedsApproval: true,
    });
    expect(decision.action).toBe("confirm");
  });

  it("skips confirmation for allowlisted network targets", () => {
    const decision = resolveApprovalDecision(
      policy(),
      {
        level: "medium",
        reasons: [],
        requiresNetwork: true,
        networkTargets: ["https://trusted.example"],
        workspacePaths: [],
      },
      "default",
      { allowlistedNetwork: true },
    );
    expect(decision.action).toBe("allow");
  });

  it("allows write in trusted workspace without confirmation", () => {
    const decision = resolveApprovalDecision(
      policy(),
      {
        level: "medium",
        reasons: [],
        requiresNetwork: false,
        networkTargets: [],
        workspacePaths: ["/tmp/project/out.md"],
      },
      "default",
      { skipWriteConfirm: true },
    );
    expect(decision.action).toBe("allow");
    expect(decision.mode).toBe("never");
  });

  it("allows FullAccess write outside trusted workspace without confirmation", () => {
    const decision = resolveApprovalDecision(
      policy(),
      {
        level: "medium",
        reasons: [],
        requiresNetwork: false,
        networkTargets: [],
        workspacePaths: ["/tmp/outside/out.md"],
      },
      "default",
      { skipWriteConfirm: true, workspaceNeedsApproval: true },
    );
    expect(decision.action).toBe("allow");
    expect(decision.mode).toBe("never");
  });

  it("still confirms write outside trusted workspace for WorkspaceWrite", () => {
    const decision = resolveApprovalDecision(
      policy(),
      {
        level: "medium",
        reasons: [],
        requiresNetwork: false,
        networkTargets: [],
        workspacePaths: ["/tmp/outside/out.md"],
      },
      "default",
      { workspaceNeedsApproval: true },
    );
    expect(decision.action).toBe("confirm");
  });
});
