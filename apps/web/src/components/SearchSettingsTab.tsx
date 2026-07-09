import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SearchProviderFieldDef,
  SearchProviderPreset,
  SearchProviderProfile,
  SearchTestResult,
} from "@kako/shared";
import { api } from "../api";
import { SearchProviderIcon } from "./SearchProviderIcon";
import { PanelToolbar } from "./PanelToolbar";
import {
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconSpinner,
  IconTestTube,
} from "./RowIcons";

function isProviderReady(
  profile: SearchProviderProfile,
  preset: SearchProviderPreset,
): boolean {
  if (!profile.enabled) return false;
  if (profile.id === "bing" || profile.id === "duckduckgo") return true;
  return !preset.requiresApiKey || Boolean(profile.apiKey?.trim());
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`toggle ${checked ? "toggle--on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
      >
        <span className="toggle__knob" />
      </button>
    </label>
  );
}

interface SearchProviderRowProps {
  preset: SearchProviderPreset;
  profile: SearchProviderProfile;
  index: number;
  expanded: boolean;
  testing: boolean;
  dragging: boolean;
  dropBefore: boolean;
  hovered: boolean;
  visiblePasswords: Set<string>;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onChange: (patch: Partial<SearchProviderProfile>) => void;
  onTest: () => void;
  onTogglePassword: (fieldKey: string) => void;
  onHover: (hovered: boolean) => void;
  onDragHandleDown: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}

function renderField(
  field: SearchProviderFieldDef,
  profile: SearchProviderProfile,
  visiblePasswords: Set<string>,
  onChange: (patch: Partial<SearchProviderProfile>) => void,
  onTogglePassword: (fieldKey: string) => void,
) {
  const value = profile[field.key];
  const fieldId = `${profile.id}-${field.key}`;

  if (field.type === "select") {
    return (
      <label key={field.key} className="field" htmlFor={fieldId}>
        <span className="field__label">{field.label}</span>
        <select
          id={fieldId}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (field.key === "authLevel") {
              onChange({ authLevel: Number(raw) as 0 | 1 });
            } else if (field.key === "searchType") {
              onChange({ searchType: raw as "web" | "image" });
            } else {
              onChange({ [field.key]: raw } as Partial<SearchProviderProfile>);
            }
          }}
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.hint && <span className="field__help">{field.hint}</span>}
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label key={field.key} className="field" htmlFor={fieldId}>
        <span className="field__label">{field.label}</span>
        <input
          id={fieldId}
          type="number"
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? value : ""}
          onChange={(e) =>
            onChange({
              [field.key]: e.target.value ? Number(e.target.value) : undefined,
            } as Partial<SearchProviderProfile>)
          }
        />
        {field.hint && <span className="field__help">{field.hint}</span>}
      </label>
    );
  }

  if (field.type === "password") {
    const visible = visiblePasswords.has(field.key);
    return (
      <div key={field.key} className="field">
        <label className="field__label" htmlFor={fieldId}>
          {field.label}
        </label>
        <div className="field__password">
          <input
            id={fieldId}
            type={visible ? "text" : "password"}
            placeholder={field.placeholder}
            value={typeof value === "string" ? value : ""}
            onChange={(e) =>
              onChange({ [field.key]: e.target.value } as Partial<SearchProviderProfile>)
            }
            autoComplete="off"
          />
          <button
            type="button"
            className="field__eye"
            title={visible ? "隐藏" : "显示"}
            onClick={() => onTogglePassword(field.key)}
          >
            {visible ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>
        {field.hint && <span className="field__help">{field.hint}</span>}
      </div>
    );
  }

  return (
    <label key={field.key} className="field" htmlFor={fieldId}>
      <span className="field__label">{field.label}</span>
      <input
        id={fieldId}
        type="text"
        placeholder={field.placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(e) =>
          onChange({ [field.key]: e.target.value } as Partial<SearchProviderProfile>)
        }
      />
      {field.hint && <span className="field__help">{field.hint}</span>}
    </label>
  );
}

function SearchProviderRow({
  preset,
  profile,
  index,
  expanded,
  testing,
  dragging,
  dropBefore,
  hovered,
  visiblePasswords,
  onToggleExpand,
  onToggleEnabled,
  onChange,
  onTest,
  onTogglePassword,
  onHover,
  onDragHandleDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: SearchProviderRowProps) {
  const ready = isProviderReady(profile, preset);
  const showActions = hovered || expanded || testing;

  return (
    <li
      className={[
        "search-provider-row",
        !profile.enabled && "search-provider-row--disabled",
        expanded && "search-provider-row--expanded",
        dragging && "search-provider-row--dragging",
        dropBefore && "search-provider-row--drop-before",
        ready && profile.enabled && "search-provider-row--ready",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div
        className="search-provider-row__drag provider-row__drag"
        title="拖动排序"
        aria-label="拖动排序"
        onMouseDown={onDragHandleDown}
      >
        <span /><span /><span /><span /><span /><span />
      </div>

      <SearchProviderIcon id={profile.id} />

      <button
        type="button"
        className="search-provider-row__main"
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <div className="search-provider-row__title">
          <span className="search-provider-row__priority">{index + 1}</span>
          <span className="search-provider-row__name">{preset.name}</span>
          {profile.enabled ? (
            ready ? (
              <span className="tag tag--active">就绪</span>
            ) : (
              <span className="tag tag--warn">待配置</span>
            )
          ) : (
            <span className="tag tag--muted">已关闭</span>
          )}
        </div>
        <p className="search-provider-row__desc">{preset.description}</p>
      </button>

      <div className={`search-provider-row__actions ${showActions ? "visible" : ""}`}>
        <Toggle
          label="启用"
          checked={profile.enabled}
          onChange={onToggleEnabled}
        />
        <button
          type="button"
          className="icon-btn"
          title={testing ? "测试中…" : "测试连接"}
          disabled={!ready || testing}
          aria-busy={testing}
          onClick={(e) => {
            e.stopPropagation();
            onTest();
          }}
        >
          {testing ? (
            <IconSpinner className="icon-btn__spinner" />
          ) : (
            <IconTestTube />
          )}
        </button>
        <button
          type="button"
          className={`search-provider-row__chevron ${expanded ? "search-provider-row__chevron--open" : ""}`}
          title={expanded ? "收起" : "展开配置"}
          aria-label={expanded ? "收起配置" : "展开配置"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          <IconChevronDown />
        </button>
      </div>

      {expanded && (
        <div className="search-provider-row__body">
          {preset.docsUrl && (
            <a
              className="search-provider-row__docs"
              href={preset.docsUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看官方文档 →
            </a>
          )}
          {preset.fields.length > 0 ? (
            <div className="form-grid form-grid--2 search-provider-row__form">
              {preset.fields.map((field) =>
                renderField(field, profile, visiblePasswords, onChange, onTogglePassword),
              )}
            </div>
          ) : (
            <p className="search-provider-row__empty">无需额外配置，开启即可使用。</p>
          )}
        </div>
      )}
    </li>
  );
}

function SearchSettingsSkeleton() {
  return (
    <ul className="search-provider-list" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="search-provider-row search-provider-row--skeleton">
          <div className="skeleton skeleton--icon" />
          <div className="search-provider-row__main">
            <div className="skeleton skeleton--line skeleton--md" />
            <div className="skeleton skeleton--line skeleton--lg" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SearchSettingsTab() {
  const [presets, setPresets] = useState<SearchProviderPreset[]>([]);
  const [providers, setProviders] = useState<SearchProviderProfile[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const dragAllowed = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SearchTestResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pre, reg] = await Promise.all([api.getSearchPresets(), api.getSearch()]);
      setPresets(pre);
      setProviders(reg.providers);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!testResult) return;
    const timer = window.setTimeout(() => setTestResult(null), 4000);
    return () => window.clearTimeout(timer);
  }, [testResult]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const resetDrag = () => {
      dragAllowed.current = false;
    };
    window.addEventListener("mouseup", resetDrag);
    return () => window.removeEventListener("mouseup", resetDrag);
  }, []);

  function presetFor(id: string): SearchProviderPreset {
    return (
      presets.find((p) => p.id === id) ?? {
        id: id as SearchProviderProfile["id"],
        name: id,
        description: "",
        requiresApiKey: false,
        fields: [],
      }
    );
  }

  function updateProvider(id: string, patch: Partial<SearchProviderProfile>) {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  }

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setProviders((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const reg = await api.saveSearch(providers);
      setProviders(reg.providers);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(id: string) {
    if (dirty) await handleSave();
    setTestingId(id);
    setTestResult(null);
    try {
      const result = await api.testSearch({ providerId: id, query: "test" });
      setTestResult(result);
    } catch (e) {
      setTestResult({
        success: false,
        providerId: id as SearchProviderProfile["id"],
        latencyMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTestingId(null);
    }
  }

  function togglePassword(fieldKey: string) {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  }

  const enabledReadyCount = providers.filter((p) =>
    isProviderReady(p, presetFor(p.id)),
  ).length;

  if (loading) {
    return (
      <div className="search-settings">
        <div className="search-settings__intro search-settings__intro--skeleton">
          <div className="skeleton skeleton--line skeleton--title" />
          <div className="skeleton skeleton--line skeleton--lg" />
        </div>
        <SearchSettingsSkeleton />
      </div>
    );
  }

  return (
    <div className="search-settings">
      <div className="search-settings__intro">
        <PanelToolbar
          badge={
            <>
              可用 <strong>{enabledReadyCount}</strong> / 共 <strong>{providers.length}</strong> 个后端
            </>
          }
          actions={
            <span className="search-settings__hint-inline">⋮⋮ 拖动手柄调整优先级</span>
          }
        />
        <p className="search-settings__desc">
          按优先级从上到下依次尝试已启用的搜索后端，失败时自动降级到下一个。
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <ul className="search-provider-list">
        {providers.map((profile, index) => (
          <SearchProviderRow
            key={profile.id}
            preset={presetFor(profile.id)}
            profile={profile}
            index={index}
            expanded={expandedId === profile.id}
            testing={testingId === profile.id}
            dragging={dragIndex === index}
            dropBefore={dropIndex === index && dragIndex !== null && dragIndex !== index}
            hovered={hoveredId === profile.id}
            visiblePasswords={visiblePasswords}
            onToggleExpand={() =>
              setExpandedId((cur) => (cur === profile.id ? null : profile.id))
            }
            onToggleEnabled={(enabled) => updateProvider(profile.id, { enabled })}
            onChange={(patch) => updateProvider(profile.id, patch)}
            onTest={() => void handleTest(profile.id)}
            onTogglePassword={togglePassword}
            onHover={(hovered) => setHoveredId(hovered ? profile.id : null)}
            onDragHandleDown={() => {
              dragAllowed.current = true;
            }}
            onDragStart={(e) => {
              if (!dragAllowed.current) {
                e.preventDefault();
                return;
              }
              setDragIndex(index);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", profile.id);
            }}
            onDragEnd={() => {
              dragAllowed.current = false;
              setDragIndex(null);
              setDropIndex(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === index) return;
              setDropIndex(index);
            }}
            onDrop={() => {
              if (dragIndex !== null) reorder(dragIndex, index);
              dragAllowed.current = false;
              setDragIndex(null);
              setDropIndex(null);
            }}
          />
        ))}
      </ul>

      <div className={`search-settings__footer ${dirty ? "search-settings__footer--dirty" : ""}`}>
        <span className="search-settings__footer-status">
          {dirty ? "有未保存的更改" : saving ? "保存中…" : "所有更改已保存"}
        </span>
        <div className="search-settings__footer-actions">
          {dirty && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving}
              onClick={() => void refresh()}
            >
              放弃更改
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "保存更改"}
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`test-toast ${testResult.success ? "ok" : "fail"}`}>
          <strong>{testResult.success ? "测试成功" : "测试失败"}</strong>
          <span>{testResult.latencyMs}ms</span>
          {testResult.resultCount !== undefined && (
            <span>{testResult.resultCount} 条结果</span>
          )}
          {!testResult.success && testResult.error && <p>{testResult.error}</p>}
          <button type="button" className="icon-btn" onClick={() => setTestResult(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
