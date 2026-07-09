import { useEffect, useState } from "react";
import type { InstalledSkillRecord, SkillDefinition } from "@kako/shared";
import { api } from "../api";
import { IconChevronDown, IconSpinner, IconTrash } from "./RowIcons";
import { SOURCE_LABELS, formatInstallCount, formatTime } from "./SkillsAddPage";

function EnableToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="toggle-row" title={enabled ? "已启用" : "已停用"}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className={`toggle ${enabled ? "toggle--on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!enabled);
        }}
      >
        <span className="toggle__knob" />
      </button>
    </label>
  );
}

interface SkillCardProps {
  skill: InstalledSkillRecord;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onOpenDir: () => void;
  onRemove: () => void;
}

export function SkillCard({
  skill,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onOpenDir,
  onRemove,
}: SkillCardProps) {
  const [hovered, setHovered] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [definition, setDefinition] = useState<SkillDefinition | null>(null);

  const enabled = skill.enabled !== false;
  const installCountLabel = formatInstallCount(skill.totalInstalls);
  const showActions = hovered || expanded;

  useEffect(() => {
    if (!expanded) return;
    if (definition) return;

    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    void api
      .getSkillDetail(skill.name)
      .then((result) => {
        if (!cancelled) setDefinition(result.definition);
      })
      .catch((e) => {
        if (!cancelled) {
          setDetailError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, skill.name, definition]);

  return (
    <li
      className={`skills-card ${!enabled ? "skills-card--disabled" : ""} ${expanded ? "skills-card--expanded" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="skills-card__row">
        <button type="button" className="skills-card__main" onClick={onToggleExpand}>
          <div className="provider-icon skills-card__icon">{skill.name.slice(0, 2).toUpperCase()}</div>
          <div className="skills-card__body">
            <div className="skills-card__header">
              <span className="skills-card__name">{skill.name}</span>
              <span className="tag tag--muted">{SOURCE_LABELS[skill.source] ?? skill.source}</span>
              {skill.version && <span className="tag tag--muted">v{skill.version}</span>}
              {!enabled && <span className="tag tag--warn">已停用</span>}
            </div>
            <p className="skills-card__desc" title={skill.description || undefined}>
              {skill.description || "（无描述）"}
            </p>
          </div>
        </button>

        <div className={`skills-card__actions ${showActions ? "visible" : ""}`}>
          <EnableToggle enabled={enabled} onChange={onToggleEnabled} />
          <button
            type="button"
            className="icon-btn"
            title="卸载"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <IconTrash />
          </button>
          <button
            type="button"
            className={`skills-card__chevron ${expanded ? "skills-card__chevron--open" : ""}`}
            title={expanded ? "收起详情" : "查看详情"}
            aria-label={expanded ? "收起详情" : "查看详情"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            <IconChevronDown />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="skills-card__detail">
          <div className="skills-card__meta">
            {skill.slug && <span>Slug: {skill.slug}</span>}
            {(skill.source === "skillhub" || skill.source === "github") &&
              installCountLabel && <span>{installCountLabel}</span>}
            <span>安装于 {formatTime(skill.installedAt)}</span>
          </div>
          <button
            type="button"
            className="skills-card__path skills-card__path--link"
            title={`打开目录：${skill.installDir || skill.skillMdPath}`}
            onClick={onOpenDir}
          >
            {skill.skillMdPath}
          </button>

          {loadingDetail && (
            <div className="skills-card__detail-loading">
              <IconSpinner className="icon-btn__spinner" />
              加载 SKILL.md…
            </div>
          )}
          {detailError && <div className="banner banner--error">{detailError}</div>}
          {definition && (
            <div className="skills-card__markdown">
              <div className="skills-card__markdown-head">
                <strong>SKILL.md</strong>
                {definition.description && (
                  <span className="skills-card__markdown-desc">{definition.description}</span>
                )}
              </div>
              <pre className="skills-card__markdown-body">{definition.instructions}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
