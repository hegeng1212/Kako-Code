import type {
  LLMCompletion,
  LLMRequest,
  LLMStreamChunk,
  LLMRouter,
  ProviderRegistry,
} from "@kako/shared";
import {
  getActiveProvider,
  loadProviderRegistry,
  resolveEnabledModel,
} from "../config/provider-store.js";
import {
  openaiCompatibleComplete,
  openaiCompatibleStream,
} from "./openai-compatible.js";

export function createLLMRouter(registry?: ProviderRegistry): LLMRouter {
  return {
    async complete(request: LLMRequest): Promise<LLMCompletion> {
      const reg = registry ?? (await loadProviderRegistry());
      const { profile, model } = resolveRequestModel(request.model, reg);
      return openaiCompatibleComplete({ ...request, model }, profile);
    },

    stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
      return streamWithRegistry(request, registry);
    },
  };
}

async function* streamWithRegistry(
  request: LLMRequest,
  registry?: ProviderRegistry,
): AsyncIterable<LLMStreamChunk> {
  const reg = registry ?? (await loadProviderRegistry());
  const { profile, model } = resolveRequestModel(request.model, reg);
  yield* openaiCompatibleStream({ ...request, model }, profile);
}

const AGENT_MODEL_ALIASES = new Set(["sonnet", "opus", "haiku", "fable"]);

function resolveRequestModel(modelHint: string, registry: ProviderRegistry) {
  const active = getActiveProvider(registry);
  const trimmed = modelHint?.trim() ?? "";

  if (!trimmed) {
    return active;
  }

  if (trimmed.includes("/")) {
    const [providerId, modelPart] = trimmed.split("/", 2);
    if (providerId !== registry.active.providerId) {
      return active;
    }
    return {
      profile: active.profile,
      model: resolveEnabledModel(active.profile, modelPart),
    };
  }

  if (AGENT_MODEL_ALIASES.has(trimmed.toLowerCase())) {
    return active;
  }

  return {
    profile: active.profile,
    model: resolveEnabledModel(active.profile, trimmed),
  };
}

/** Resolve an agent YAML / Agent-tool model hint to an enabled model on the active provider. */
export async function resolveModel(
  agentModel: string | undefined,
  registry?: ProviderRegistry,
): Promise<string> {
  const reg = registry ?? (await loadProviderRegistry());
  const { profile, model: activeModel } = getActiveProvider(reg);
  const trimmed = agentModel?.trim() ?? "";

  if (!trimmed) {
    return activeModel;
  }

  if (trimmed.includes("/")) {
    const [providerId, modelPart] = trimmed.split("/", 2);
    if (providerId !== reg.active.providerId) {
      return activeModel;
    }
    return resolveEnabledModel(profile, modelPart);
  }

  if (AGENT_MODEL_ALIASES.has(trimmed.toLowerCase())) {
    return activeModel;
  }

  return resolveEnabledModel(profile, trimmed);
}

export function resolveModelSync(registry: ProviderRegistry): string {
  return getActiveProvider(registry).model;
}
