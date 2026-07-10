export type SettingsSegmentTone = "allow" | "review" | "deny" | "info" | "elevated";

export interface SettingsSegmentOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  tone: SettingsSegmentTone;
}

const TONE_CLASS: Record<SettingsSegmentTone, string> = {
  allow: "never",
  review: "onRequest",
  deny: "deny",
  info: "readOnly",
  elevated: "fullAccess",
};

interface SettingsSegmentFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: SettingsSegmentOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function SettingsSegmentField<T extends string>({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: SettingsSegmentFieldProps<T>) {
  return (
    <div className="mcp-approval-segment-field settings-segment-field">
      <div className="mcp-approval-segment-field__label" id={`${id}-label`}>
        {label}
      </div>
      <div
        className="mcp-approval-segment settings-segment"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
      >
        {options.map((opt) => {
          const active = value === opt.value;
          const toneClass = TONE_CLASS[opt.tone];
          return (
            <button
              key={opt.value}
              type="button"
              id={`${id}-${opt.value}`}
              className={[
                "mcp-approval-segment__btn",
                `mcp-approval-segment__btn--${toneClass}`,
                active ? "mcp-approval-segment__btn--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="radio"
              aria-checked={active}
              title={opt.hint}
              disabled={disabled}
              onClick={() => {
                if (!disabled) onChange(opt.value);
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
