import type { LLMMessage } from "@kako/shared";
import { getTextContent } from "../llm/content-blocks.js";
import { inferUserAuthoringLanguage } from "../skills/skill-authoring.js";

function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function hasJapaneseScript(text: string): boolean {
  return /[\u3040-\u30ff]/.test(text);
}

function hasKoreanScript(text: string): boolean {
  return /[\uac00-\ud7af]/.test(text);
}

/** Infer IANA timezone from user-authored text (language/script heuristics). */
export function inferTimeZoneFromUserText(
  text: string,
  systemTimeZone: string = getSystemTimeZone(),
): string {
  const trimmed = text.trim();
  if (!trimmed) return systemTimeZone;
  if (hasJapaneseScript(trimmed)) return "Asia/Tokyo";
  if (hasKoreanScript(trimmed)) return "Asia/Seoul";

  const lang = inferUserAuthoringLanguage(trimmed);
  if (lang === "zh") return "Asia/Shanghai";
  return systemTimeZone;
}

export function collectUserTextFromMessages(messages: LLMMessage[]): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => getTextContent(message.content))
    .join("\n");
}

export function formatCurrentMonthYear(
  timeZone: string,
  locale = "en-US",
  date: Date = new Date(),
): string {
  return date.toLocaleString(locale, {
    month: "long",
    year: "numeric",
    timeZone,
  });
}

export function resolveWebSearchTimeZone(
  userText?: string,
  systemTimeZone: string = getSystemTimeZone(),
): string {
  return inferTimeZoneFromUserText(userText ?? "", systemTimeZone);
}
