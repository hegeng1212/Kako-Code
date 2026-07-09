/** Built-in web search backend identifiers. */
export type SearchProviderId =
  | "doubao"
  | "brave"
  | "serpapi"
  | "bing"
  | "duckduckgo";

export interface SearchProviderProfile {
  id: SearchProviderId;
  enabled: boolean;
  /** API key (Doubao / Brave / SerpAPI). */
  apiKey?: string;
  /** Doubao base URL override. */
  baseUrl?: string;
  /** Result count (Doubao: web ≤50, image ≤5). */
  count?: number;
  /** Doubao search type. */
  searchType?: "web" | "image";
  /** Doubao time range: OneDay / OneWeek / OneMonth / OneYear / YYYY-MM-DD..YYYY-MM-DD */
  timeRange?: string;
  /** Doubao authority filter: 0 default, 1 very authoritative. */
  authLevel?: 0 | 1;
}

export interface SearchRegistry {
  version: number;
  providers: SearchProviderProfile[];
}

export type SearchProviderFieldType = "text" | "password" | "number" | "select";

export interface SearchProviderFieldDef {
  key: keyof SearchProviderProfile;
  label: string;
  type: SearchProviderFieldType;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

export interface SearchProviderPreset {
  id: SearchProviderId;
  name: string;
  description: string;
  requiresApiKey: boolean;
  docsUrl?: string;
  fields: SearchProviderFieldDef[];
}

export interface SearchTestResult {
  success: boolean;
  providerId: SearchProviderId;
  latencyMs: number;
  resultCount?: number;
  error?: string;
}
