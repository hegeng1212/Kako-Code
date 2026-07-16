import { useCallback, useEffect, useMemo, useState } from "react";
import type { OutsideWorkspacePolicy, SecurityConfigFile, SessionCapability } from "@kako/shared";
import { api } from "../api";
import { IconChevronDown } from "./RowIcons";
import { SettingsDirtyStatus } from "./SettingsDirtyStatus";
import {
  SettingsSegmentField,
  type SettingsSegmentOption,
} from "./SettingsSegmentField";

type AdvancedDraft = {
  extraTrustedRoots: string[];
};

const WORKSPACE_MODES: SettingsSegmentOption<SessionCapability>[] = [
  {
    value: "FullAccess",
    label: "完全访问",
    tone: "elevated",
    hint: "读写删除无需审批；低危 Bash 自动放行，高危 Bash 仍须审批；网络由「网络安全」控制",
  },
  { value: "ReadOnly", label: "只读", tone: "info", hint: "仅允许读取工作区内的文件" },
  { value: "WorkspaceWrite", label: "读写", tone: "review", hint: "允许读写、删除工作区内的文件；不含 Bash 执行" },
];

const WORKSPACE_HINTS: Record<SessionCapability, string> = {
  ReadOnly: "仅允许读取工作区内的文件",
  WorkspaceWrite: "允许读写、删除工作区内的文件；不含 Bash 执行",
  FullAccess: "读写删除无需审批；低危 Bash 自动放行，高危 Bash 仍须审批；网络由「网络安全」控制",
};

const OUTSIDE_POLICIES: SettingsSegmentOption<OutsideWorkspacePolicy>[] = [
  { value: "approve", label: "需审批", tone: "review", hint: "访问工作区外路径前弹出审批" },
  { value: "deny", label: "拒绝", tone: "deny", hint: "禁止访问工作区外路径" },
  { value: "allow", label: "允许", tone: "allow", hint: "允许访问工作区外路径" },
];

const OUTSIDE_HINTS: Record<OutsideWorkspacePolicy, string> = {
  approve: "访问工作区外路径前弹出审批",
  deny: "禁止访问工作区外路径",
  allow: "允许访问工作区外路径",
};

