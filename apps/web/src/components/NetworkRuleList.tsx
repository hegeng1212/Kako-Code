import { useMemo, useState } from "react";
import {
  networkRuleMatchesQuery,
  normalizeNetworkRule,
  validateNetworkRule,
} from "@kako/shared";

interface NetworkRuleListProps {
  id: string;
  label: string;
  hint?: string;
  rules: string[];
  placeholder?: string;
  tagVariant?: "default" | "allowlist" | "blacklist";
  onChange: (rules: string[]) => void;
}

export function NetworkRuleList({
  id,
  label,
  hint,
  rules,
  placeholder = "例如 *.sina.com、172.3.4.6:8080",
  tagVariant = "default",
  onChange,
}: NetworkRuleListProps) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const visibleRules = useMemo(
    () => rules.filter((rule) => networkRuleMatchesQuery(rule, query)),
    [rules, query],
  );

  function addRule() {
    const validationError = validateNetworkRule(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    const normalized = normalizeNetworkRule(draft);
    if (rules.includes(normalized)) {
      setError("该规则已存在");
      return;
    }
    onChange([...rules, normalized]);
    setDraft("");
    setError(null);
  }

  function removeRule(rule: string) {
    onChange(rules.filter((item) => item !== rule));
  }

  return (
    <section className="network-rule-list">
      <div className="network-rule-list__header">
        <div>
          <h3 className="network-rule-list__title">{label}</h3>
          {hint ? <p className="network-rule-list__hint">{hint}</p> : null}
        </div>
        <span className="network-rule-list__count">{rules.length} 条</span>
      </div>

      <div className="network-rule-list__add">
        <input
          id={`${id}-draft`}
          className="network-rule-list__input"
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRule();
            }
          }}
        />
        <button type="button" className="btn btn--secondary btn--sm" onClick={addRule}>
          添加
        </button>
      </div>
      {error ? <p className="network-rule-list__error">{error}</p> : null}

      {rules.length > 3 && (
        <label className="network-rule-list__search" htmlFor={`${id}-search`}>
          <span className="network-rule-list__search-label">搜索</span>
          <input
            id={`${id}-search`}
            className="network-rule-list__input"
            type="search"
            value={query}
            placeholder="模糊匹配域名、IP、端口…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      {visibleRules.length > 0 ? (
        <ul className="network-rule-list__tags">
          {visibleRules.map((rule) => (
            <li
              key={rule}
              className={[
                "network-rule-tag",
                tagVariant === "allowlist" ? "network-rule-tag--allowlist" : "",
                tagVariant === "blacklist" ? "network-rule-tag--blacklist" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <code className="network-rule-tag__text">{rule}</code>
              <button
                type="button"
                className="network-rule-tag__remove"
                aria-label={`删除 ${rule}`}
                onClick={() => removeRule(rule)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="network-rule-list__empty">
          {rules.length === 0 ? "暂无规则，添加后显示在这里。" : "没有匹配当前搜索的规则。"}
        </p>
      )}
    </section>
  );
}
