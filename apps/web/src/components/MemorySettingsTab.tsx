import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MEMORY_AUTO_RECALL_UI_DEFAULTS,
  MEMORY_FIELD_RANGES,
  applyMemoryGroupDefaults,
  charsToUiK,
  isInRange,
  tokensToUiK,
  uiKToChars,
  uiKToTokens,
  type MemorySettingsGroupId,
  type MemorySettingsSnapshot,
} from "@kako/shared";
import { api, type MemorySettingsFile } from "../api";
import { HelpTip, TitleWithHelp } from "./HelpTip";
import { MEMORY_GROUP_HELP, MEMORY_JOB_HELP } from "./memory-settings-help";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const GROUPS: { id: MemorySettingsGroupId; label: string }[] = [
  { id: "autoRecall", label: "自动召回" },
  { id: "curatedTools", label: "策展与工具" },
  { id: "backgroundReview", label: "回合回顾" },
  { id: "budget", label: "LLM 配额" },
  { id: "jobs", label: "高级任务" },
];

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`settings-toggle-row ${disabled ? "settings-toggle-row--disabled" : ""}`}>
      <span className="settings-toggle-row__label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle ${checked ? "toggle--on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" />
      </button>
    </div>
  );
}

function FieldShell({
  label,
  help,
  unit,
  error,
  children,
}: {
  label: string;
  help?: string;
  unit?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className={`settings-field settings-field--spaced ${error ? "settings-field--error" : ""}`}>
      <label className="settings-field__label">
        {label}
        {unit ? <span className="settings-field__unit">（{unit}）</span> : null}
      </label>
      {children}
      {error ? <p className="settings-field__error">{error}</p> : null}
      {help && !error ? <p className="settings-field__help">{help}</p> : null}
      {help && error ? <p className="settings-field__help">{help}</p> : null}
    </div>
  );
}

function MemorySettingsSkeleton() {
  return (
    <div className="settings-page memory-settings" aria-hidden="true">
      <div className="memory-settings__layout">
        <div className="memory-settings__nav">
          <div className="skeleton skeleton--line skeleton--md" />
          <div className="skeleton skeleton--line skeleton--md" />
        </div>
        <div className="memory-settings__panel">
          <div className="skeleton skeleton--line skeleton--title" />
          <div className="skeleton skeleton--line skeleton--lg" />
        </div>
      </div>
    </div>
  );
}

function asSnapshot(file: MemorySettingsFile): MemorySettingsSnapshot {
  return file as MemorySettingsSnapshot;
}

