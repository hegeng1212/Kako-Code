import type { AskUserQuestionItem, TranscriptMessage } from "@kako/shared";
import { summarizeCodeChanges, transcriptPreviewText } from "@kako/core";
import type {
  ChatTurn,
  ChoiceGroupTimelineEntry,
  ChoiceTimelineEntry,
  TurnTimelineEntry,
} from "./chat-blocks.js";
import type { ToolCallTimelineEntry } from "./tool-call-display.js";
import { formatReadDisplayDetail } from "./tool-call-phrases.js";

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  if (name === "Workflow") {
    if (typeof input.name === "string" && input.name.trim()) {
      return `dynamic workflow: ${input.name.trim()}`;
    }
  }
  if (name === "Read" && (input.file_path || input.path)) {
    return formatReadDisplayDetail(String(input.file_path ?? input.path), input);
  }
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.skill) return String(input.skill);
  if (input.command) return String(input.command).slice(0, 60);
  if (input.description) return String(input.description).slice(0, 80);
  try {
    return JSON.stringify(input).slice(0, 60);
  } catch {
    return "";
  }
}

function finishedAtFromIso(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.now();
}

function createDoneTurn(userText: string, id: string, timestamp: string): ChatTurn {
  const startedAt = finishedAtFromIso(timestamp);
  return {
    id,
    userText,
    answerText: "",
    thinkingStartedAt: startedAt,
    thinkingEndedAt: null,
    finishedAt: null,
    doneVerb: "Done",
    generatingVerb: null,
    outputTokens: 0,
    phase: "done",
    timeline: [],
    expandedThoughts: new Set(),
    expandedToolGroups: new Set(),
    expandedChoices: new Set(),
    pulseFrame: 0,
  };
}

/** Extract `"question"="answer"` pairs from AskUserQuestion tool results. */
export function parseAskUserQuestionAnswers(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /"((?:\\.|[^"\\])*)"="((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    out[match[1]!.replace(/\\"/g, '"')] = match[2]!.replace(/\\"/g, '"');
  }
  return out;
}

function questionsFromAskUserInput(input: Record<string, unknown>): AskUserQuestionItem[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];
  const out: AskUserQuestionItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const q = entry as Record<string, unknown>;
    const question = typeof q.question === "string" ? q.question.trim() : "";
    if (!question) continue;
    const header = typeof q.header === "string" && q.header.trim() ? q.header.trim() : "Question";
    const options = Array.isArray(q.options)
      ? q.options
          .filter((o): o is { label: string; description: string } => {
            if (!o || typeof o !== "object") return false;
            const opt = o as Record<string, unknown>;
            return typeof opt.label === "string";
          })
          .map((o) => ({
            label: o.label,
            description: typeof o.description === "string" ? o.description : "",
          }))
      : [];
    out.push({
      header,
      question,
      options,
      multiSelect: q.multiSelect === true,
    });
  }
  return out;
}

function choiceGroupFromAskUserTool(
  toolCallId: string,
  input: Record<string, unknown>,
  content: string,
): ChoiceGroupTimelineEntry | ChoiceTimelineEntry | null {
  const questions = questionsFromAskUserInput(input);
  if (questions.length === 0) return null;
  const answers = parseAskUserQuestionAnswers(content);
  const declined =
    /"declined"\s*:\s*true/.test(content) ||
    /cancelled the choice picker/i.test(content) ||
    /No answers were collected/i.test(content);

  // Assistant toolCalls are persisted before the user finishes answering.
  // Until there is a tool result (or an explicit decline), do not synthesize a
  // "User answered" block that lists bare questions.
  const hasAnyAnswer = Object.keys(answers).length > 0;
  if (!hasAnyAnswer && !declined) return null;

  if (questions.length === 1) {
    const q = questions[0]!;
    return {
      type: "choice",
      id: `hist-choice-${toolCallId}`,
      header: q.header,
      question: q.question,
      answer: answers[q.question] ?? "",
      options: q.options,
      multiSelect: q.multiSelect,
      declined: declined && !answers[q.question],
    };
  }

  const items = questions
    .map((q) => ({
      header: q.header,
      question: q.question,
      answer: answers[q.question] ?? "",
      options: q.options,
      multiSelect: q.multiSelect,
      declined: declined && !answers[q.question],
    }))
    .filter((item) => item.answer.trim().length > 0 || item.declined);
  if (items.length === 0) return null;

  return {
    type: "choice-group",
    id: `hist-choice-group-${toolCallId}`,
    items,
  };
}

