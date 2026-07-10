import { useEffect, useState } from "react";
import type {
  InstalledSkillRecord,
  SkillHubAnalyzeRepoResult,
  SkillHubSearchHit,
  SkillSource,
} from "@kako/shared";
import { api } from "../api";
import { InstallProgressButton } from "./InstallProgressButton";
import { SkillZipUpload } from "./SkillZipUpload";
import { SkillsBuildChat } from "./SkillsBuildChat";

type AddTab = "hub" | "github" | "archive" | "build";

const SOURCE_LABELS: Record<SkillSource, string> = {
  skillhub: "SkillHub",
  github: "GitHub",
  archive: "压缩包",
  local: "在线构建",
  builtin: "内置",
  global: "全局",
  project: "项目",
};

function formatTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatInstallCount(count?: number): string | null {
  if (count == null || count <= 0) return null;
  return `${count.toLocaleString()} 次安装`;
}

function SkillHubHitRow({
  hit,
  installed,
  installing,
  onInstall,
}: {
  hit: SkillHubSearchHit;
  installed: InstalledSkillRecord[];
  installing: boolean;
  onInstall: (hit: SkillHubSearchHit) => void;
}) {
  const installSlug = hit.installSlug ?? hit.slug;
  const done = isInstalled(installed, hit);
  const installLabel = formatInstallCount(hit.totalInstalls);

  return (
    <li className="provider-row">
      <div className="provider-row__main">
        <div className="provider-row__title">
          <span className="provider-row__name">{hit.name}</span>
          <span className="tag tag--muted">{installSlug}</span>
          {installLabel && <span className="tag tag--muted">{installLabel}</span>}
        </div>
        <div className="skill-hit-desc" title={hit.description}>
          {hit.description}
        </div>
      </div>
      {done ? (
        <span className="skill-action-btn skill-action-btn--installed">已安装</span>
      ) : (
        <InstallProgressButton installing={installing} onClick={() => onInstall(hit)} />
      )}
    </li>
  );
}

function isGithubSkillInstalled(
  installed: InstalledSkillRecord[],
  skillName: string,
  repoFullName: string,
): boolean {
  return installed.some((s) => {
    if (s.name === skillName) return true;
    if (!s.slug) return false;
    return s.slug === `${repoFullName}/${skillName}` || s.slug.endsWith(`/${skillName}`);
  });
}

function getInstallableGithubSkills(
  analysis: SkillHubAnalyzeRepoResult,
  installed: InstalledSkillRecord[],
) {
  return analysis.skills.filter(
    (skill) => !isGithubSkillInstalled(installed, skill.name, analysis.repoFullName),
  );
}

function defaultSelectedGithubPaths(
  analysis: SkillHubAnalyzeRepoResult,
  installed: InstalledSkillRecord[],
): Set<string> {
  return new Set(getInstallableGithubSkills(analysis, installed).map((skill) => skill.path));
}

function filterSelectedGithubPaths(
  analysis: SkillHubAnalyzeRepoResult,
  installed: InstalledSkillRecord[],
  selected: Set<string>,
): Set<string> {
  const installablePaths = new Set(
    getInstallableGithubSkills(analysis, installed).map((skill) => skill.path),
  );
  return new Set([...selected].filter((path) => installablePaths.has(path)));
}

function isInstalled(installed: InstalledSkillRecord[], hit: SkillHubSearchHit): boolean {
  const installSlug = hit.installSlug ?? hit.slug;
  return installed.some(
    (s) =>
      s.slug === installSlug ||
      s.slug === hit.slug ||
      s.name === hit.name ||
      s.name === installSlug.split("/").pop(),
  );
}

interface SkillsAddPageProps {
  installed: InstalledSkillRecord[];
  onBack: () => void;
  onInstalled: (skills: InstalledSkillRecord[]) => void;
}