export function MemorySettingsTab() {
  const [settings, setSettings] = useState<MemorySettingsSnapshot | null>(null);
  const [group, setGroup] = useState<MemorySettingsGroupId>("autoRecall");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const saveChain = useRef(Promise.resolve());
  const settingsRef = useRef<MemorySettingsSnapshot | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = asSnapshot(await api.getMemory());
      setSettings(next);
      settingsRef.current = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback((next: MemorySettingsSnapshot) => {
    setSettings(next);
    settingsRef.current = next;
    setStatus("saving");
    setError(null);
    saveChain.current = saveChain.current
      .then(async () => {
        const saved = asSnapshot(await api.saveMemory(next as MemorySettingsFile));
        setSettings(saved);
        settingsRef.current = saved;
        setStatus("saved");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      });
    return saveChain.current;
  }, []);

  const patch = useCallback(
    (updater: (prev: MemorySettingsSnapshot) => MemorySettingsSnapshot) => {
      const prev = settingsRef.current;
      if (!prev) return;
      void persist(updater(prev));
    },
    [persist],
  );

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setFieldError = (key: string, message: string) => {
    setFieldErrors((prev) => ({ ...prev, [key]: message }));
  };

  const selectGroup = (id: MemorySettingsGroupId) => {
    setGroup(id);
    setRestoreConfirm(false);
    setFieldErrors({});
  };

  const restoreGroup = () => {
    const prev = settingsRef.current;
    if (!prev) return;
    setRestoreConfirm(false);
    void persist(applyMemoryGroupDefaults(prev, group));
  };

  if (loading || !settings) {
    return <MemorySettingsSkeleton />;
  }

  const statusLabel =
    status === "saving"
      ? "保存中…"
      : status === "saved"
        ? "已保存"
        : status === "error"
          ? "保存失败"
          : "已同步";

  return (
    <div className="settings-page memory-settings">
      <div className="memory-settings__toolbar">
        <p className="settings-page__desc memory-settings__intro">
          控制会话记忆注入、策展笔记、回合后回顾与 LLM 配额。写入{" "}
          <code>~/.kako/config/memory.json</code>。改动会立即保存。
        </p>
        <span
          className={`memory-settings__status memory-settings__status--${status}`}
          aria-live="polite"
        >
          {statusLabel}
        </span>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <div className="memory-settings__layout">
        <nav className="memory-settings__nav" aria-label="记忆设置分组">
          {GROUPS.map((item) => (
            <div
              key={item.id}
              className={`memory-settings__nav-row ${group === item.id ? "memory-settings__nav-row--active" : ""}`}
            >
              <button
                type="button"
                className={`memory-settings__nav-item ${group === item.id ? "memory-settings__nav-item--active" : ""}`}
                onClick={() => selectGroup(item.id)}
              >
                {item.label}
              </button>
              <HelpTip
                className="memory-settings__nav-tip"
                content={MEMORY_GROUP_HELP[item.id]}
              />
            </div>
          ))}
        </nav>

        <div className="memory-settings__panel">
          {group === "autoRecall" && (
            <AutoRecallPanel
              settings={settings}
              fieldErrors={fieldErrors}
              onToggle={(enabled) => patch((s) => ({ ...s, autoRecall: { ...s.autoRecall, enabled } }))}
              onClearError={clearFieldError}
              onSetError={setFieldError}
              onCommitSnippets={(maxSnippets) =>
                patch((s) => ({ ...s, autoRecall: { ...s.autoRecall, maxSnippets } }))
              }
              onCommitTokens={(maxTokens) =>
                patch((s) => ({ ...s, autoRecall: { ...s.autoRecall, maxTokens } }))
              }
            />
          )}
          {group === "curatedTools" && (
            <CuratedToolsPanel
              settings={settings}
              fieldErrors={fieldErrors}
              onClearError={clearFieldError}
              onSetError={setFieldError}
              patch={patch}
            />
          )}
          {group === "backgroundReview" && (
            <BackgroundReviewPanel
              settings={settings}
              fieldErrors={fieldErrors}
              onClearError={clearFieldError}
              onSetError={setFieldError}
              patch={patch}
            />
          )}
          {group === "budget" && (
            <BudgetPanel
              settings={settings}
              fieldErrors={fieldErrors}
              onClearError={clearFieldError}
              onSetError={setFieldError}
              patch={patch}
            />
          )}
          {group === "jobs" && <JobsPanel settings={settings} patch={patch} />}

          <div className="memory-settings__restore">
            {!restoreConfirm ? (
              <button
                type="button"
                className="btn btn--soft-warn"
                onClick={() => setRestoreConfirm(true)}
              >
                恢复本组默认
              </button>
            ) : (
              <div className="memory-settings__restore-confirm" role="group" aria-label="确认恢复默认">
                <p className="memory-settings__restore-warn">
                  将把本组改回出厂默认并立即保存，其他分组不受影响。
                </p>
                <div className="memory-settings__restore-actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setRestoreConfirm(false)}>
                    取消
                  </button>
                  <button type="button" className="btn btn--primary" onClick={restoreGroup}>
                    确认恢复
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoRecallPanel({
  settings,
  fieldErrors,
  onToggle,
  onClearError,
  onSetError,
  onCommitSnippets,
  onCommitTokens,
}: {
  settings: MemorySettingsSnapshot;
  fieldErrors: Record<string, string>;
  onToggle: (enabled: boolean) => void;
  onClearError: (key: string) => void;
  onSetError: (key: string, message: string) => void;
  onCommitSnippets: (n: number | undefined) => void;
  onCommitTokens: (n: number | undefined) => void;
}) {
  const [snippetsDraft, setSnippetsDraft] = useState(
    settings.autoRecall.maxSnippets !== undefined ? String(settings.autoRecall.maxSnippets) : "",
  );
  const [tokensDraft, setTokensDraft] = useState(
    settings.autoRecall.maxTokens !== undefined ? String(tokensToUiK(settings.autoRecall.maxTokens)) : "",
  );

  useEffect(() => {
    setSnippetsDraft(
      settings.autoRecall.maxSnippets !== undefined ? String(settings.autoRecall.maxSnippets) : "",
    );
    setTokensDraft(
      settings.autoRecall.maxTokens !== undefined ? String(tokensToUiK(settings.autoRecall.maxTokens)) : "",
    );
  }, [settings.autoRecall.maxSnippets, settings.autoRecall.maxTokens]);

  return (
    <section className="settings-card memory-settings__card">
      <TitleWithHelp title="自动召回" content={MEMORY_GROUP_HELP.autoRecall} />
      <p className="memory-settings__lead">
        每轮用户消息后检索有界记忆片段并注入上下文。关闭后仍可通过 MemorySearch / MemoryGet 按需取用。
      </p>
      <Toggle label="启用自动召回" checked={settings.autoRecall.enabled} onChange={onToggle} />
      {settings.autoRecall.enabled && (
        <>
          <FieldShell
            label="最大片段数"
            unit="个"
            help={`留空则使用系统默认 ${MEMORY_AUTO_RECALL_UI_DEFAULTS.maxSnippets}。范围 ${MEMORY_FIELD_RANGES.maxSnippets.min}–${MEMORY_FIELD_RANGES.maxSnippets.max}。`}
            error={fieldErrors.snippets}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.maxSnippets.min}
              max={MEMORY_FIELD_RANGES.maxSnippets.max}
              step={1}
              placeholder={String(MEMORY_AUTO_RECALL_UI_DEFAULTS.maxSnippets)}
              value={snippetsDraft}
              aria-invalid={Boolean(fieldErrors.snippets)}
              onChange={(e) => setSnippetsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onBlur={() => {
                const raw = snippetsDraft.trim();
                if (!raw) {
                  onClearError("snippets");
                  onCommitSnippets(undefined);
                  return;
                }
                const n = Number(raw);
                if (!isInRange(n, MEMORY_FIELD_RANGES.maxSnippets.min, MEMORY_FIELD_RANGES.maxSnippets.max)) {
                  onSetError(
                    "snippets",
                    `请输入 ${MEMORY_FIELD_RANGES.maxSnippets.min}–${MEMORY_FIELD_RANGES.maxSnippets.max}`,
                  );
                  return;
                }
                onClearError("snippets");
                onCommitSnippets(Math.round(n));
              }}
            />
          </FieldShell>
          <FieldShell
            label="最大 token"
            unit="k"
            help={`默认 ${MEMORY_AUTO_RECALL_UI_DEFAULTS.maxTokensK} k（约 ${uiKToTokens(MEMORY_AUTO_RECALL_UI_DEFAULTS.maxTokensK)} tokens）。范围 ${MEMORY_FIELD_RANGES.maxTokensK.min}–${MEMORY_FIELD_RANGES.maxTokensK.max} k。实际生效为设置值与当前模型上下文窗口的较小者；1024 k ≈ 1M，多数模型更小。`}
            error={fieldErrors.tokens}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.maxTokensK.min}
              max={MEMORY_FIELD_RANGES.maxTokensK.max}
              step={0.1}
              placeholder={String(MEMORY_AUTO_RECALL_UI_DEFAULTS.maxTokensK)}
              value={tokensDraft}
              aria-invalid={Boolean(fieldErrors.tokens)}
              onChange={(e) => setTokensDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onBlur={() => {
                const raw = tokensDraft.trim();
                if (!raw) {
                  onClearError("tokens");
                  onCommitTokens(undefined);
                  return;
                }
                const k = Number(raw);
                if (!isInRange(k, MEMORY_FIELD_RANGES.maxTokensK.min, MEMORY_FIELD_RANGES.maxTokensK.max)) {
                  onSetError(
                    "tokens",
                    `请输入 ${MEMORY_FIELD_RANGES.maxTokensK.min}–${MEMORY_FIELD_RANGES.maxTokensK.max}（单位 k）`,
                  );
                  return;
                }
                onClearError("tokens");
                onCommitTokens(uiKToTokens(k));
              }}
            />
          </FieldShell>
        </>
      )}
    </section>
  );
}

function CuratedToolsPanel({
  settings,
  fieldErrors,
  onClearError,
  onSetError,
  patch,
}: {
  settings: MemorySettingsSnapshot;
  fieldErrors: Record<string, string>;
  onClearError: (key: string) => void;
  onSetError: (key: string, message: string) => void;
  patch: (updater: (prev: MemorySettingsSnapshot) => MemorySettingsSnapshot) => void;
}) {
  const [notesDraft, setNotesDraft] = useState(String(settings.curated.notesCharLimit));
  const [userDraft, setUserDraft] = useState(String(settings.curated.userCharLimit));

  useEffect(() => {
    setNotesDraft(String(settings.curated.notesCharLimit));
    setUserDraft(String(settings.curated.userCharLimit));
  }, [settings.curated.notesCharLimit, settings.curated.userCharLimit]);

  return (
    <section className="settings-card memory-settings__card">
      <TitleWithHelp title="策展与工具" content={MEMORY_GROUP_HELP.curatedTools} />
      <p className="memory-settings__lead">
        管理有界策展笔记（notes / user）、主对话 Memory 工具，以及写入是否需要审批。
      </p>
      <Toggle
        label="启用策展记忆"
        checked={settings.curated.enabled}
        onChange={(enabled) => patch((s) => ({ ...s, curated: { ...s.curated, enabled } }))}
      />
      {settings.curated.enabled && (
        <>
          <FieldShell
            label="notes 字符上限"
            unit="字符"
            help={`默认 2200。超限写入会返回错误，不会静默截断。范围 ${MEMORY_FIELD_RANGES.notesCharLimit.min}–${MEMORY_FIELD_RANGES.notesCharLimit.max}。`}
            error={fieldErrors.notes}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.notesCharLimit.min}
              max={MEMORY_FIELD_RANGES.notesCharLimit.max}
              placeholder="2200"
              value={notesDraft}
              aria-invalid={Boolean(fieldErrors.notes)}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={() => {
                const n = Number(notesDraft);
                if (!isInRange(n, MEMORY_FIELD_RANGES.notesCharLimit.min, MEMORY_FIELD_RANGES.notesCharLimit.max)) {
                  onSetError(
                    "notes",
                    `请输入 ${MEMORY_FIELD_RANGES.notesCharLimit.min}–${MEMORY_FIELD_RANGES.notesCharLimit.max}`,
                  );
                  return;
                }
                onClearError("notes");
                patch((s) => ({ ...s, curated: { ...s.curated, notesCharLimit: Math.round(n) } }));
              }}
            />
          </FieldShell>
          <FieldShell
            label="user 字符上限"
            unit="字符"
            help={`默认 1375。范围 ${MEMORY_FIELD_RANGES.userCharLimit.min}–${MEMORY_FIELD_RANGES.userCharLimit.max}。`}
            error={fieldErrors.user}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.userCharLimit.min}
              max={MEMORY_FIELD_RANGES.userCharLimit.max}
              placeholder="1375"
              value={userDraft}
              aria-invalid={Boolean(fieldErrors.user)}
              onChange={(e) => setUserDraft(e.target.value)}
              onBlur={() => {
                const n = Number(userDraft);
                if (!isInRange(n, MEMORY_FIELD_RANGES.userCharLimit.min, MEMORY_FIELD_RANGES.userCharLimit.max)) {
                  onSetError(
                    "user",
                    `请输入 ${MEMORY_FIELD_RANGES.userCharLimit.min}–${MEMORY_FIELD_RANGES.userCharLimit.max}`,
                  );
                  return;
                }
                onClearError("user");
                patch((s) => ({ ...s, curated: { ...s.curated, userCharLimit: Math.round(n) } }));
              }}
            />
          </FieldShell>
          <Toggle
            label="冻结会话注入快照"
            checked={settings.curated.injectFrozenSnapshot}
            onChange={(injectFrozenSnapshot) =>
              patch((s) => ({ ...s, curated: { ...s.curated, injectFrozenSnapshot } }))
            }
          />
          <p className="settings-field__help memory-settings__inline-help">
            开启后，会话内策展注入快照不再随磁盘更新而刷新，有利于 prompt cache 稳定。
          </p>
        </>
      )}
      <Toggle
        label="Memory 工具"
        checked={settings.memoryTool.enabled}
        onChange={(enabled) => patch((s) => ({ ...s, memoryTool: { ...s.memoryTool, enabled } }))}
      />
      <p className="settings-field__help memory-settings__inline-help">
        主对话内对 notes/user 增删改；关闭后工具仍注册，调用会返回明确错误。
      </p>
      <Toggle
        label="写入审批"
        checked={settings.writeApproval.enabled}
        onChange={(enabled) => patch((s) => ({ ...s, writeApproval: { ...s.writeApproval, enabled } }))}
      />
      <p className="settings-field__help memory-settings__inline-help">
        开启后策展/回顾写入先进 pending，需审批后再落盘；默认关闭（自由写入）。
      </p>
    </section>
  );
}

function BackgroundReviewPanel({
  settings,
  fieldErrors,
  onClearError,
  onSetError,
  patch,
}: {
  settings: MemorySettingsSnapshot;
  fieldErrors: Record<string, string>;
  onClearError: (key: string) => void;
  onSetError: (key: string, message: string) => void;
  patch: (updater: (prev: MemorySettingsSnapshot) => MemorySettingsSnapshot) => void;
}) {
  const br = settings.backgroundReview;
  const [cooldown, setCooldown] = useState(String(br.cooldownSeconds));
  const [perHour, setPerHour] = useState(String(br.maxPerHour));
  const [perDay, setPerDay] = useState(String(br.maxPerDay));
  const [digestK, setDigestK] = useState(String(charsToUiK(br.digestMaxChars)));
  const [model, setModel] = useState(br.model ?? "");

  useEffect(() => {
    setCooldown(String(br.cooldownSeconds));
    setPerHour(String(br.maxPerHour));
    setPerDay(String(br.maxPerDay));
    setDigestK(String(charsToUiK(br.digestMaxChars)));
    setModel(br.model ?? "");
  }, [br.cooldownSeconds, br.maxPerHour, br.maxPerDay, br.digestMaxChars, br.model]);

  const commitNumber = (
    key: string,
    raw: string,
    min: number,
    max: number,
    apply: (n: number) => void,
  ) => {
    const n = Number(raw);
    if (!isInRange(n, min, max)) {
      onSetError(key, `请输入 ${min}–${max}`);
      return;
    }
    onClearError(key);
    apply(Math.round(n));
  };

  return (
    <section className="settings-card memory-settings__card">
      <TitleWithHelp title="回合回顾" content={MEMORY_GROUP_HELP.backgroundReview} />
      <p className="memory-settings__lead">
        有实质用户提问或模型正文后异步回顾；无工具 complete，受冷却与配额约束。
      </p>
      <Toggle
        label="启用回合后回顾"
        checked={br.enabled}
        onChange={(enabled) =>
          patch((s) => ({ ...s, backgroundReview: { ...s.backgroundReview, enabled } }))
        }
      />
      {br.enabled && (
        <>
          <FieldShell
            label="冷却"
            unit="秒"
            help={`两次回顾的最小间隔。默认 120。范围 ${MEMORY_FIELD_RANGES.cooldownSeconds.min}–${MEMORY_FIELD_RANGES.cooldownSeconds.max}。`}
            error={fieldErrors.cooldown}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.cooldownSeconds.min}
              max={MEMORY_FIELD_RANGES.cooldownSeconds.max}
              placeholder="120"
              value={cooldown}
              aria-invalid={Boolean(fieldErrors.cooldown)}
              onChange={(e) => setCooldown(e.target.value)}
              onBlur={() =>
                commitNumber(
                  "cooldown",
                  cooldown,
                  MEMORY_FIELD_RANGES.cooldownSeconds.min,
                  MEMORY_FIELD_RANGES.cooldownSeconds.max,
                  (cooldownSeconds) =>
                    patch((s) => ({
                      ...s,
                      backgroundReview: { ...s.backgroundReview, cooldownSeconds },
                    })),
                )
              }
            />
          </FieldShell>
          <FieldShell
            label="每小时上限"
            unit="次"
            help={`默认 20。0 表示本小时不再运行。范围 ${MEMORY_FIELD_RANGES.reviewMaxPerHour.min}–${MEMORY_FIELD_RANGES.reviewMaxPerHour.max}。`}
            error={fieldErrors.perHour}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.reviewMaxPerHour.min}
              max={MEMORY_FIELD_RANGES.reviewMaxPerHour.max}
              placeholder="20"
              value={perHour}
              aria-invalid={Boolean(fieldErrors.perHour)}
              onChange={(e) => setPerHour(e.target.value)}
              onBlur={() =>
                commitNumber(
                  "perHour",
                  perHour,
                  MEMORY_FIELD_RANGES.reviewMaxPerHour.min,
                  MEMORY_FIELD_RANGES.reviewMaxPerHour.max,
                  (maxPerHour) =>
                    patch((s) => ({
                      ...s,
                      backgroundReview: { ...s.backgroundReview, maxPerHour },
                    })),
                )
              }
            />
          </FieldShell>
          <FieldShell
            label="每天上限"
            unit="次"
            help={`默认 200。范围 ${MEMORY_FIELD_RANGES.reviewMaxPerDay.min}–${MEMORY_FIELD_RANGES.reviewMaxPerDay.max}。`}
            error={fieldErrors.perDay}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.reviewMaxPerDay.min}
              max={MEMORY_FIELD_RANGES.reviewMaxPerDay.max}
              placeholder="200"
              value={perDay}
              aria-invalid={Boolean(fieldErrors.perDay)}
              onChange={(e) => setPerDay(e.target.value)}
              onBlur={() =>
                commitNumber(
                  "perDay",
                  perDay,
                  MEMORY_FIELD_RANGES.reviewMaxPerDay.min,
                  MEMORY_FIELD_RANGES.reviewMaxPerDay.max,
                  (maxPerDay) =>
                    patch((s) => ({
                      ...s,
                      backgroundReview: { ...s.backgroundReview, maxPerDay },
                    })),
                )
              }
            />
          </FieldShell>
          <FieldShell
            label="摘要最大长度"
            unit="千字符"
            help={`默认 12（即 12000 字符）。范围 ${MEMORY_FIELD_RANGES.digestMaxCharsK.min}–${MEMORY_FIELD_RANGES.digestMaxCharsK.max}。`}
            error={fieldErrors.digest}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.digestMaxCharsK.min}
              max={MEMORY_FIELD_RANGES.digestMaxCharsK.max}
              step={1}
              placeholder="12"
              value={digestK}
              aria-invalid={Boolean(fieldErrors.digest)}
              onChange={(e) => setDigestK(e.target.value)}
              onBlur={() => {
                const k = Number(digestK);
                if (
                  !isInRange(
                    k,
                    MEMORY_FIELD_RANGES.digestMaxCharsK.min,
                    MEMORY_FIELD_RANGES.digestMaxCharsK.max,
                  )
                ) {
                  onSetError(
                    "digest",
                    `请输入 ${MEMORY_FIELD_RANGES.digestMaxCharsK.min}–${MEMORY_FIELD_RANGES.digestMaxCharsK.max}（千字符）`,
                  );
                  return;
                }
                onClearError("digest");
                patch((s) => ({
                  ...s,
                  backgroundReview: { ...s.backgroundReview, digestMaxChars: uiKToChars(k) },
                }));
              }}
            />
          </FieldShell>
          <FieldShell
            label="辅助模型"
            help="留空则使用当前会话主模型。"
            error={fieldErrors.model}
          >
            <input
              className="settings-field__input"
              type="text"
              placeholder="与主模型相同"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => {
                onClearError("model");
                const trimmed = model.trim();
                patch((s) => ({
                  ...s,
                  backgroundReview: {
                    ...s.backgroundReview,
                    model: trimmed ? trimmed : null,
                  },
                }));
              }}
            />
          </FieldShell>
          <Toggle
            label="更新策展条目"
            checked={br.updateCurated}
            onChange={(updateCurated) =>
              patch((s) => ({
                ...s,
                backgroundReview: { ...s.backgroundReview, updateCurated },
              }))
            }
          />
          <Toggle
            label="提取事实"
            checked={br.extractFacts}
            onChange={(extractFacts) =>
              patch((s) => ({
                ...s,
                backgroundReview: { ...s.backgroundReview, extractFacts },
              }))
            }
          />
        </>
      )}
    </section>
  );
}

