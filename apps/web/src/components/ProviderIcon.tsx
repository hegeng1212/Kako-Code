import type { ProviderPreset } from "@kako/shared";

const PRESET_COLORS: Record<string, string> = {
  "volcengine-doubao": "#3370ff",
  openai: "#10a37f",
  openrouter: "#6366f1",
  deepseek: "#4d6bfe",
  moonshot: "#000000",
  zhipu: "#1a56db",
  siliconflow: "#7c3aed",
  dashscope: "#ff6a00",
  stepfun: "#0ea5e9",
  minimax: "#ec4899",
  ollama: "#ffffff",
  custom: "#64748b",
};

const PRESET_LABELS: Record<string, string> = {
  "volcengine-doubao": "豆",
  openai: "AI",
  openrouter: "OR",
  deepseek: "DS",
  moonshot: "Ki",
  zhipu: "智",
  siliconflow: "SF",
  dashscope: "百",
  stepfun: "阶",
  minimax: "MM",
  ollama: "Ol",
  custom: "C",
};

export function ProviderIcon({
  preset,
  name,
}: {
  preset?: string;
  name: string;
}) {
  const key = preset ?? "custom";
  const bg = PRESET_COLORS[key] ?? "#94a3b8";
  const label = PRESET_LABELS[key] ?? name.slice(0, 2).toUpperCase();
  const dark = key === "ollama";

  return (
    <div
      className="provider-icon"
      style={{
        background: bg,
        color: dark ? "#111" : "#fff",
        border: dark ? "1px solid #e2e8f0" : "none",
      }}
    >
      {label}
    </div>
  );
}

export function presetLabel(preset: ProviderPreset): string {
  return preset.name;
}
