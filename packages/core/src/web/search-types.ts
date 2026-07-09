export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearchInput {
  query: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export interface WebSearchResponse {
  query: string;
  region: "US";
  results: WebSearchResult[];
}