function InheritedPathList({ paths }: { paths: string[] }) {
  return (
    <section className="network-rule-list">
      <div className="network-rule-list__header">
        <div>
          <h3 className="network-rule-list__title">继承的信任根</h3>
          <p className="network-rule-list__hint">
            随当前工作区自动包含的路径，不可编辑。读写权限由上方「工作区」选项控制。
          </p>
        </div>
        <span className="network-rule-list__count">{paths.length} 条</span>
      </div>
      {paths.length > 0 ? (
        <ul className="network-rule-list__tags">
          {paths.map((path) => (
            <li key={path} className="network-rule-tag network-rule-tag--inherited">
              <code className="network-rule-tag__text">{path}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="network-rule-list__empty">暂无继承路径。</p>
      )}
    </section>
  );
}

function ExtraPathRuleList({
  paths,
  onChange,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const visible = paths.filter((path) =>
    query.trim() ? path.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );

  function addPath() {
    const next = draft.trim();
    if (!next || paths.includes(next)) return;
    onChange([...paths, next]);
    setDraft("");
  }

  return (
    <section className="network-rule-list">
      <div className="network-rule-list__header">
        <div>
          <h3 className="network-rule-list__title">额外信任根</h3>
          <p className="network-rule-list__hint">在继承路径之外，手动添加可信任的绝对路径。</p>
        </div>
        <span className="network-rule-list__count">{paths.length} 条</span>
      </div>
      <div className="network-rule-list__add">
        <input
          className="network-rule-list__input"
          type="text"
          value={draft}
          placeholder="/Users/me/projects"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPath();
            }
          }}
        />
        <button type="button" className="btn btn--secondary btn--sm" onClick={addPath}>
          添加
        </button>
      </div>
      {paths.length > 3 && (
        <label className="network-rule-list__search">
          <span className="network-rule-list__search-label">搜索</span>
          <input
            className="network-rule-list__input"
            type="search"
            value={query}
            placeholder="模糊匹配路径"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {visible.length > 0 ? (
        <ul className="network-rule-list__tags">
          {visible.map((path) => (
            <li key={path} className="network-rule-tag">
              <code className="network-rule-tag__text">{path}</code>
              <button
                type="button"
                className="network-rule-tag__remove"
                aria-label={`删除 ${path}`}
                onClick={() => onChange(paths.filter((item) => item !== path))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="network-rule-list__empty">暂无额外信任根目录。</p>
      )}
    </section>
  );
}

function SecuritySettingsSkeleton() {
  return (
    <div className="settings-page security-settings" aria-hidden="true">
      <div className="settings-page__intro">
        <div className="skeleton skeleton--line skeleton--title" />
        <div className="skeleton skeleton--line skeleton--lg" />
      </div>
      <div className="settings-card">
        <div className="skeleton skeleton--line skeleton--md" />
        <div className="skeleton skeleton--line skeleton--md" />
      </div>
    </div>
  );
}

export function SecuritySettingsTab() {
  const settingsCwd = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const fromQuery = new URLSearchParams(window.location.search).get("cwd")?.trim();
    return fromQuery || undefined;
  }, []);

  const [config, setConfig] = useState<SecurityConfigFile | null>(null);
  const [inheritedRoots, setInheritedRoots] = useState<string[]>([]);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedDraft | null>(null);
  const [advancedSaved, setAdvancedSaved] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingAdvanced, setSavingAdvanced] = useState(false);
  const [savingMain, setSavingMain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getSecurity(settingsCwd);
      setConfig(next);
      setInheritedRoots(next.workspace.inheritedTrustedRoots ?? []);
      const advanced = { extraTrustedRoots: next.workspace.extraTrustedRoots ?? [] };
      setAdvancedDraft(advanced);
      setAdvancedSaved(JSON.stringify(advanced));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [settingsCwd]);

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

  function buildPayload(patch: Partial<SecurityConfigFile["workspace"]> & {
    capabilities?: SecurityConfigFile["capabilities"];
  }): SecurityConfigFile {
    if (!config || !advancedDraft) {
      throw new Error("Security settings not loaded");
    }
    return {
      version: config.version,
      capabilities: patch.capabilities ?? config.capabilities,
      workspace: {
        outsidePolicy: patch.outsidePolicy ?? config.workspace.outsidePolicy,
        extraTrustedRoots: patch.extraTrustedRoots ?? advancedDraft.extraTrustedRoots,
      },
    };
  }

  async function persistSecurity(next: SecurityConfigFile) {
    const saved = await api.saveSecurity(next, settingsCwd);
    setConfig(saved);
    setInheritedRoots(saved.workspace.inheritedTrustedRoots ?? []);
    return saved;
  }

  async function updateMain(
    patch: Partial<SecurityConfigFile["workspace"]> & {
      capabilities?: SecurityConfigFile["capabilities"];
    },
  ): Promise<void> {
    if (!config) return;
    setSavingMain(true);
    setError(null);
    const previous = config;
    const payload = buildPayload(patch);
    setConfig(payload);
    try {
      await persistSecurity(payload);
    } catch (err) {
      setConfig(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMain(false);
    }
  }

  async function saveAdvanced() {
    if (!config || !advancedDraft) return;
    setSavingAdvanced(true);
    setError(null);
    const payload = buildPayload({ extraTrustedRoots: advancedDraft.extraTrustedRoots });
    try {
      const saved = await persistSecurity(payload);
      const advanced = { extraTrustedRoots: saved.workspace.extraTrustedRoots ?? [] };
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

  if (loading || !config || !advancedDraft) {
    return <SecuritySettingsSkeleton />;
  }

  const workspaceCapability = config.capabilities.default;

  return (
    <div className="settings-page security-settings">
      <div className="settings-page__intro">
        <p className="settings-page__desc">
          工作区读写权限、越权路径策略与信任根目录。按工作目录分别保存；基础选项变更后立即生效。
        </p>
        {settingsCwd ? (
          <p className="settings-page__meta">
            当前工作区：<code>{settingsCwd}</code>
          </p>
        ) : null}
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <section className="settings-card">
        <div className="security-settings-field">
          <SettingsSegmentField
            id="security-workspace"
            label="工作区"
            value={workspaceCapability}
            options={WORKSPACE_MODES}
            disabled={savingMain}
            onChange={(value) =>
              void updateMain({
                capabilities: { default: value },
              })
            }
          />
          <p className="settings-field__help">{WORKSPACE_HINTS[workspaceCapability]}</p>
        </div>

        <div className="security-settings-field security-settings-field--spaced">
          <SettingsSegmentField
            id="security-outside"
            label="工作区外路径"
            value={config.workspace.outsidePolicy}
            options={OUTSIDE_POLICIES}
            disabled={savingMain}
            onChange={(value) =>
              void updateMain({
                outsidePolicy: value,
              })
            }
          />
          <p className="settings-field__help">{OUTSIDE_HINTS[config.workspace.outsidePolicy]}</p>
        </div>
      </section>

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
          <InheritedPathList paths={inheritedRoots} />
          <ExtraPathRuleList
            paths={advancedDraft.extraTrustedRoots}
            onChange={(extraTrustedRoots) => setAdvancedDraft({ extraTrustedRoots })}
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
