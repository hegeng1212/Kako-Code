import type { SearchProviderPreset } from "@kako/shared";

export const SEARCH_PROVIDER_PRESETS: SearchProviderPreset[] = [
  {
    id: "doubao",
    name: "豆包搜索",
    description: "火山引擎联网搜索 API（Custom 版）",
    requiresApiKey: true,
    docsUrl: "https://www.volcengine.com/docs/87772/2272953?lang=zh",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "在火山控制台创建",
        hint: "控制台 → 联网搜索 API → API Key",
      },
      {
        key: "baseUrl",
        label: "Base URL",
        type: "text",
        placeholder: "https://open.feedcoopapi.com",
      },
      {
        key: "count",
        label: "返回条数",
        type: "number",
        min: 1,
        max: 50,
        hint: "web 最多 50 条",
      },
      {
        key: "searchType",
        label: "搜索类型",
        type: "select",
        options: [
          { value: "web", label: "网页 (web)" },
          { value: "image", label: "图片 (image)" },
        ],
      },
      {
        key: "timeRange",
        label: "时间范围",
        type: "text",
        placeholder: "OneDay / OneWeek / OneMonth / OneYear",
        hint: "或 YYYY-MM-DD..YYYY-MM-DD",
      },
      {
        key: "authLevel",
        label: "权威等级",
        type: "select",
        options: [
          { value: "0", label: "0 — 默认" },
          { value: "1", label: "1 — 非常权威" },
        ],
      },
    ],
  },
  {
    id: "brave",
    name: "Brave Search",
    description: "Brave Search API（US region）",
    requiresApiKey: true,
    docsUrl: "https://brave.com/search/api/",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "BRAVE_SEARCH_API_KEY",
      },
    ],
  },
  {
    id: "serpapi",
    name: "SerpAPI",
    description: "Google 搜索结果代理",
    requiresApiKey: true,
    docsUrl: "https://serpapi.com/",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        placeholder: "SERPAPI_KEY",
      },
    ],
  },
  {
    id: "bing",
    name: "Bing 网页搜索",
    description: "无需 API Key，抓取 Bing 搜索结果页",
    requiresApiKey: false,
    fields: [],
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    description: "Instant Answer API，无需 Key",
    requiresApiKey: false,
    fields: [],
  },
];

export function getSearchProviderPreset(id: string): SearchProviderPreset | undefined {
  return SEARCH_PROVIDER_PRESETS.find((p) => p.id === id);
}