export function SkillsAddPage({ installed, onBack, onInstalled }: SkillsAddPageProps) {
  const [tab, setTab] = useState<AddTab>("hub");
  const [error, setError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [installingKey, setInstallingKey] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SkillHubSearchHit[]>([]);
  const [popularHits, setPopularHits] = useState<SkillHubSearchHit[]>([]);
  const [popularLoading, setPopularLoading] = useState(false);
  const [popularError, setPopularError] = useState<string | null>(null);
  const [popularReloadKey, setPopularReloadKey] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);

  const [githubUrl, setGithubUrl] = useState("");
  const [repoAnalysis, setRepoAnalysis] = useState<SkillHubAnalyzeRepoResult | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [githubInstallSuccess, setGithubInstallSuccess] = useState<string[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "hub") return;
    let cancelled = false;
    setPopularLoading(true);
    setPopularError(null);
    void api
      .getPopularSkills(10)
      .then(({ skills }) => {
        if (!cancelled) setPopularHits(skills);
      })
      .catch((e) => {
        if (!cancelled) {
          setPopularHits([]);
          setPopularError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setPopularLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, popularReloadKey]);

  useEffect(() => {
    if (query.trim() === "") {
      setHasSearched(false);
      setSearchHits([]);
    }
  }, [query]);

  useEffect(() => {
    if (!repoAnalysis) return;
    setSelectedPaths((prev) => filterSelectedGithubPaths(repoAnalysis, installed, prev));
  }, [installed, repoAnalysis]);

  async function handleSearch() {
    if (query.trim().length < 2) return;
    setSearchLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const { skills } = await api.searchSkills(query.trim());
      setSearchHits(skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleInstallHit(hit: SkillHubSearchHit) {
    const installSlug = hit.installSlug ?? hit.slug;
    setInstallingKey(installSlug);
    setError(null);
    try {
      const { skills } = await api.installSkill({
        slug: installSlug,
        sourceIdentifier: hit.sourceIdentifier,
        ownerUsername: hit.ownerUsername,
        totalInstalls: hit.totalInstalls,
      });
      onInstalled(skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingKey(null);
    }
  }

  async function handleGithubImport() {
    if (!githubUrl.trim() || !repoAnalysis) return;
    const paths = filterSelectedGithubPaths(repoAnalysis, installed, selectedPaths);
    if (paths.size === 0) return;
    setInstallingKey("github-import");
    setError(null);
    setSuccessMessage(null);
    try {
      const { skills, installed: justInstalled } = await api.installSkill({
        githubUrl: githubUrl.trim(),
        paths: [...paths],
      });
      onInstalled(skills);
      const names = (justInstalled ?? []).map((s) => s.name);
      if (names.length > 0) {
        setGithubInstallSuccess(names);
        setSuccessMessage(`已成功安装 ${names.length} 个技能`);
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          for (const record of justInstalled ?? []) {
            const skill = repoAnalysis.skills.find((s) => s.name === record.name);
            if (skill) next.delete(skill.path);
          }
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingKey(null);
    }
  }

  function resetGithubImport() {
    setRepoAnalysis(null);
    setGithubUrl("");
    setSelectedPaths(new Set());
    setGithubInstallSuccess(null);
    setSuccessMessage(null);
    setError(null);
  }

  async function handleZipImport() {
    if (!zipFile) return;
    setInstallingKey("zip-import");
    setError(null);
    try {
      const { skills } = await api.installSkillZip(zipFile);
      onInstalled(skills);
      setZipFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingKey(null);
    }
  }

  return (
    <div className="form-page">
      <header className="form-page__header">
        <button type="button" className="icon-btn form-page__back" onClick={onBack}>
          ←
        </button>
        <h1>添加技能</h1>
      </header>

      {error && <div className="banner banner--error">{error}</div>}
      {successMessage && <div className="banner banner--success">{successMessage}</div>}

      <div className="form-page__body skills-add-page__body">
        <div className="skills-add-tabs" role="tablist" aria-label="添加方式">
          {(
            [
              ["hub", "SkillHub"],
              ["github", "GitHub"],
              ["archive", "压缩包"],
              ["build", "在线构建"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`skills-add-tabs__tab ${tab === id ? "skills-add-tabs__tab--active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "hub" && (
        <section className="skills-add-section">
          <p className="skills-add-hint">搜索 SkillHub 生态技能并安装。已安装的技能会显示「已安装」。</p>
          <div className="skills-search">
            <input
              className="input"
              placeholder="搜索技能（至少 2 个字符）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={query.trim().length < 2 || searchLoading}
              onClick={() => void handleSearch()}
            >
              {searchLoading ? "搜索中…" : "搜索"}
            </button>
          </div>
          {(() => {
            const displayHits = hasSearched ? searchHits : popularHits;
            const listTitle = hasSearched
              ? searchHits.length > 0
                ? "搜索结果"
                : "未找到匹配技能"
              : "热门技能";
            if (!hasSearched && popularLoading && displayHits.length === 0) {
              return <p className="skills-add-hint">加载热门技能…</p>;
            }
            if (!hasSearched && popularError && displayHits.length === 0) {
              return (
                <div className="skills-add-popular-empty">
                  <p className="skills-add-hint">{popularError}</p>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => setPopularReloadKey((n) => n + 1)}
                  >
                    重试
                  </button>
                </div>
              );
            }
            if (displayHits.length === 0) {
              return hasSearched ? (
                <p className="skills-add-hint">换个关键词试试，或浏览热门技能（清空搜索框）。</p>
              ) : (
                <p className="skills-add-hint">暂无热门技能，请稍后再试或使用搜索。</p>
              );
            }
            return (
              <>
                <h3 className="skills-add-list-title">{listTitle}</h3>
                <ul className="provider-list">
                  {displayHits.map((hit) => {
                    const installSlug = hit.installSlug ?? hit.slug;
                    return (
                      <SkillHubHitRow
                        key={`${installSlug}:${hit.slug}`}
                        hit={hit}
                        installed={installed}
                        installing={installingKey === installSlug}
                        onInstall={(h) => void handleInstallHit(h)}
                      />
                    );
                  })}
                </ul>
              </>
            );
          })()}
        </section>
      )}

      {tab === "github" && (
        <section className="skills-add-section">
          <p className="skills-add-hint">输入 GitHub 仓库 URL，分析后选择要导入的技能。</p>
          <div className="skills-search">
            <input
              className="input"
              placeholder="https://github.com/owner/repo"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--secondary"
              disabled={!githubUrl.trim() || analyzeLoading}
              onClick={() => {
                void (async () => {
                  setAnalyzeLoading(true);
                  setError(null);
                  setSuccessMessage(null);
                  setGithubInstallSuccess(null);
                  try {
                    const result = await api.analyzeSkillRepo(githubUrl.trim());
                    setRepoAnalysis(result);
                    setSelectedPaths(defaultSelectedGithubPaths(result, installed));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setAnalyzeLoading(false);
                  }
                })();
              }}
            >
              {analyzeLoading ? "分析中…" : "分析"}
            </button>
          </div>
          {repoAnalysis && (() => {
            const installableSkills = getInstallableGithubSkills(repoAnalysis, installed);
            const selectedInstallableCount = installableSkills.filter((skill) =>
              selectedPaths.has(skill.path),
            ).length;

            return (
            <div className="skills-import">
              <div className="skills-import__header">
                <div className="skills-import__repo">
                  <span className="skills-import__repo-name">{repoAnalysis.repoFullName}</span>
                  {repoAnalysis.defaultBranch && (
                    <span className="tag tag--muted">{repoAnalysis.defaultBranch}</span>
                  )}
                </div>
                <p className="skills-import__subtitle">
                  共 {repoAnalysis.skills.length} 个技能，可安装 {installableSkills.length} 个
                </p>
                {githubInstallSuccess && (
                  <div className="skills-import__success">
                    <strong>安装完成</strong>
                    已成功安装 {githubInstallSuccess.length} 个技能：
                    {githubInstallSuccess.join("、")}
                  </div>
                )}
              </div>
              <div className="skills-import__toolbar">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={installableSkills.length === 0}
                  onClick={() =>
                    setSelectedPaths(defaultSelectedGithubPaths(repoAnalysis, installed))
                  }
                >
                  全选
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSelectedPaths(new Set())}
                >
                  取消全选
                </button>
                <span className="skills-import__count">
                  已选 {selectedInstallableCount} / {installableSkills.length}
                </span>
              </div>
              <div className="skills-import__table-wrap">
                <table className="skills-import-table">
                  <thead>
                    <tr>
                      <th className="skills-import-table__col-check" aria-label="选择" />
                      <th className="skills-import-table__col-name">技能名称</th>
                      <th className="skills-import-table__col-desc">描述</th>
                      <th className="skills-import-table__status">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repoAnalysis.skills.map((skill) => {
                      const done = isGithubSkillInstalled(
                        installed,
                        skill.name,
                        repoAnalysis.repoFullName,
                      );
                      const checked = !done && selectedPaths.has(skill.path);
                      return (
                        <tr
                          key={skill.path}
                          className={`skills-import-table__row${
                            done
                              ? " skills-import-table__row--installed"
                              : checked
                                ? ""
                                : " skills-import-table__row--unchecked"
                          }`}
                          onClick={() => {
                            if (done) return;
                            const next = new Set(selectedPaths);
                            if (checked) next.delete(skill.path);
                            else next.add(skill.path);
                            setSelectedPaths(next);
                          }}
                        >
                          <td className="skills-import-table__col-check">
                            {done ? (
                              <span className="skills-import-table__check-placeholder" aria-hidden />
                            ) : (
                              <input
                                type="checkbox"
                                checked={checked}
                                aria-label={`选择 ${skill.name}`}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const next = new Set(selectedPaths);
                                  if (e.target.checked) next.add(skill.path);
                                  else next.delete(skill.path);
                                  setSelectedPaths(next);
                                }}
                              />
                            )}
                          </td>
                          <td className="skills-import-table__col-name">
                            <span className="skills-import-table__name">{skill.name}</span>
                          </td>
                          <td className="skills-import-table__col-desc">
                            <span className="skills-import-table__desc" title={skill.description}>
                              {skill.description}
                            </span>
                          </td>
                          <td className="skills-import-table__status">
                            {done ? (
                              <span className="tag tag--active">已安装</span>
                            ) : (
                              <span className="tag tag--muted">未安装</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="skills-import__footer">
                {githubInstallSuccess && (
                  <button
                    type="button"
                    className="btn btn--ghost skills-import__footer-reset"
                    onClick={resetGithubImport}
                  >
                    导入其他仓库
                  </button>
                )}
                <InstallProgressButton
                  variant="primary"
                  label="导入并安装"
                  installing={installingKey === "github-import"}
                  disabled={selectedInstallableCount === 0}
                  onClick={() => void handleGithubImport()}
                />
              </div>
            </div>
            );
          })()}
        </section>
      )}

      {tab === "archive" && (
        <section className="skills-add-section">
          <p className="skills-add-hint">
            上传 .zip 压缩包（内含 SKILL.md）。适用于无法访问 SkillHub 时离线安装。
          </p>
          <SkillZipUpload
            file={zipFile}
            installing={installingKey === "zip-import"}
            error={zipError}
            onFileChange={setZipFile}
            onError={setZipError}
            onImport={() => void handleZipImport()}
          />
        </section>
      )}

      {tab === "build" ? (
        <section className="skills-add-section">
          <SkillsBuildChat
            key="skills-build"
            onInstalled={onInstalled}
            onError={setError}
            onSuccess={setSuccessMessage}
          />
        </section>
      ) : null}
      </div>
    </div>
  );
}

export { SOURCE_LABELS, formatTime, formatInstallCount };
