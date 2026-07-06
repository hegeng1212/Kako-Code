import type { LLMProviderId } from "@kako/shared";

export interface ParsedModel {
  provider: LLMProviderId;
  model: string;
}

export function parseModel(modelId: string): ParsedModel {
  const slash = modelId.indexOf("/");
  if (slash === -1) {
    return { provider: "anthropic", model: modelId };
  }
  const provider = modelId.slice(0, slash) as LLMProviderId;
  const model = modelId.slice(slash + 1);
  return { provider, model };
}
