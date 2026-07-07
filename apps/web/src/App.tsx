import { useCallback, useEffect, useState } from "react";
import type {
  ProviderPreset,
  ProviderProfile,
  ProviderRegistry,
  ProviderTestResult,
} from "@kako/shared";
import { api } from "./api";
import { ProviderRow } from "./components/ProviderRow";
import { ProviderFormPage } from "./components/ProviderFormPage";
import { McpPanel } from "./components/McpPanel";
import { SkillsPanel } from "./components/SkillsPanel";

type Tab = "providers" | "mcp" | "skills";
type ProviderView = "list" | "add" | "edit";

export function App() {
  const [tab, setTab] = useState<Tab>("providers");
  const [providerView, setProviderView] = useState<ProviderView>("list");
  const [registry, setRegistry] = useState<ProviderRegistry | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProviderProfile | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reg, pre] = await Promise.all([
        api.getProviders(),
        api.getPresets(),
      ]);
      setRegistry(reg);
      setPresets(pre);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void api.getHealth().then((health) => setVersion(health.version)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!testResult) return;
    const timer = window.setTimeout(() => setTestResult(null), 3000);
    return () => window.clearTimeout(timer);
  }, [testResult]);

  const active = registry?.active;

  if (providerView === "add" || providerView === "edit") {
    return (
      <ProviderFormPage
        mode={providerView}
        presets={presets}
        profile={providerView === "edit" ? editing ?? undefined : undefined}
        globalTest={registry?.globalTest}
        onBack={() => {
          setProviderView("list");
          setEditing(null);
        }}
        onSave={async (profile) => {
          const reg = await api.saveProvider(profile);
          setRegistry(reg);
          if (profile.defaultModel) {
            await api.setActive(profile.id, profile.defaultModel);
            setRegistry(await api.getProviders());
          }
          setProviderView("list");
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__left">
          <span className="topbar__brand">Kako</span>
          {version && <span className="topbar__version">v{version}</span>}
          <button className="topbar__icon" title="刷新" onClick={() => void refresh()}>↻</button>
        </div>

        <nav className="topbar__tabs">
          <button
            className={`topbar__tab ${tab === "providers" ? "topbar__tab--active" : ""}`}
            onClick={() => setTab("providers")}
          >
            模型供应商
          </button>
          <button
            className={`topbar__tab ${tab === "mcp" ? "topbar__tab--active" : ""}`}
            onClick={() => setTab("mcp")}
          >
            MCP 服务
          </button>
          <button
            className={`topbar__tab ${tab === "skills" ? "topbar__tab--active" : ""}`}
            onClick={() => setTab("skills")}
          >
            Skills
          </button>
        </nav>

        <div className="topbar__right">
          {tab === "providers" && (
            <button
              className="fab"
              onClick={() => setProviderView("add")}
              title="添加供应商"
            >
              +
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {error && <div className="banner banner--error">{error}</div>}
        {loading && !registry && <div className="banner banner--info">加载中…</div>}

        {tab === "providers" && registry && (
          <>
            <ul className="provider-list">
              {registry.providers.map((p) => (
                <ProviderRow
                  key={p.id}
                  profile={p}
                  isActive={active?.providerId === p.id}
                  testing={testingProviderId === p.id}
                  activeModel={
                    active?.providerId === p.id ? active.model : p.defaultModel
                  }
                  onEnable={async (model) => {
                    const reg = await api.setActive(p.id, model);
                    setRegistry(reg);
                  }}
                  onEdit={() => {
                    setEditing(p);
                    setProviderView("edit");
                  }}
                  onCopy={async () => {
                    const suffix = Date.now().toString(36);
                    const copy: ProviderProfile = {
                      ...p,
                      id: `${p.id}-copy-${suffix}`,
                      name: `${p.name} 副本`,
                      preset: p.preset === p.id ? undefined : p.preset,
                      createdAt: undefined,
                      updatedAt: undefined,
                    };
                    const reg = await api.saveProvider(copy);
                    setRegistry(reg);
                  }}
                  onTest={async (model) => {
                    setTestResult(null);
                    setTestingProviderId(p.id);
                    try {
                      await api.testProviderStream({ providerId: p.id, model }, (event) => {
                        if (event.type === "success") {
                          setTestResult({
                            success: true,
                            latencyMs: event.latencyMs,
                            response: event.response,
                          });
                        } else {
                          setTestResult({
                            success: false,
                            latencyMs: event.latencyMs,
                            error: event.error,
                          });
                        }
                      });
                    } catch (e) {
                      setTestResult({
                        success: false,
                        latencyMs: 0,
                        error: e instanceof Error ? e.message : String(e),
                      });
                    } finally {
                      setTestingProviderId(null);
                    }
                  }}
                  onDelete={async () => {
                    if (!confirm(`删除供应商「${p.name}」？`)) return;
                    const reg = await api.removeProvider(p.id);
                    setRegistry(reg);
                  }}
                />
              ))}
            </ul>

            {!registry.providers.length && (
              <div className="empty-state">
                <p>还没有模型供应商</p>
                <button className="btn btn--primary" onClick={() => setProviderView("add")}>
                  + 添加供应商
                </button>
              </div>
            )}

            {testResult && (
              <div className={`test-toast ${testResult.success ? "ok" : "fail"}`}>
                <strong>{testResult.success ? "测试成功" : "测试失败"}</strong>
                <span>{testResult.latencyMs}ms</span>
                {!testResult.success && testResult.error && <p>{testResult.error}</p>}
                <button className="icon-btn" onClick={() => setTestResult(null)}>✕</button>
              </div>
            )}
          </>
        )}

        {tab === "mcp" && <McpPanel />}
        {tab === "skills" && <SkillsPanel />}
      </main>
    </div>
  );
}
