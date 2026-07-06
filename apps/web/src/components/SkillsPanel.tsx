import { useCallback, useEffect, useState } from "react";
import type { InstalledSkillRecord } from "@kako/shared";
import { api } from "../api";
import { IconTrash } from "./RowIcons";
import { SkillsAddPage, SOURCE_LABELS, formatTime, formatInstallCount } from "./SkillsAddPage";

type SkillsView = "manage" | "add";

function sortSkillsForDisplay(skills: InstalledSkillRecord[]): InstalledSkillRecord[] {
  return [...skills].sort((a, b) => {
    const aEnabled = a.enabled !== false ? 0 : 1;
    const bEnabled = b.enabled !== false ? 0 : 1;
    if (aEnabled !== bEnabled) return aEnabled - bEnabled;
    return a.name.localeCompare(b.name);
  });
}

function mergeSkillsPreservingOrder(
  prev: InstalledSkillRecord[],
  next: InstalledSkillRecord[],
): InstalledSkillRecord[] {
  const byName = new Map(next.map((skill) => [skill.name, skill]));
  return prev.filter((skill) => byName.has(skill.name)).map((skill) => byName.get(skill.name)!);
}

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
        onClick={() => onChange(!enabled)}
      >
        <span className="toggle__knob" />
      </button>
      <span>{enabled ? "已启用" : "已停用"}</span>
    </label>
  );
}

export function SkillsPanel() {
  const [view, setView] = useState<SkillsView>("manage");
  const [installed, setInstalled] = useState<InstalledSkillRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { skills } = await api.getSkills();
      setInstalled(sortSkillsForDisplay(skills));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleToggleEnabled(skill: InstalledSkillRecord) {
    const enabled = skill.enabled !== false;
    setError(null);
    try {
      const { skills } = await api.setSkillEnabled(skill.name, !enabled);
      setInstalled((prev) => mergeSkillsPreservingOrder(prev, skills));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemove(name: string) {
    if (!confirm(`卸载技能「${name}」？`)) return;
    setError(null);
    try {
      const { skills } = await api.removeSkill(name);
      setInstalled((prev) => mergeSkillsPreservingOrder(prev, skills));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpenDir(skill: InstalledSkillRecord) {
    const dir = skill.installDir || skill.skillMdPath.replace(/[/\\]SKILL\.md$/, "");
    if (
      !confirm(
        `在 Finder 中打开技能目录？\n\n${dir}`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.openSkillDir(dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (view === "add") {
    return (
      <SkillsAddPage
        installed={installed}
        onBack={() => setView("manage")}
        onInstalled={(skills) => setInstalled(sortSkillsForDisplay(skills))}
      />
    );
  }

  const enabledCount = installed.filter((s) => s.enabled !== false).length;
  const totalCount = installed.length;

  return (
    <section className="skills-panel">
      {error && <div className="banner banner--error">{error}</div>}

      <div className="skills-toolbar">
        <div className="skills-toolbar__left">
          <button type="button" className="btn btn--primary" onClick={() => setView("add")}>
            + 添加技能
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
        {totalCount > 0 && (
          <span className="skills-toolbar__stats">
            已启用 <strong>{enabledCount}</strong> / 共 <strong>{totalCount}</strong> 个技能
          </span>
        )}
      </div>

      {loading && installed.length === 0 && (
        <div className="banner banner--info">加载中…</div>
      )}

      {installed.length === 0 && !loading ? (
        <div className="empty-state">
          <p>还没有安装技能</p>
          <button type="button" className="btn btn--primary" onClick={() => setView("add")}>
            添加第一个技能
          </button>
        </div>
      ) : (
        <ul className="skills-list">
          {installed.map((skill) => {
            const enabled = skill.enabled !== false;
            const installCountLabel = formatInstallCount(skill.totalInstalls);
            return (
              <li
                key={skill.name}
                className={`skills-card ${!enabled ? "skills-card--disabled" : ""}`}
              >
                <div className="skills-card__main">
                  <div className="skills-card__header">
                    <span className="skills-card__name">{skill.name}</span>
                    <span className="tag tag--muted">{SOURCE_LABELS[skill.source] ?? skill.source}</span>
                    {skill.version && <span className="tag tag--muted">v{skill.version}</span>}
                  </div>
                  <p className="skills-card__desc" title={skill.description || undefined}>
                    {skill.description || "（无描述）"}
                  </p>
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
                    onClick={() => void handleOpenDir(skill)}
                  >
                    {skill.skillMdPath}
                  </button>
                </div>
                <div className="skills-card__actions">
                  <EnableToggle enabled={enabled} onChange={() => void handleToggleEnabled(skill)} />
                  <button
                    type="button"
                    className="icon-btn"
                    title="卸载"
                    onClick={() => void handleRemove(skill.name)}
                  >
                    <IconTrash />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
