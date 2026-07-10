import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "./RowIcons";

export type SettingsSelectTone = "allow" | "review" | "deny" | "info" | "elevated";

export interface SettingsSelectOption<T extends string> {
  value: T;
  label: string;
  tone: SettingsSelectTone;
}

interface SettingsColoredSelectProps<T extends string> {
  id: string;
  value: T;
  options: SettingsSelectOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function SettingsColoredSelect<T extends string>({
  id,
  value,
  options,
  disabled,
  onChange,
}: SettingsColoredSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((opt) => opt.value === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={[
        "mcp-approval-menu settings-colored-select",
        open ? "mcp-approval-menu--open" : "",
        disabled ? "mcp-approval-menu--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        id={id}
        type="button"
        className={`mcp-approval-menu__trigger mcp-approval-menu__trigger--${selected.tone}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
      >
        <span className="mcp-approval-menu__trigger-label">{selected.label}</span>
        <IconChevronDown className="mcp-approval-menu__chevron" />
      </button>
      {open && (
        <ul className="mcp-approval-menu__list" role="listbox" aria-labelledby={id}>
          {options.map((opt) => {
            const active = value === opt.value;
            return (
              <li key={opt.value} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={[
                    "mcp-approval-menu__option",
                    `mcp-approval-menu__option--${opt.tone}`,
                    active ? "mcp-approval-menu__option--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
