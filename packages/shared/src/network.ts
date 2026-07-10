/** Parsed host + optional port from a URL or rule. */
export interface NetworkTarget {
  host: string;
  port?: number;
}

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_OCTET = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const PORT_RE = /^\d{1,5}$/;

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function parsePort(value: string): number | undefined {
  if (!PORT_RE.test(value)) return undefined;
  const port = Number(value);
  return isValidPort(port) ? port : undefined;
}

/** Split rule into host pattern and optional port constraint. */
export function splitNetworkRule(rule: string): { hostPart: string; port?: number } | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;

  const bracket = trimmed.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (bracket) {
    const port = bracket[2] ? parsePort(bracket[2]) : undefined;
    if (bracket[2] && port === undefined) return null;
    return { hostPart: bracket[1]!.toLowerCase(), port };
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const idx = trimmed.lastIndexOf(":");
    const hostPart = trimmed.slice(0, idx);
    const port = parsePort(trimmed.slice(idx + 1));
    if (port === undefined) return null;
    return { hostPart: hostPart.toLowerCase(), port };
  }

  if (colonCount > 1) {
    return { hostPart: trimmed.toLowerCase() };
  }

  return { hostPart: trimmed.toLowerCase() };
}

export function normalizeNetworkRule(rule: string): string {
  const parsed = splitNetworkRule(rule);
  if (!parsed) return rule.trim();
  if (parsed.port !== undefined) {
    if (parsed.hostPart.includes(":")) {
      return `[${parsed.hostPart}]:${parsed.port}`;
    }
    return `${parsed.hostPart}:${parsed.port}`;
  }
  return parsed.hostPart;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => p !== "*" && IPV4_OCTET.test(p));
}

function isIpv4Wildcard(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[3] !== "*") return false;
  return parts.slice(0, 3).every((p) => IPV4_OCTET.test(p));
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || !isIpv4(ip)) return null;
  return parts.reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function parseIpv4Cidr(hostPart: string): { base: number; mask: number } | null {
  const [ip, bitsText] = hostPart.split("/");
  if (!ip || bitsText === undefined) return null;
  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32 || !isIpv4(ip)) return null;
  const base = ipv4ToInt(ip);
  if (base === null) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { base: base & mask, mask };
}

function parseIpv4Range(hostPart: string): { start: number; end: number } | null {
  const [startIp, endIp] = hostPart.split("-");
  if (!startIp || !endIp) return null;
  const start = ipv4ToInt(startIp);
  const end = ipv4ToInt(endIp);
  if (start === null || end === null || start > end) return null;
  return { start, end };
}

function expandIpv6(ip: string): bigint | null {
  try {
    const parts = ip.split("::");
    if (parts.length > 2) return null;
    const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
    const tail = parts[1] ? parts[1].split(":").filter(Boolean) : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    const full = [...head, ...Array(missing).fill("0"), ...tail];
    if (full.length !== 8) return null;
    let value = 0n;
    for (const group of full) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      value = (value << 16n) + BigInt(`0x${group}`);
    }
    return value;
  } catch {
    return null;
  }
}

function parseIpv6Cidr(hostPart: string): { base: bigint; mask: bigint } | null {
  const [ip, bitsText] = hostPart.split("/");
  if (!ip || bitsText === undefined) return null;
  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return null;
  const base = expandIpv6(ip);
  if (base === null) return null;
  const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - bits);
  return { base: base & mask, mask };
}

function isDomainRule(hostPart: string): boolean {
  if (hostPart.includes("-")) {
    const start = hostPart.split("-")[0]!;
    if (isIpv4(start)) return false;
  }
  if (hostPart.startsWith("*.") || hostPart.includes("/")) {
    return hostPart.startsWith("*.") || (!isIpv4(hostPart) && !hostPart.includes(":"));
  }
  if (isIpv4(hostPart) || isIpv4Wildcard(hostPart) || hostPart.includes(":")) return false;
  const labels = hostPart.split(".");
  return labels.length >= 2 && labels.every((l) => l === "*" || DOMAIN_LABEL.test(l));
}

