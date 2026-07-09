import type { SearchProviderId } from "@kako/shared";

const SEARCH_COLORS: Record<SearchProviderId, string> = {
  doubao: "#3370ff",
  brave: "#fb542b",
  serpapi: "#5470ff",
  bing: "#008373",
  duckduckgo: "#de5833",
};

const SEARCH_LABELS: Record<SearchProviderId, string> = {
  doubao: "豆",
  brave: "B",
  serpapi: "G",
  bing: "Bi",
  duckduckgo: "DD",
};

export function SearchProviderIcon({ id }: { id: SearchProviderId }) {
  return (
    <div
      className="provider-icon search-provider-icon"
      style={{ background: SEARCH_COLORS[id], color: "#fff" }}
      aria-hidden="true"
    >
      {SEARCH_LABELS[id]}
    </div>
  );
}
