import { useEffect, useState } from "react";
import type { ProviderPreset, ProviderProfile } from "@kako/shared";
import { ProviderIcon } from "./ProviderIcon";

interface EditProviderModalProps {
  profile: ProviderProfile | null;
  presets: ProviderPreset[];
  onClose: () => void;
  onSave: (profile: ProviderProfile) => Promise<void>;
}

export function EditProviderModal({
  profile,
  presets,
  onClose,
  onSave,
}: EditProviderModalProps) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setBaseUrl(profile.baseUrl);
      setApiKey(profile.apiKey ?? "");
      setModel(profile.defaultModel ?? profile.models[0] ?? "");
    }
  }, [profile]);

  if (!profile) return null;

  const current = profile;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        ...current,
        name,
        baseUrl,
        apiKey,
        defaultModel: model,
        models: model
          ? [model, ...current.models.filter((m) => m !== model)]
          : current.models,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <ProviderIcon preset={profile.preset} name={profile.name} />
          <h2>编辑供应商</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          <label>
            名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </label>
          <label>
            模型 / 接入点 ID
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="ep-xxx 或 gpt-4o"
            />
          </label>

          {profile.preset && (
            <p className="modal__hint">
              {presets.find((p) => p.id === profile.preset)?.description}
            </p>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AddProviderModalProps {
  open: boolean;
  presets: ProviderPreset[];
  onClose: () => void;
  onAdd: (presetId: string, data: { apiKey?: string; defaultModel?: string }) => Promise<void>;
}

export function AddProviderModal({ open, presets, onClose, onAdd }: AddProviderModalProps) {
  const [selected, setSelected] = useState("volcengine-doubao");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [adding, setAdding] = useState(false);

  if (!open) return null;

  const preset = presets.find((p) => p.id === selected);

  async function handleAdd() {
    setAdding(true);
    try {
      await onAdd(selected, { apiKey, defaultModel: model });
      onClose();
      setApiKey("");
      setModel("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>添加模型供应商</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body">
          <div className="preset-grid">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset-card ${selected === p.id ? "preset-card--selected" : ""}`}
                onClick={() => setSelected(p.id)}
              >
                <ProviderIcon preset={p.id} name={p.name} />
                <span className="preset-card__name">{p.name}</span>
                <span className="preset-card__url">{p.baseUrl || "自定义 URL"}</span>
              </button>
            ))}
          </div>

          <label>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={preset?.apiKeyEnv ? `环境变量 ${preset.apiKeyEnv}` : "sk-..."}
            />
          </label>
          <label>
            模型 / 接入点 ID
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={preset?.exampleModels?.[0] ?? "ep-xxx"}
            />
          </label>
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={() => void handleAdd()} disabled={adding}>
            {adding ? "添加中…" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}
