import { useState } from "react";
import {
  connectionConfigToJson,
  mcpServerFromForm,
  mcpServerToConnectionConfig,
  parseMcpConnectionJson,
  type McpPreset,
  type McpServerConfig,
} from "@kako/shared";
import { McpApprovalAdvanced } from "./McpApprovalControls";

export type McpFormMode = "add" | "edit";

interface McpFormPageProps {
  mode: McpFormMode;
  presets: McpPreset[];
  existingIds: string[];
  server?: McpServerConfig;
  onBack: () => void;
  onSave: (server: McpServerConfig) => Promise<void>;
}

function slugifyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function McpFormPage({
  mode,
  presets,
  existingIds,
  server,
  onBack,
  onSave,
}: McpFormPageProps) {
  const defaultPreset = presets[0];
  const isEdit = mode === "edit" && server;

  const [presetId, setPresetId] = useState(server?.preset ?? defaultPreset?.id ?? "custom");
  const [title, setTitle] = useState(isEdit ? server.id : (defaultPreset?.title ?? ""));
  const [displayName, setDisplayName] = useState(
    isEdit ? server.name : (defaultPreset?.displayName ?? ""),
  );
  const [configJson, setConfigJson] = useState(
    isEdit
      ? connectionConfigToJson(mcpServerToConnectionConfig(server))
      : defaultPreset
        ? connectionConfigToJson(defaultPreset.config)
        : "{\n  \"type\": \"stdio\"\n}",
  );
  const [showExtra, setShowExtra] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [approvalDraft, setApprovalDraft] = useState<McpServerConfig | null>(
    isEdit ? server : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(preset: McpPreset) {
    if (isEdit) return;
    setTitle(preset.title);
    setDisplayName(preset.displayName);
    setConfigJson(connectionConfigToJson(preset.config));
    setError(null);
  }

  function selectPreset(id: string) {
    if (isEdit) return;
    setPresetId(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) applyPreset(preset);
  }

  function handleFormat() {
    try {
      const config = parseMcpConnectionJson(configJson);
      setConfigJson(connectionConfigToJson(config));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    const id = isEdit ? server.id : slugifyId(title);
    if (!id) {
      setError("请填写 MCP 标题（唯一标识）");
      return;
    }
    if (!displayName.trim()) {
      setError("请填写显示名称");
      return;
    }
    if (!isEdit && existingIds.includes(id)) {
      setError(`标题「${id}」已存在，请换一个唯一标题`);
      return;
    }

    let config;
    try {
      config = parseMcpConnectionJson(configJson);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const approvalSource = approvalDraft ?? (isEdit ? server : undefined);
      const next = mcpServerFromForm({
        id,
        name: displayName.trim(),
        config,
        preset: presetId,
        enabled: isEdit ? server.enabled : true,
        createdAt: isEdit ? server.createdAt : undefined,
        approvalMode: approvalSource?.approvalMode ?? "onRequest",
        toolApproval: approvalSource?.toolApproval,
      });
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-page">
      <header className="form-page__header">
        <button type="button" className="icon-btn form-page__back" onClick={onBack}>
          ←
        </button>
        <h1>{isEdit ? "编辑 MCP" : "新增 MCP"}</h1>
      </header>

      <div className="form-page__body">
        {error && <div className="banner banner--error">{error}</div>}

        <section className="form-section form-section--card">
          {!isEdit && (
            <label className="field">
              <span className="field__label">选择 MCP 类型</span>
              <div className="mcp-preset-chips">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`mcp-preset-chip ${presetId === preset.id ? "mcp-preset-chip--active" : ""}`}
                    onClick={() => selectPreset(preset.id)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </label>
          )}

          <label className="field">
            <span className="field__label">
              MCP 标题（唯一）<span className="field__required">*</span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="my-mcp-server"
              readOnly={Boolean(isEdit)}
              disabled={Boolean(isEdit)}
            />
            {isEdit ? (
              <span className="field__hint">编辑时不可修改唯一标识</span>
            ) : (
              title.trim() && (
                <span className="field__hint">标识：{slugifyId(title) || "—"}</span>
              )
            )}
          </label>

          <label className="field">
            <span className="field__label">
              显示名称<span className="field__required">*</span>
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如 @modelcontextprotocol/server-time"
            />
          </label>

          <button
            type="button"
            className="mcp-extra-toggle"
            onClick={() => setShowExtra((v) => !v)}
          >
            <span>附加信息</span>
            <span className="mcp-extra-toggle__icon">{showExtra ? "▲" : "▼"}</span>
          </button>

          {showExtra && (
            <p className="mcp-hint">
              stdio 可在 JSON 中配置 <code>env</code>；远程 MCP（<code>http</code> /{" "}
              <code>sse</code>）可配置 <code>url</code> 与 <code>headers</code>。
            </p>
          )}
        </section>

        <section className="form-section form-section--card mcp-json-section">
          <div className="mcp-json-section__header">
            <span className="field__label">完整的 JSON 配置</span>
          </div>
          <textarea
            className="mcp-json-editor"
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            spellCheck={false}
            rows={12}
          />
          <button type="button" className="btn btn--ghost btn--sm mcp-json-format" onClick={handleFormat}>
            ✨ 格式化
          </button>
        </section>

        <button
          type="button"
          className="mcp-extra-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span>高级选项</span>
          <span className="mcp-extra-toggle__icon">{showAdvanced ? "▲" : "▼"}</span>
        </button>

        {showAdvanced && (
          <section className="form-section form-section--card advanced-panel mcp-approval-panel">
            <p className="mcp-hint">
              控制该 MCP 工具执行前是否弹出审批。单工具设置优先于服务默认；未列出的工具请在保存后于列表页展开配置。
            </p>
            <McpApprovalAdvanced
              server={
                approvalDraft ?? {
                  id: isEdit ? server.id : slugifyId(title) || "new-mcp",
                  name: displayName.trim() || "MCP",
                  enabled: true,
                  transport: "stdio",
                  approvalMode: "onRequest",
                }
              }
              serverTools={[]}
              onChange={(next) => setApprovalDraft(next)}
            />
          </section>
        )}
      </div>

      <footer className="form-page__footer">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "保存中…" : isEdit ? "保存" : "+ 添加"}
        </button>
      </footer>
    </div>
  );
}
