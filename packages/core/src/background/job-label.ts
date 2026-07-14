import type { LLMMessage, LLMRouter } from "@kako/shared";

const JOB_LABEL_USER_TEMPLATE = `2-4 word lowercase label for this job.
User: "{userAsk}"
Agent: "{agentTail}"

Include the MOST SPECIFIC identifier (component/file/feature). Skip generic
verbs like fix/add/update. Respond with ONLY the label.`;

const LABEL_PATTERN = /^[a-z0-9][a-z0-9 ._-]{0,39}$/;

export function buildJobLabelMessages(userAsk: string, agentTail: string): LLMMessage[] {
  const user = JOB_LABEL_USER_TEMPLATE.replace("{userAsk}", userAsk.trim().slice(0, 500))
    .replace("{agentTail}", agentTail.trim().slice(-800));
  return [{ role: "user", content: user }];
}

export function parseJobLabel(content: string): string | null {
  const label = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (!label) return null;
  const tokens = label.split(" ");
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (!LABEL_PATTERN.test(label)) return null;
  return label;
}

export function fallbackJobLabel(userAsk: string): string | null {
  const words = userAsk
    .trim()
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  if (words.length < 2) return null;
  return words.join(" ");
}

export async function generateJobLabel(
  router: LLMRouter,
  model: string,
  userAsk: string,
  agentTail: string,
): Promise<string | null> {
  if (!userAsk.trim() || !agentTail.trim()) return null;
  const completion = await router.complete({
    model,
    messages: buildJobLabelMessages(userAsk, agentTail),
    temperature: 0.2,
    maxTokens: 32,
  });
  return parseJobLabel(completion.content) ?? fallbackJobLabel(userAsk);
}
