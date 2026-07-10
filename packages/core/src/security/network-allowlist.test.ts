import { describe, expect, it } from "vitest";
import { matchesNetworkAllowlist } from "./network-guard.js";
import { resolveApprovalDecision } from "./approval-resolver.js";
import type { RiskAssessment } from "./risk-evaluator.js";
import { normalizeSecurityPolicy } from "./policy-store.js";

const webFetchAssessment: RiskAssessment = {
  level: "medium",
  reasons: ["network"],
  requiresNetwork: true,
  networkTargets: ["https://api.example.com/page"],
  workspacePaths: [],
};

const enabledPolicy = {
  version: 1,
  enabled: true,
  allowlist: ["example.com"],
  blacklist: [],
  userAllowlist: [],
  mcpNetworkDenials: [],
};

function securityPolicy() {
  return normalizeSecurityPolicy(
    {
      version: 1,
      approval: {
        byRisk: {
          none: "never",
          low: "never",
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

describe("network allowlist approval", () => {
  it("matches configured allowlist hosts", () => {
    expect(matchesNetworkAllowlist("https://api.example.com/x", enabledPolicy)).toBe(true);
    expect(matchesNetworkAllowlist("https://other.com/x", enabledPolicy)).toBe(false);
  });

  it("skips user approval when network target is allowlisted", () => {
    const decision = resolveApprovalDecision(securityPolicy(), webFetchAssessment, "default", {
      allowlistedNetwork: true,
    });
    expect(decision.action).toBe("allow");
    expect(decision.mode).toBe("never");
  });

  it("still requires approval for non-allowlisted network tools", () => {
    const decision = resolveApprovalDecision(securityPolicy(), webFetchAssessment, "default", {
      allowlistedNetwork: false,
    });
    expect(decision.action).toBe("confirm");
  });
});