function toolEntryFromMessages(
  toolCallId: string | undefined,
  toolName: string | undefined,
  content: string,
  pending: Map<string, { name: string; input: Record<string, unknown> }>,
): TurnTimelineEntry {
  const pendingCall = toolCallId ? pending.get(toolCallId) : undefined;
  const name = toolName || pendingCall?.name || "Tool";
  const input = pendingCall?.input ?? {};
  if (name === "AskUserQuestion" && toolCallId) {
    const choice = choiceGroupFromAskUserTool(toolCallId, input, content);
    if (choice) return choice;
  }
  const isError = content.trimStart().toLowerCase().startsWith("error:");
  const entry: ToolCallTimelineEntry = {
    type: "tool",
    id: toolCallId || `tool-${name}`,
    name,
    detail: summarizeToolInput(name, input),
    status: isError ? "error" : "success",
    output: isError ? undefined : content,
    errorDetail: isError ? content : undefined,
    toolInput: input,
    skillExpanded:
      name === "Skill" || name === "Workflow" || name.startsWith("mcp/") ? true : undefined,
    dotFrame: 0,
  };
  return entry;
}

function transcriptUsesCliInputMarker(transcript: TranscriptMessage[]): boolean {
  return transcript.some((msg) => msg.role === "user" && msg.metadata?.cliInput === true);
}

/** Stepped-away recap wake — protocol-only; must not appear or fold into chat turns. */
function isSteppedAwayRecapUser(msg: TranscriptMessage): boolean {
  if (msg.role !== "user") return false;
  const llm = msg.metadata?.llmText;
  return typeof llm === "string" && llm.includes("<stepped-away-recap");
}

/** Skip a protocol wake user row and its assistant/tool body. */
function skipTurnBody(transcript: TranscriptMessage[], start: number): number {
  let i = start;
  while (i < transcript.length && transcript[i]!.role !== "user") i++;
  return i;
}

/** User rows that started a CLI chat turn (not Skill-args / harness injections). */
function isDisplayUserPrompt(msg: TranscriptMessage, usesCliMarker: boolean): boolean {
  if (msg.role !== "user") return false;
  if (msg.metadata?.harnessInjected === true) return false;
  if (!usesCliMarker) return true;
  return msg.metadata?.cliInput === true;
}

function consumeTurnBody(
  transcript: TranscriptMessage[],
  start: number,
  turn: ChatTurn,
): number {
  let i = start;
  const pendingTools = new Map<string, { name: string; input: Record<string, unknown> }>();
  const timeline: TurnTimelineEntry[] = [...turn.timeline];
  let answerText = turn.answerText;
  let lastModelAt: number | null = null;

  while (i < transcript.length) {
    const cur = transcript[i]!;
    if (cur.role === "user") break;

    const ts = finishedAtFromIso(cur.timestamp);
    if (cur.role === "assistant") {
      if (cur.toolCalls?.length) {
        for (const tc of cur.toolCalls) {
          pendingTools.set(tc.id, {
            name: tc.name,
            input: tc.input ?? {},
          });
        }
      }
      const text = cur.content.trim();
      if (text) {
        timeline.push({ type: "answer", text: cur.content });
        answerText = cur.content;
      }
      lastModelAt = ts;
    } else if (cur.role === "tool") {
      timeline.push(
        toolEntryFromMessages(cur.toolCallId, cur.toolName, cur.content, pendingTools),
      );
      if (cur.toolCallId) pendingTools.delete(cur.toolCallId);
      lastModelAt = ts;
    }
    i++;
  }

  for (const [id, tc] of pendingTools) {
    // AskUserQuestion without a tool result = still waiting on the picker.
    // Never paint "User answered …" with the question list alone.
    if (tc.name === "AskUserQuestion") continue;
    timeline.push({
      type: "tool",
      id,
      name: tc.name,
      detail: summarizeToolInput(tc.name, tc.input),
      status: "success",
      toolInput: tc.input,
      dotFrame: 0,
    });
  }

  turn.timeline = timeline;
  turn.answerText = answerText;
  const endAt = lastModelAt ?? turn.thinkingStartedAt;
  turn.finishedAt = endAt;
  turn.thinkingEndedAt = endAt;
  return i;
}

