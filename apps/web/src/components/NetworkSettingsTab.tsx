import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpServerConfig, NetworkConfigFile } from "@kako/shared";
import { api } from "../api";
import { NetworkRuleList } from "./NetworkRuleList";
import { IconChevronDown } from "./RowIcons";
import { SettingsDirtyStatus } from "./SettingsDirtyStatus";

type AdvancedDraft = Pick<NetworkConfigFile, "allowlist" | "blacklist" | "userAllowlist">;

function mergeAllowlistRules(allowlist: string[], userAllowlist: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const rule of [...allowlist, ...userAllowlist]) {
    const key = rule.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(rule);
    }
  }
  return merged;
}

function applyAllowlistEdit(
  merged: string[],
  previous: Pick<NetworkConfigFile, "allowlist" | "userAllowlist">,
): Pick<NetworkConfigFile, "allowlist" | "userAllowlist"> {
  const prevUser = new Map(previous.userAllowlist.map((rule) => [rule.toLowerCase(), rule]));
  const prevAllow = new Map(previous.allowlist.map((rule) => [rule.toLowerCase(), rule]));
  const userAllowlist: string[] = [];
  const allowlist: string[] = [];

  for (const rule of merged) {
    const key = rule.toLowerCase();
    if (prevUser.has(key)) {
      userAllowlist.push(prevUser.get(key)!);
    } else if (prevAllow.has(key)) {
      allowlist.push(prevAllow.get(key)!);
    } else {
      allowlist.push(rule);
    }
  }

  return { allowlist, userAllowlist };
}

function normalizeNetworkConfig(config: NetworkConfigFile): NetworkConfigFile {
  return {
    ...config,
    mcpNetworkDenials: config.mcpNetworkDenials ?? [],
  };
}

function isRemoteMcpServer(server: McpServerConfig): boolean {
  return (
    (server.transport === "http" || server.transport === "sse") &&
    typeof server.url === "string" &&
    server.url.trim().length > 0
  );
}

function countEnabledMcpServers(servers: McpServerConfig[], denials: string[]): number {
  const denied = new Set(denials);
  return servers.filter((server) => isRemoteMcpServer(server) && !denied.has(server.id)).length;
}

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`settings-toggle-row ${disabled ? "settings-toggle-row--disabled" : ""}`}>
      <span className="settings-toggle-row__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`toggle ${checked ? "toggle--on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" />
      </button>
    </label>
  );
}

function transportLabel(server: McpServerConfig): string {
  if (server.transport === "stdio") return "本地进程";
  if (server.url) return server.url;
  return server.transport.toUpperCase();
}

