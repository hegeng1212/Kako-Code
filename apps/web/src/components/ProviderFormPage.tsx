import { useEffect, useMemo, useState } from "react";
import type { ProviderPreset, ProviderProfile, ProviderTestConfig } from "@kako/shared";
import { DEFAULT_TEST_CONFIG, normalizeTestConfig } from "@kako/shared";
import { ProviderIcon } from "./ProviderIcon";
import { IconEye, IconEyeOff } from "./RowIcons";

export type ProviderFormMode = "add" | "edit";

interface ProviderFormPageProps {
  mode: ProviderFormMode;
  presets: ProviderPreset[];
  profile?: ProviderProfile;
  globalTest?: ProviderTestConfig;
  onBack: () => void;
  onSave: (profile: ProviderProfile) => Promise<void>;
}

function emptyProfile(preset: ProviderPreset, globalTest?: ProviderTestConfig): ProviderProfile {
  const id = preset.id === "custom" ? `custom-${Date.now()}` : preset.id;
  return {
    id,
    name: preset.id === "custom" ? "" : preset.name,
    protocol: "openai-compatible",
    baseUrl: preset.baseUrl,
    apiKey: "",
    models: preset.exampleModels ?? [],
    defaultModel: preset.exampleModels?.[0] ?? "",
    enabled: true,
    preset: preset.id,
    website: preset.website,
    fullUrl: false,
    testConfig: normalizeTestConfig(undefined, globalTest),
  };
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
        className={`toggle ${checked ? "toggle--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" />
      </button>
    </label>
  );
}

export function ProviderFormPage({
  mode,
  presets,
  profile,
  globalTest,
  onBack,
  onSave,
}: ProviderFormPageProps) {
  const effectiveGlobal = useMemo(
    () => normalizeTestConfig(globalTest),
    [globalTest],
  );
  const defaultPreset = presets.find((p) => p.id === "volcengine-doubao") ?? presets[0];
  const [selectedPresetId, setSelectedPresetId] = useState(
    profile?.preset ?? defaultPreset?.id ?? "custom",
  );
  const [form, setForm] = useState<ProviderProfile>(() => {
    const base =
      profile ??
      emptyProfile(
        defaultPreset ?? {
          id: "custom",
          name: "自定义",
          baseUrl: "",
          protocol: "openai-compatible",
        },
        globalTest,
      );
    return {
      ...base,
      testConfig: normalizeTestConfig(base.testConfig, effectiveGlobal),
    };
  });
  const [saving, setSaving] = useState(false);
  const [testConfigOpen, setTestConfigOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const selectedPreset = useMemo(
    () => presets.find((p) => p.id === selectedPresetId),
    [presets, selectedPresetId],
  );

  const testValues = normalizeTestConfig(form.testConfig, effectiveGlobal);

  useEffect(() => {
    if (profile) {
      setForm({
        ...profile,
        testConfig: normalizeTestConfig(profile.testConfig, effectiveGlobal),
      });
      setSelectedPresetId(profile.preset ?? "custom");
    }
  }, [profile, effectiveGlobal]);

  function patch(partial: Partial<ProviderProfile>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function patchTestConfig(partial: Partial<ProviderTestConfig>) {
    setForm((prev) => ({
      ...prev,
      testConfig: {
        ...normalizeTestConfig(prev.testConfig, effectiveGlobal),
        ...partial,
      },
    }));
  }

  function selectPreset(presetId: string) {
    if (mode === "edit") return;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(presetId);
    const base = emptyProfile(preset, globalTest);
    setForm((prev) => ({
      ...base,
      apiKey: prev.apiKey || base.apiKey,
      defaultModel: prev.defaultModel || base.defaultModel,
      models: prev.defaultModel ? [prev.defaultModel] : base.models,
      remarks: prev.remarks,
      testConfig: normalizeTestConfig(prev.testConfig, effectiveGlobal),
      name: preset.id === "custom" ? prev.name : preset.name,
    }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      alert("请填写供应商名称");
      return;
    }
    if (!form.baseUrl.trim()) {
      alert("请填写请求地址");
      return;
    }

    const model = form.defaultModel?.trim();
    const next: ProviderProfile = {
      ...form,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
      website: form.website?.trim() || undefined,
      remarks: form.remarks?.trim() || undefined,
      modelAlias: form.modelAlias?.trim() || undefined,
      defaultModel: model,
      models: model
        ? [model, ...form.models.filter((m) => m !== model)]
        : form.models,
      testConfig: normalizeTestConfig(form.testConfig, effectiveGlobal),
    };

    setSaving(true);
    try {
      await onSave(next);
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
        <h1>{mode === "add" ? "添加新供应商" : "编辑供应商"}</h1>
      </header>

      <div className="form-page__body">
        {mode === "add" && (
          <section className="form-section form-section--card">
            <div className="preset-grid">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`preset-card ${selectedPresetId === p.id ? "preset-card--selected" : ""}`}
                  onClick={() => selectPreset(p.id)}
                >
                  {p.featured && <span className="preset-card__star">★</span>}
                  <ProviderIcon preset={p.id} name={p.name} />
                  <span className="preset-card__name">{p.name}</span>
                  <span className="preset-card__url">{p.baseUrl || "自定义 URL"}</span>
                </button>
              ))}
            </div>
            <p className="form-hint">
              <span className="form-hint__icon">💡</span>
              自定义配置需手动填写所有必要字段
            </p>
          </section>
        )}

        <section className="form-section form-section--card">
          <div className="form-hero">
            <ProviderIcon preset={form.preset} name={form.name || "?"} />
          </div>

          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">供应商名称</span>
              <input
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="例如：火山豆包"
              />
            </label>
            <label className="field">
              <span className="field__label">备注</span>
              <input
                value={form.remarks ?? ""}
                onChange={(e) => patch({ remarks: e.target.value })}
                placeholder="例如：公司专用账号"
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">官网链接</span>
            <input
              value={form.website ?? ""}
              onChange={(e) => patch({ website: e.target.value })}
              placeholder="https://example.com（可选）"
            />
          </label>

          <label className="field">
            <span className="field__label">API Key</span>
            <div className="field__password">
              <input
                type={showApiKey ? "text" : "password"}
                value={form.apiKey ?? ""}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder={
                  selectedPreset?.apiKeyEnv
                    ? `环境变量 ${selectedPreset.apiKeyEnv} 或在此填写`
                    : "sk-..."
                }
                autoComplete="off"
              />
              <button
                type="button"
                className="field__eye"
                onClick={() => setShowApiKey((v) => !v)}
                title={showApiKey ? "隐藏" : "显示明文"}
                aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showApiKey ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </label>

          <label className="field">
            <div className="field__row">
              <span className="field__label">请求地址</span>
              <div className="field__extras">
                <Toggle
                  label="完整 URL"
                  checked={form.fullUrl ?? false}
                  onChange={(v) => patch({ fullUrl: v })}
                />
              </div>
            </div>
            <input
              value={form.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="https://your-api-endpoint.com"
            />
            <div className="tip-box">
              填写兼容 OpenAI API 的服务端点地址。不要以斜杠结尾
              {form.fullUrl ? "（完整 URL 模式：直接填写 chat/completions 地址）" : ""}
            </div>
          </label>

          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">模型名称</span>
              <input
                value={form.modelAlias ?? ""}
                onChange={(e) => patch({ modelAlias: e.target.value })}
                placeholder="例如：deepseek-v4-pro（仅展示）"
              />
              <span className="field__help">仅供页面展示，留空则显示接入点 ID</span>
            </label>
            <label className="field">
              <span className="field__label">接入点 ID</span>
              <input
                value={form.defaultModel ?? ""}
                onChange={(e) => patch({ defaultModel: e.target.value })}
                placeholder={selectedPreset?.exampleModels?.[0] ?? "ep-xxx 或 gpt-4o"}
              />
              <span className="field__help">实际请求 API 时使用的模型 ID</span>
            </label>
          </div>
        </section>

        <section className="form-section form-section--card config-card">
          <button
            type="button"
            className="config-card__toggle"
            onClick={() => setTestConfigOpen((o) => !o)}
            aria-expanded={testConfigOpen}
          >
            <span className="config-card__icon">🧪</span>
            <div className="config-card__toggle-body">
              <h3>模型测试配置</h3>
              <p>
                {testConfigOpen
                  ? "连接测试时使用的参数，可按供应商单独调整。"
                  : `默认：超时 ${testValues.timeoutSec}s · 提示词「${testValues.testPrompt}」· 重试 ${testValues.maxRetries} 次`}
              </p>
            </div>
            <span className="config-card__arrow">{testConfigOpen ? "▲" : "▼"}</span>
          </button>

          {testConfigOpen && (
            <div className="form-grid form-grid--2 config-card__body">
              <label className="field">
                <span className="field__label">测试模型</span>
                <input
                  value={testValues.testModel ?? ""}
                  onChange={(e) => patchTestConfig({ testModel: e.target.value })}
                  placeholder="留空使用上方接入点 ID"
                />
              </label>
              <label className="field">
                <span className="field__label">超时时间（秒）</span>
                <input
                  type="number"
                  min={5}
                  value={testValues.timeoutSec ?? DEFAULT_TEST_CONFIG.timeoutSec}
                  onChange={(e) =>
                    patchTestConfig({ timeoutSec: Number(e.target.value) || 45 })
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">测试提示词</span>
                <input
                  value={testValues.testPrompt ?? DEFAULT_TEST_CONFIG.testPrompt}
                  onChange={(e) => patchTestConfig({ testPrompt: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">降级阈值（毫秒）</span>
                <input
                  type="number"
                  min={0}
                  value={
                    testValues.downgradeThresholdMs ??
                    DEFAULT_TEST_CONFIG.downgradeThresholdMs
                  }
                  onChange={(e) =>
                    patchTestConfig({
                      downgradeThresholdMs: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">最大重试次数</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={testValues.maxRetries ?? DEFAULT_TEST_CONFIG.maxRetries}
                  onChange={(e) =>
                    patchTestConfig({ maxRetries: Number(e.target.value) || 0 })
                  }
                />
              </label>
            </div>
          )}
        </section>
      </div>

      <footer className="form-page__footer">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          取消
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void handleSubmit()}
          disabled={saving}
        >
          {saving ? "保存中…" : mode === "add" ? "+ 添加" : "保存"}
        </button>
      </footer>
    </div>
  );
}