/**
 * Rebuild completed chat turns from an L0 transcript for session switch / Agents open.
 * AskUserQuestion is reconstructed as choice / choice-group entries (not bare tool rows).
 *
 * Only `metadata.cliInput` user rows become `>` chat bars when the transcript uses that
 * marker (Skill-args / harness injections fold into the previous turn).
 */
export function chatTurnsFromTranscript(transcript: TranscriptMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const usesCliMarker = transcriptUsesCliInputMarker(transcript);
  let i = 0;

  while (i < transcript.length) {
    const msg = transcript[i]!;
    if (msg.role !== "user") {
      i++;
      continue;
    }

    // Recap wake is a separate model Q&A — never paint or fold into the chat timeline.
    if (isSteppedAwayRecapUser(msg)) {
      i = skipTurnBody(transcript, i + 1);
      continue;
    }

    if (!isDisplayUserPrompt(msg, usesCliMarker)) {
      if (turns.length === 0) {
        const turn = createDoneTurn("", `hist-${msg.id}`, msg.timestamp);
        turns.push(turn);
        i = consumeTurnBody(transcript, i + 1, turn);
        if (turn.timeline.length === 0 && !turn.userText) {
          turns.pop();
        }
      } else {
        i = consumeTurnBody(transcript, i + 1, turns[turns.length - 1]!);
      }
      continue;
    }

    const userText = transcriptPreviewText(msg).trim();
    const turn = createDoneTurn(userText || "(empty)", `hist-${msg.id}`, msg.timestamp);
    i = consumeTurnBody(transcript, i + 1, turn);
    if (turn.timeline.length > 0 || userText) {
      turns.push(turn);
    }
  }

  return turns;
}

/**
 * Child Explore (and similar) write L0 while still running. Transcript rebuild marks
 * every turn `phase: "done"` — when the agent is live, peel the last turn into an
 * active streaming turn so the detail view does not paint premature `* Done`.
 */
export function reopenLastTranscriptTurn(turns: ChatTurn[]): {
  completed: ChatTurn[];
  active: ChatTurn | null;
} {
  if (turns.length === 0) return { completed: [], active: null };
  const active = turns[turns.length - 1]!;
  const hasAnswer = active.timeline.some((e) => e.type === "answer" && e.text.trim());
  active.phase = hasAnswer ? "answering" : "thinking";
  active.finishedAt = null;
  active.doneVerb = null;
  return { completed: turns.slice(0, -1), active };
}

/** User turn anchors for Rewind: preview text + L0 index of the user message. */
export interface RewindTurnAnchor {
  text: string;
  timestamp: string;
  transcriptIndex: number;
  /** True when this turn's assistant work used Write/Edit/NotebookEdit. */
  hasCodeChanges?: boolean;
  filesChanged?: {
    count: number;
    additions: number;
    deletions: number;
    primaryFile?: string;
  };
}

export function rewindTurnsFromTranscript(transcript: TranscriptMessage[]): RewindTurnAnchor[] {
  const usesCliMarker = transcriptUsesCliInputMarker(transcript);
  const promptIndexes: number[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i]!;
    if (!isDisplayUserPrompt(msg, usesCliMarker)) continue;
    if (!transcriptPreviewText(msg).trim()) continue;
    promptIndexes.push(i);
  }

  const anchors: RewindTurnAnchor[] = [];
  for (let p = 0; p < promptIndexes.length; p++) {
    const i = promptIndexes[p]!;
    const msg = transcript[i]!;
    const text = transcriptPreviewText(msg).trim();
    const endExclusive = promptIndexes[p + 1] ?? transcript.length;
    const code = summarizeCodeChanges(transcript, i, endExclusive);
    anchors.push({
      text,
      timestamp: msg.timestamp,
      transcriptIndex: i,
      hasCodeChanges: Boolean(code && code.count > 0),
      filesChanged: code ?? undefined,
    });
  }
  return anchors;
}