function McpNetworkExceptions({
  servers,
  denials,
  savingId,
  onToggle,
}: {
  servers: McpServerConfig[];
  denials: string[];
  savingId: string | null;
  onToggle: (serverId: string, allowed: boolean) => void;
}) {
  if (servers.length === 0) {
    return <p className="network-mcp-exceptions__empty">暂无已添加的 MCP 服务，请先在 MCP 页面添加。</p>;
  }

  const denied = new Set(denials);

  return (
    <ul className="network-mcp-exceptions">
      {servers.map((server) => {
        const remote = isRemoteMcpServer(server);
        const checked = remote && !denied.has(server.id);
        const busy = savingId === server.id;

        return (
          <li key={server.id} className="network-mcp-row">
            <div className="network-mcp-row__info">
              <span className="network-mcp-row__name">{server.name}</span>
              <span className="network-mcp-row__meta">{transportLabel(server)}</span>
            </div>
            {remote ? (
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={`${server.name} 网络例外`}
                className={`toggle network-mcp-row__toggle ${checked ? "toggle--on" : ""}`}
                disabled={busy}
                onClick={() => onToggle(server.id, !checked)}
              >
                <span className="toggle__knob" />
              </button>
            ) : (
              <span className="network-mcp-row__local">无需网络</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NetworkSettingsSkeleton() {
  return (
    <div className="settings-page" aria-hidden="true">
      <div className="settings-page__intro">
        <div className="skeleton skeleton--line skeleton--title" />
        <div className="skeleton skeleton--line skeleton--lg" />
      </div>
      <div className="settings-card">
        <div className="skeleton skeleton--line skeleton--md" />
      </div>
    </div>
  );
}

export function NetworkSettingsTab() {
  const [config, setConfig] = useState<NetworkConfigFile | null>(null);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedDraft | null>(null);
  const [advancedSaved, setAdvancedSaved] = useState("");
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingAdvanced, setSavingAdvanced] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [togglingMcpId, setTogglingMcpId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, mcp] = await Promise.all([api.getNetwork(), api.getMcp()]);
      const normalized = normalizeNetworkConfig(next);
      setConfig(normalized);
      setMcpServers(mcp.servers);
      const advanced = {
        allowlist: normalized.allowlist,
        blacklist: normalized.blacklist,
        userAllowlist: normalized.userAllowlist ?? [],
      };
      setAdvancedDraft(advanced);
      setAdvancedSaved(JSON.stringify(advanced));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const advancedDirty = useMemo(
    () => (advancedDraft ? JSON.stringify(advancedDraft) !== advancedSaved : false),
    [advancedDraft, advancedSaved],
  );

  useEffect(() => {
    if (!advancedDirty || !showAdvanced) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [advancedDirty, showAdvanced]);

  async function persistNetwork(next: NetworkConfigFile) {
    const saved = normalizeNetworkConfig(await api.saveNetwork(next));
    setConfig(saved);
    return saved;
  }

  async function toggleEnabled(enabled: boolean) {
    if (!config || config.enabled === enabled) return;
    setTogglingEnabled(true);
    setError(null);
    const previous = config;
    const next = normalizeNetworkConfig({ ...config, enabled });
    setConfig(next);
    try {
      await persistNetwork(next);
    } catch (err) {
      setConfig(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingEnabled(false);
    }
  }

  async function toggleMcpException(serverId: string, allowed: boolean) {
    if (!config) return;
    const denials = new Set(config.mcpNetworkDenials);
    if (allowed) denials.delete(serverId);
    else denials.add(serverId);
    const next = normalizeNetworkConfig({
      ...config,
      mcpNetworkDenials: [...denials],
    });

    setTogglingMcpId(serverId);
    setError(null);
    const previous = config;
    setConfig(next);
    try {
      await persistNetwork(next);
    } catch (err) {
      setConfig(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingMcpId(null);
    }
  }

  async function saveAdvanced() {
    if (!config || !advancedDraft) return;
    setSavingAdvanced(true);
    setError(null);
    const next = normalizeNetworkConfig({
      ...config,
      allowlist: advancedDraft.allowlist,
      blacklist: advancedDraft.blacklist,
      userAllowlist: advancedDraft.userAllowlist,
    });
    try {
      const saved = await persistNetwork(next);
      const advanced = {
        allowlist: saved.allowlist,
        blacklist: saved.blacklist,
        userAllowlist: saved.userAllowlist ?? [],
      };
      setAdvancedDraft(advanced);
      setAdvancedSaved(JSON.stringify(advanced));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAdvanced(false);
    }
  }

  function discardAdvanced() {
    const parsed = JSON.parse(advancedSaved) as AdvancedDraft;
    setAdvancedDraft(parsed);
  }

  const displayAllowlist = useMemo(
    () =>
      advancedDraft
        ? mergeAllowlistRules(advancedDraft.allowlist, advancedDraft.userAllowlist)
        : [],
    [advancedDraft],
  );

  if (loading || !config || !advancedDraft) {
    return <NetworkSettingsSkeleton />;
  }

  const enabledMcpCount = countEnabledMcpServers(mcpServers, config.mcpNetworkDenials);

  return (
    <div className="settings-page network-settings">
      <div className="settings-page__intro">
        <p className="settings-page__desc">
          控制 WebFetch、WebSearch 的网络访问。启用时默认允许外网，黑名单拦截；关闭时仅白名单内目标可访问，其余请求在 CLI 中直接拒绝。
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <section className="settings-card">
        <Toggle
          label="启用网络访问"
          checked={config.enabled}
          disabled={togglingEnabled}
          onChange={(enabled) => void toggleEnabled(enabled)}
        />
        <p className="settings-field__help">
          {config.enabled
            ? "已启用：外网默认可访问，黑名单中的域名或 IP 将被拦截。变更立即生效。"
            : "已关闭：仅白名单内的域名或 IP 可访问；远程 MCP 服务默认允许网络连接。变更立即生效。"}
        </p>
      </section>

      {!config.enabled && (
        <section className="settings-card settings-card--advanced">
          <div className="network-rule-list__header">
            <div>
              <h3 className="network-rule-list__title">MCP 网络例外</h3>
              <p className="network-rule-list__hint">
                关闭网络访问时，远程 MCP 服务默认允许连接；可单独关闭某个服务的网络访问。变更立即生效。
              </p>
            </div>
            <span className="network-rule-list__count">{enabledMcpCount} 个已开启</span>
          </div>
          <McpNetworkExceptions
            servers={mcpServers}
            denials={config.mcpNetworkDenials}
            savingId={togglingMcpId}
            onToggle={(serverId, allowed) => void toggleMcpException(serverId, allowed)}
          />
        </section>
      )}

      <button
        type="button"
        className="settings-advanced-toggle"
        onClick={() => setShowAdvanced((open) => !open)}
      >
        <span>高级选项</span>
        <IconChevronDown
          className={`settings-advanced-toggle__icon ${showAdvanced ? "settings-advanced-toggle__icon--open" : ""}`}
        />
      </button>

      {showAdvanced && (
        <section className="settings-card settings-card--advanced">
          {config.enabled && (
            <NetworkRuleList
              id="network-blacklist"
              label="黑名单"
              hint="命中后拒绝访问。支持域名通配符、IP、CIDR、区间与端口。"
              rules={advancedDraft.blacklist}
              tagVariant="blacklist"
              onChange={(blacklist) => setAdvancedDraft({ ...advancedDraft, blacklist })}
            />
          )}
          <NetworkRuleList
            id="network-allowlist"
            label="白名单"
            hint={
              config.enabled
                ? "命中后 WebFetch、curl 等网络请求无需用户审批；关闭网络访问时同时作为访问放行名单。CLI 审批保存的域名也会显示在此。"
                : "仅允许名单内的目标访问；命中后 WebFetch、curl 等网络请求无需用户审批。CLI 审批保存的域名也会显示在此。"
            }
            rules={displayAllowlist}
            tagVariant="allowlist"
            onChange={(merged) => {
              const split = applyAllowlistEdit(merged, {
                allowlist: advancedDraft.allowlist,
                userAllowlist: advancedDraft.userAllowlist,
              });
              setAdvancedDraft({ ...advancedDraft, ...split });
            }}
          />

          <div className={`settings-advanced-footer ${advancedDirty ? "settings-advanced-footer--dirty" : ""}`}>
            <span className="settings-advanced-footer__status">
              {advancedDirty ? (
                <SettingsDirtyStatus message="高级选项有未保存的更改" />
              ) : savingAdvanced ? (
                "保存中…"
              ) : (
                "高级选项已保存"
              )}
            </span>
            <div className="settings-advanced-footer__actions">
              {advancedDirty && (
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={savingAdvanced}
                  onClick={discardAdvanced}
                >
                  放弃更改
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary"
                disabled={!advancedDirty || savingAdvanced}
                onClick={() => void saveAdvanced()}
              >
                {savingAdvanced ? "保存中…" : "保存更改"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
