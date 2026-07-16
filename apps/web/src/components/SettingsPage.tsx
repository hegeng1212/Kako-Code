import { useState } from "react";
import { MemorySettingsTab } from "./MemorySettingsTab";
import { NetworkSettingsTab } from "./NetworkSettingsTab";
import { SearchSettingsTab } from "./SearchSettingsTab";
import { SecuritySettingsTab } from "./SecuritySettingsTab";

type SettingsTab = "search" | "security" | "network" | "memory";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "search", label: "搜索设置" },
  { id: "security", label: "安全策略" },
  { id: "network", label: "网络安全" },
  { id: "memory", label: "记忆" },
];

interface SettingsPageProps {
  onBack: () => void;
  version?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
}

export function SettingsPage({ onBack, version, license, licenseUrl }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>("search");

  return (
    <div className="app app--settings">
      <header className="topbar topbar--sub">
        <div className="topbar__left">
          <button type="button" className="topbar__back" onClick={onBack} aria-label="返回">
            ←
          </button>
          <span className="topbar__brand topbar__brand--page">设置</span>
        </div>
        <div className="topbar__right" />
      </header>

      <main className="main settings-main">
        <nav className="settings-tabs" aria-label="设置分类">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-tabs__tab ${tab === item.id ? "settings-tabs__tab--active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-tab-body" key={tab}>
          {tab === "search" && <SearchSettingsTab />}
          {tab === "security" && <SecuritySettingsTab />}
          {tab === "network" && <NetworkSettingsTab />}
          {tab === "memory" && <MemorySettingsTab />}
        </div>
        {(version || license) && (
          <footer className="app-about">
            <span className="app-about__label">Kako</span>
            {version && <span className="app-about__version">版本 {version}</span>}
            {license &&
              (licenseUrl ? (
                <a className="app-about__license" href={licenseUrl} target="_blank" rel="noopener noreferrer">
                  {license}
                </a>
              ) : (
                <span className="app-about__license">{license}</span>
              ))}
          </footer>
        )}
      </main>
    </div>
  );
}