function BudgetPanel({
  settings,
  fieldErrors,
  onClearError,
  onSetError,
  patch,
}: {
  settings: MemorySettingsSnapshot;
  fieldErrors: Record<string, string>;
  onClearError: (key: string) => void;
  onSetError: (key: string, message: string) => void;
  patch: (updater: (prev: MemorySettingsSnapshot) => MemorySettingsSnapshot) => void;
}) {
  const b = settings.budget;
  const [hour, setHour] = useState(String(b.maxLlmCallsPerHour));
  const [day, setDay] = useState(String(b.maxLlmCallsPerDay));
  const [concurrent, setConcurrent] = useState(String(b.maxConcurrentJobs));

  useEffect(() => {
    setHour(String(b.maxLlmCallsPerHour));
    setDay(String(b.maxLlmCallsPerDay));
    setConcurrent(String(b.maxConcurrentJobs));
  }, [b.maxLlmCallsPerHour, b.maxLlmCallsPerDay, b.maxConcurrentJobs]);

  const commit = (
    key: string,
    raw: string,
    min: number,
    max: number,
    apply: (n: number) => void,
  ) => {
    const n = Number(raw);
    if (!isInRange(n, min, max)) {
      onSetError(key, `请输入 ${min}–${max}`);
      return;
    }
    onClearError(key);
    apply(Math.round(n));
  };

  return (
    <section className="settings-card memory-settings__card">
      <TitleWithHelp title="LLM 配额" content={MEMORY_GROUP_HELP.budget} />
      <p className="memory-settings__lead">
        限制记忆相关 LLM 调用的小时/日总量与并发（回顾与 Phase 2 任务共享）。
      </p>
      <Toggle
        label="启用共享 LLM 预算"
        checked={b.enabled}
        onChange={(enabled) => patch((s) => ({ ...s, budget: { ...s.budget, enabled } }))}
      />
      {b.enabled && (
        <>
          <FieldShell
            label="每小时调用上限"
            unit="次"
            help={`默认 40。范围 ${MEMORY_FIELD_RANGES.budgetMaxPerHour.min}–${MEMORY_FIELD_RANGES.budgetMaxPerHour.max}。`}
            error={fieldErrors.bHour}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.budgetMaxPerHour.min}
              max={MEMORY_FIELD_RANGES.budgetMaxPerHour.max}
              placeholder="40"
              value={hour}
              aria-invalid={Boolean(fieldErrors.bHour)}
              onChange={(e) => setHour(e.target.value)}
              onBlur={() =>
                commit(
                  "bHour",
                  hour,
                  MEMORY_FIELD_RANGES.budgetMaxPerHour.min,
                  MEMORY_FIELD_RANGES.budgetMaxPerHour.max,
                  (maxLlmCallsPerHour) =>
                    patch((s) => ({ ...s, budget: { ...s.budget, maxLlmCallsPerHour } })),
                )
              }
            />
          </FieldShell>
          <FieldShell
            label="每天调用上限"
            unit="次"
            help={`默认 300。范围 ${MEMORY_FIELD_RANGES.budgetMaxPerDay.min}–${MEMORY_FIELD_RANGES.budgetMaxPerDay.max}。`}
            error={fieldErrors.bDay}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.budgetMaxPerDay.min}
              max={MEMORY_FIELD_RANGES.budgetMaxPerDay.max}
              placeholder="300"
              value={day}
              aria-invalid={Boolean(fieldErrors.bDay)}
              onChange={(e) => setDay(e.target.value)}
              onBlur={() =>
                commit(
                  "bDay",
                  day,
                  MEMORY_FIELD_RANGES.budgetMaxPerDay.min,
                  MEMORY_FIELD_RANGES.budgetMaxPerDay.max,
                  (maxLlmCallsPerDay) =>
                    patch((s) => ({ ...s, budget: { ...s.budget, maxLlmCallsPerDay } })),
                )
              }
            />
          </FieldShell>
          <FieldShell
            label="最大并发任务"
            unit="个"
            help={`默认 1。范围 ${MEMORY_FIELD_RANGES.maxConcurrentJobs.min}–${MEMORY_FIELD_RANGES.maxConcurrentJobs.max}。`}
            error={fieldErrors.bConcurrent}
          >
            <input
              className="settings-field__input"
              type="number"
              min={MEMORY_FIELD_RANGES.maxConcurrentJobs.min}
              max={MEMORY_FIELD_RANGES.maxConcurrentJobs.max}
              placeholder="1"
              value={concurrent}
              aria-invalid={Boolean(fieldErrors.bConcurrent)}
              onChange={(e) => setConcurrent(e.target.value)}
              onBlur={() =>
                commit(
                  "bConcurrent",
                  concurrent,
                  MEMORY_FIELD_RANGES.maxConcurrentJobs.min,
                  MEMORY_FIELD_RANGES.maxConcurrentJobs.max,
                  (maxConcurrentJobs) =>
                    patch((s) => ({ ...s, budget: { ...s.budget, maxConcurrentJobs } })),
                )
              }
            />
          </FieldShell>
        </>
      )}
    </section>
  );
}

