import { useEffect, useRef, useState } from "react";
import type { McpApprovalMode, McpServerConfig } from "@kako/shared";
import { IconChevronDown } from "./RowIcons";

export type McpApprovalSelectValue = McpApprovalMode | "";

export const MCP_SERVER_APPROVAL_OPTIONS: Array<{
  value: McpApprovalMode;
  label: string;
  hint: string;
}> = [
  { value: "never", label: "无需审批", hint: "直接执行，不弹出审批" },
  { value: "onRequest", label: "需要审批", hint: "执行前弹出审批（默认）" },
  { value: "deny", label: "拒绝执行", hint: "一律拒绝调用" },
];

export const MCP_TOOL_APPROVAL_OPTIONS: Array<{
  value: McpApprovalSelectValue;
  label: string;
}> = [
  { value: "", label: "跟随服务默认" },
  { value: "never", label: "无需审批，直接执行" },
  { value: "onRequest", label: "需要审批" },
  { value: "deny", label: "拒绝执行" },
];

export function patchMcpServerApproval(
  server: McpServerConfig,
  patch: {
    approvalMode?: McpApprovalMode | null;
    toolName?: string;
    toolMode?: McpApprovalMode | null;
  },
): McpServerConfig {
  const next: McpServerConfig = {
    ...server,
    toolApproval: server.toolApproval ? { ...server.toolApproval } : undefined,
  };

  if (patch.approvalMode === null) {
    delete next.approvalMode;
  } else if (patch.approvalMode) {
    next.approvalMode = patch.approvalMode;
  }

  if (patch.toolName) {
    const map = { ...(next.toolApproval ?? {}) };
    if (patch.toolMode === null || patch.toolMode === undefined) {
      delete map[patch.toolName];
    } else {
      map[patch.toolName] = patch.toolMode;
    }
    // Always send the full map so upsert can clear removed tool overrides.
    next.toolApproval = map;
  }

  return next;
}

function resolveServerApprovalMode(server: McpServerConfig): McpApprovalMode {
  return server.approvalMode ?? "onRequest";
}

interface McpApprovalServerSegmentProps {
  id: string;
  label: string;
  value: McpApprovalMode;
  disabled?: boolean;
  onChange: (value: McpApprovalMode) => void;
}

export function McpApprovalServerSegment({
  id,
  label,
  value,
  disabled,
  onChange,
}: McpApprovalServerSegmentProps) {
  return (
    <div className="mcp-approval-segment-field">
      <div className="mcp-approval-segment-field__label" id={`${id}-label`}>
        {label}
      </div>
      <div className="mcp-approval-segment" role="radiogroup" aria-labelledby={`${id}-label`}>
        {MCP_SERVER_APPROVAL_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              id={`${id}-${opt.value}`}
              className={[
                "mcp-approval-segment__btn",
                `mcp-approval-segment__btn--${opt.value}`,
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

function approvalSelectTone(
  value: McpApprovalSelectValue,
): "inherit" | "allow" | "review" | "deny" {
  if (value === "deny") return "deny";
  if (value === "onRequest") return "review";
  if (value === "never") return "allow";
  return "inherit";
}

interface McpToolApprovalSelectProps {
  id: string;
  value: McpApprovalSelectValue;
  disabled?: boolean;
  onChange: (value: McpApprovalSelectValue) => void;
}

export function McpToolApprovalSelect({
  id,
  value,
  disabled,
  onChange,
}: McpToolApprovalSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected =
    MCP_TOOL_APPROVAL_OPTIONS.find((opt) => opt.value === value) ??
    MCP_TOOL_APPROVAL_OPTIONS[0];
  const tone = approvalSelectTone(value);

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
        "mcp-approval-menu",
        open ? "mcp-approval-menu--open" : "",
        disabled ? "mcp-approval-menu--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        id={id}
        type="button"
        className={`mcp-approval-menu__trigger mcp-approval-menu__trigger--${tone}`}
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
          {MCP_TOOL_APPROVAL_OPTIONS.map((opt) => {
            const optionTone = approvalSelectTone(opt.value);
            const active = value === opt.value;
            return (
              <li key={opt.value || "inherit"} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={[
                    "mcp-approval-menu__option",
                    `mcp-approval-menu__option--${optionTone}`,
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

interface McpApprovalAdvancedProps {
  server: McpServerConfig;
  serverTools: Array<{ name: string }>;
  disabled?: boolean;
  onChange: (server: McpServerConfig) => void;
}

export function McpApprovalAdvanced({
  server,
  serverTools,
  disabled,
  onChange,
}: McpApprovalAdvancedProps) {
  const serverMode = resolveServerApprovalMode(server);

  return (
    <div className="mcp-approval-advanced">
      <McpApprovalServerSegment
        id={`mcp-approval-server-${server.id}`}
        label="本服务默认"
        value={serverMode}
        disabled={disabled}
        onChange={(mode) =>
          onChange(patchMcpServerApproval(server, { approvalMode: mode }))
        }
      />
      {serverTools.length > 0 && (
        <div className="mcp-approval-tools">
          <div className="mcp-approval-tools__title">单工具覆盖（优先于服务默认）</div>
          <ul className="mcp-approval-tools__list">
            {serverTools.map((tool) => (
              <li key={tool.name} className="mcp-approval-tools__row">
                <span className="mcp-approval-tools__name" title={tool.name}>
                  {tool.name}
                </span>
                <McpToolApprovalSelect
                  id={`mcp-approval-${server.id}-${tool.name}`}
                  value={server.toolApproval?.[tool.name] ?? ""}
                  disabled={disabled}
                  onChange={(nextValue) =>
                    onChange(
                      patchMcpServerApproval(server, {
                        toolName: tool.name,
                        toolMode: nextValue === "" ? null : nextValue,
                      }),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
