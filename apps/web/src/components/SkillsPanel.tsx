import { useCallback, useEffect, useState } from "react";
import type { InstalledSkillRecord } from "@kako/shared";
import { api } from "../api";
import { IconPlus, IconRefresh } from "./RowIcons";
import { PanelToolbar, ToolbarButton } from "./PanelToolbar";
import { useConfirmDialog } from "./ConfirmDialog";
import { SkillCard } from "./SkillCard";
import { SkillsAddPage } from "./SkillsAddPage";

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

export function SkillsPanel() {
  const [view, setView] = useState<SkillsView>("manage");
  const [installed, setInstalled] = useState<InstalledSkillRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { requestConfirm, dialog: confirmDialog } = useConfirmDialog();

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
    const ok = await requestConfirm({
      title: "卸载技能",
      message: `确定卸载技能「${name}」？本地文件将被删除。`,
      confirmLabel: "卸载",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      const { skills } = await api.removeSkill(name);
      setInstalled((prev) => mergeSkillsPreservingOrder(prev, skills));
      if (expandedId === name) setExpandedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpenDir(skill: InstalledSkillRecord) {
    const dir = skill.installDir || skill.skillMdPath.replace(/[/\\]SKILL\.md$/, "");
    const ok = await requestConfirm({
      title: "打开技能目录",
      message: `在 Finder 中打开以下目录？\n\n${dir}`,
      confirmLabel: "打开",
    });
    if (!ok) return;
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

      <PanelToolbar
        badge={
          totalCount > 0 ? (
            <>
              已启用 <strong>{enabledCount}</strong> / 共 <strong>{totalCount}</strong> 个技能
            </>
          ) : (
            <>已配置 <strong>0</strong> 个技能</>
          )
        }
        actions={
          <>
            <ToolbarButton title="刷新" onClick={() => void refresh()} disabled={loading}>
              <IconRefresh className="btn__icon" />
              刷新
            </ToolbarButton>
            <ToolbarButton title="添加技能" onClick={() => setView("add")}>
              <IconPlus className="btn__icon" />
              添加技能
            </ToolbarButton>
          </>
        }
      />

      {loading && installed.length === 0 && (
        <div className="banner banner--info">加载中…</div>
      )}

      {installed.length === 0 && !loading ? (
        <div className="empty-state">
          <div className="empty-state__icon" aria-hidden="true">✦</div>
          <p>还没有安装技能</p>
          <span className="empty-state__hint">点击右上角「添加技能」安装第一个技能</span>
        </div>
      ) : (
        <ul className="skills-list">
          {installed.map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              expanded={expandedId === skill.name}
              onToggleExpand={() =>
                setExpandedId((cur) => (cur === skill.name ? null : skill.name))
              }
              onToggleEnabled={() => void handleToggleEnabled(skill)}
              onOpenDir={() => void handleOpenDir(skill)}
              onRemove={() => void handleRemove(skill.name)}
            />
          ))}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