function JobsPanel({
  settings,
  patch,
}: {
  settings: MemorySettingsSnapshot;
  patch: (updater: (prev: MemorySettingsSnapshot) => MemorySettingsSnapshot) => void;
}) {
  return (
    <section className="settings-card memory-settings__card">
      <TitleWithHelp title="高级任务" content={MEMORY_GROUP_HELP.jobs} />
      <p className="memory-settings__lead">
        日终与离线记忆流水线：汇总巩固（Consolidate）、策展清理（Curator）、离线整理（Dreaming）。
      </p>
      <Toggle
        label={
          <>
            Consolidate
            <HelpTip content={MEMORY_JOB_HELP.consolidate} />
          </>
        }
        checked={settings.jobs.consolidate.enabled}
        onChange={(enabled) =>
          patch((s) => ({
            ...s,
            jobs: {
              ...s.jobs,
              consolidate: { ...s.jobs.consolidate, enabled },
            },
          }))
        }
      />
      <Toggle
        label={
          <>
            Curator
            <HelpTip content={MEMORY_JOB_HELP.curator} />
          </>
        }
        checked={settings.jobs.curator.enabled}
        onChange={(enabled) =>
          patch((s) => ({
            ...s,
            jobs: {
              ...s.jobs,
              curator: { ...s.jobs.curator, enabled },
            },
          }))
        }
      />
      <Toggle
        label={
          <>
            Dreaming
            <HelpTip content={MEMORY_JOB_HELP.dreaming} />
          </>
        }
        checked={settings.jobs.dreaming.enabled}
        onChange={(enabled) =>
          patch((s) => ({
            ...s,
            jobs: {
              ...s.jobs,
              dreaming: { ...s.jobs.dreaming, enabled },
            },
          }))
        }
      />
    </section>
  );
}
