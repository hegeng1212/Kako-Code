import { resolve } from "node:path";
import type { SecurityPolicy } from "./policy-store.js";
import { isPathInDeniedRoots } from "./workspace-guard.js";

export function redactSecretsInText(text: string, policy: SecurityPolicy): string {
  let out = text;
  for (const key of policy.secrets.redactEnvKeys ?? []) {
    const pattern = new RegExp(`${escapeRegex(key)}[=:]\\s*[^\\s"'&]+`, "gi");
    out = out.replace(pattern, `${key}=[REDACTED]`);
  }
  for (const pat of policy.secrets.redactPatterns ?? []) {
    try {
      const re = new RegExp(`(${pat})\\s*[:=]\\s*["']?[^\\s"'&]+`, "gi");
      out = out.replace(re, "$1=[REDACTED]");
    } catch {
      // skip invalid pattern
    }
  }
  return out;
}

export function redactSecretsInValue(value: unknown, policy: SecurityPolicy): unknown {
  if (typeof value === "string") return redactSecretsInText(value, policy);
  if (Array.isArray(value)) return value.map((v) => redactSecretsInValue(v, policy));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k, policy)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSecretsInValue(v, policy);
      }
    }
    return out;
  }
  return value;
}

function isSensitiveKey(key: string, policy: SecurityPolicy): boolean {
  const lower = key.toLowerCase();
  if ((policy.secrets.redactEnvKeys ?? []).some((k) => k.toLowerCase() === lower)) {
    return true;
  }
  return (policy.secrets.redactPatterns ?? []).some((pat) => {
    try {
      return new RegExp(pat, "i").test(key);
    } catch {
      return false;
    }
  });
}

export function isDeniedSecretPath(rawPath: string, policy: SecurityPolicy): boolean {
  const denied = policy.workspace.deniedRoots ?? [];
  return isPathInDeniedRoots(resolve(rawPath), denied);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