export function validateNetworkRule(rule: string): string | null {
  const trimmed = rule.trim();
  if (!trimmed) return "规则不能为空";

  const parsed = splitNetworkRule(trimmed);
  if (!parsed) return "规则格式无效";

  const { hostPart } = parsed;

  if (hostPart.includes("/")) {
    if (hostPart.includes(":")) {
      if (!parseIpv6Cidr(hostPart)) return "IPv6 CIDR 格式无效";
      return null;
    }
    if (!parseIpv4Cidr(hostPart)) return "IPv4 CIDR 格式无效";
    return null;
  }

  if (hostPart.includes("-") && (isIpv4(hostPart.split("-")[0]!) || hostPart.includes(":"))) {
    if (hostPart.includes(":")) return "暂不支持 IPv6 区间写法";
    if (!parseIpv4Range(hostPart)) return "IP 区间格式无效";
    return null;
  }

  if (isIpv4Wildcard(hostPart) || isIpv4(hostPart)) return null;

  if (hostPart.startsWith("*.")) {
    const base = hostPart.slice(2);
    if (!isDomainRule(`x.${base}`)) return "域名通配符格式无效";
    return null;
  }

  if (hostPart.includes(":")) {
    if (expandIpv6(hostPart) === null) return "IPv6 地址格式无效";
    return null;
  }

  if (!isDomainRule(hostPart)) return "域名或 IP 格式无效";
  return null;
}

const COMPOUND_APEX_SUFFIXES = ["com.cn", "net.cn", "org.cn", "gov.cn", "co.uk", "com.hk"];

function isCompoundApexDomain(host: string): boolean {
  return COMPOUND_APEX_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`) || host.endsWith(suffix),
  );
}

function portMatches(rulePort: number | undefined, targetPort?: number): boolean {
  if (rulePort === undefined) return true;
  if (targetPort === undefined) return false;
  return rulePort === targetPort;
}

function matchDomainRule(ruleHost: string, targetHost: string): boolean {
  if (ruleHost.startsWith("*.")) {
    const base = ruleHost.slice(2);
    return targetHost !== base && targetHost.endsWith(`.${base}`);
  }

  const ruleLabels = ruleHost.split(".");
  if (ruleLabels.length >= 3 && !isCompoundApexDomain(ruleHost)) {
    return targetHost === ruleHost;
  }

  return targetHost === ruleHost || targetHost.endsWith(`.${ruleHost}`);
}

function matchIpv4Rule(ruleHost: string, targetHost: string): boolean {
  if (isIpv4Wildcard(ruleHost)) {
    const prefix = ruleHost.slice(0, ruleHost.length - 1);
    return targetHost.startsWith(prefix);
  }

  const cidr = parseIpv4Cidr(ruleHost);
  if (cidr) {
    const ip = ipv4ToInt(targetHost);
    if (ip === null) return false;
    return (ip & cidr.mask) === cidr.base;
  }

  const range = parseIpv4Range(ruleHost);
  if (range) {
    const ip = ipv4ToInt(targetHost);
    if (ip === null) return false;
    return ip >= range.start && ip <= range.end;
  }

  return targetHost === ruleHost;
}

function matchIpv6Rule(ruleHost: string, targetHost: string): boolean {
  const cidr = parseIpv6Cidr(ruleHost);
  if (cidr) {
    const ip = expandIpv6(targetHost);
    if (ip === null) return false;
    return (ip & cidr.mask) === cidr.base;
  }
  const target = expandIpv6(targetHost);
  const rule = expandIpv6(ruleHost);
  return target !== null && rule !== null && target === rule;
}

export function matchesNetworkRule(rule: string, targetHost: string, targetPort?: number): boolean {
  const parsed = splitNetworkRule(rule);
  if (!parsed) return false;
  if (!portMatches(parsed.port, targetPort)) return false;

  const host = targetHost.toLowerCase();
  const { hostPart } = parsed;

  if (
    hostPart.includes("/") ||
    isIpv4Wildcard(hostPart) ||
    isIpv4(hostPart) ||
    (hostPart.includes("-") && isIpv4(hostPart.split("-")[0]!))
  ) {
    return matchIpv4Rule(hostPart, host);
  }

  if (hostPart.includes(":")) {
    return matchIpv6Rule(hostPart, host);
  }

  if (hostPart.startsWith("*.") || isDomainRule(hostPart)) {
    return matchDomainRule(hostPart, host);
  }

  return matchIpv4Rule(hostPart, host);
}

export function parseNetworkTargetFromUrl(url: string): NetworkTarget | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    let port: number | undefined;
    if (parsed.port) {
      port = Number(parsed.port);
    } else if (parsed.protocol === "https:") {
      port = 443;
    } else if (parsed.protocol === "http:") {
      port = 80;
    }
    return { host, port: port && isValidPort(port) ? port : undefined };
  } catch {
    return null;
  }
}

export function anyNetworkRuleMatches(
  rules: string[],
  targetHost: string,
  targetPort?: number,
): boolean {
  return rules.some((rule) => matchesNetworkRule(rule, targetHost, targetPort));
}

/** Fuzzy filter for settings UI search. */
export function networkRuleMatchesQuery(rule: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return rule.toLowerCase().includes(q);
}
