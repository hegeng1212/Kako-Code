import { useEffect, useRef, useState } from "react";
import type {
  InstalledSkillRecord,
  SkillBuildChatAttachment,
  SkillBuildChatMessage,
  SkillBuildQuestion,
  SkillBuildTurnResult,
  SkillValidationResult,
} from "@kako/shared";
import { api } from "../api";
import { InstallProgressButton } from "./InstallProgressButton";
import { IconPlus } from "./RowIcons";

function SkillBuildValidationPanel({
  validation,
  pendingQuestionIds,
  questions,
}: {
  validation: SkillValidationResult;
  pendingQuestionIds?: Set<string>;
  questions?: SkillBuildQuestion[];
}) {
  const visibleQuestions = (questions ?? []).filter((q) => !pendingQuestionIds?.has(q.id));
  const pendingTools = new Set(
    visibleQuestions.filter((q) => q.relatedTool).map((q) => q.relatedTool!),
  );
  const missingTools = validation.missingTools.filter(
    (tool) => !pendingTools.has(tool.normalized),
  );
  const resolvedMcpTools = validation.resolvedMcpTools ?? [];
  const hasErrors =
    missingTools.length > 0 ||
    validation.unavailableAgentTools.length > 0 ||
    visibleQuestions.length > 0;

  return (
    <>
      {resolvedMcpTools.length > 0 && (
        <div className="skills-build-validation skills-build-validation--ok">
          <strong>本技能使用的 MCP 工具</strong>
          <ul>
            {resolvedMcpTools.map((tool) => (
              <li key={tool.normalized}>
                <code>{tool.normalized}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasErrors && (
        <div className="skills-build-validation skills-build-validation--error">
          <strong>MCP 工具需要处理</strong>
          <p>以下工具在当前环境中不存在或未就绪，请连接 MCP 或修正工具名称后再保存。</p>
          {missingTools.length > 0 && (
            <ul>
              {missingTools.map((tool) => (
                <li key={tool.normalized}>
                  缺少工具：<code>{tool.raw}</code>
                </li>
              ))}
            </ul>
          )}
          {validation.unavailableAgentTools.length > 0 && (
            <ul>
              {validation.unavailableAgentTools.map((tool) => (
                <li key={tool.normalized}>
                  主 Agent 未启用：<code>{tool.normalized}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function SkillBuildQuestions({
  questions,
  disabled,
  onAnswer,
}: {
  questions: SkillBuildQuestion[];
  disabled: boolean;
  onAnswer: (label: string, question: SkillBuildQuestion) => void;
}) {
  if (questions.length === 0) return null;

  return (
    <div className="skills-build-questions">
      <div className="skills-build-questions__head">
        <strong>请确认以下问题</strong>
        <span>选择一项继续构建</span>
      </div>
      {questions.map((question) => (
        <div key={question.id} className="skills-build-question">
          <p>{question.text}</p>
          {question.options && question.options.length > 0 && (
            <div className="skills-build-question__options">
              {question.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="skills-build-option"
                  disabled={disabled}
                  onClick={() => onAnswer(option.label, question)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface SkillsBuildChatProps {
  onInstalled: (skills: InstalledSkillRecord[]) => void;
  onError: (message: string | null) => void;
  onSuccess: (message: string | null) => void;
}

export function SkillsBuildChat({ onInstalled, onError, onSuccess }: SkillsBuildChatProps) {
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<SkillBuildChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [draftSkillMd, setDraftSkillMd] = useState<string | null>(null);
  const [questions, setQuestions] = useState<SkillBuildQuestion[]>([]);
  const [validation, setValidation] = useState<SkillValidationResult | null>(null);
  const [readyToSave, setReadyToSave] = useState(false);
  const [pendingQuestionIds, setPendingQuestionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<SkillBuildChatAttachment[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fileToAttachment(file: File): Promise<SkillBuildChatAttachment> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      data: btoa(binary),
    };
  }

  async function addFiles(files: FileList | File[]) {
    const next = [...pendingAttachments];
    for (const file of files) {
      next.push(await fileToAttachment(file));
    }
    setPendingAttachments(next);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, questions, draftSkillMd, loading]);

  function beginNewSession() {
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setDraftSkillMd(null);
    setQuestions([]);
    setValidation(null);
    setReadyToSave(false);
    setPendingQuestionIds(new Set());
    setInput("");
    setPendingAttachments([]);
    onError(null);
  }

  async function sendUserMessage(
    text: string,
    question?: SkillBuildQuestion,
    attachments = pendingAttachments,
  ) {
    const content = text.trim();
    if ((!content && attachments.length === 0) || loading) return;

    if (question) {
      setPendingQuestionIds((prev) => new Set(prev).add(question.id));
    }

    const nextMessages: SkillBuildChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: content || `[${attachments.length} attachment(s)]`,
        attachments: attachments.length ? attachments : undefined,
      },
    ];
    setMessages(nextMessages);
    setInput("");
    setPendingAttachments([]);
    setLoading(true);
    onError(null);

    try {
      const turn: SkillBuildTurnResult = await api.buildSkillChat({
        sessionId,
        messages: nextMessages,
        draftSkillMd: draftSkillMd ?? undefined,
      });
      setMessages([...nextMessages, { role: "assistant", content: turn.assistantMessage }]);
      if (turn.skillMd) setDraftSkillMd(turn.skillMd);
      setQuestions(turn.validation?.ok ? [] : turn.questions);
      setValidation(turn.validation ?? null);
      setReadyToSave(turn.readyToSave);
      setPendingQuestionIds(new Set());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(force = false) {
    if (!draftSkillMd) return;
    if (!force && validation && !validation.ok) {
      const first = confirm(
        "技能引用的 MCP 工具当前不可用或未连接。\n\n仍要保存吗？保存后技能可能无法正常运行。",
      );
      if (!first) return;
      const second = confirm("再次确认：确定强制保存此技能？");
      if (!second) return;
      return handleSave(true);
    }
    setInstalling(true);
    onError(null);
    try {
      const { skills } = await api.saveSkill(draftSkillMd, force);
      onInstalled(skills);
      beginNewSession();
      onSuccess("技能已保存");
    } catch (e) {
      const err = e as Error & { validation?: SkillValidationResult };
      if (err.validation) setValidation(err.validation);
      onError(err instanceof Error ? err.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  function resetChat() {
    if (messages.length > 0 && !confirm("确定重新开始对话？当前草稿将丢失。")) return;
    beginNewSession();
  }

  return (
    <div className="skills-build-chat">
      <p className="skills-add-hint">
        描述你想要的技能，可多轮对话逐步完善。内置工具无需确认；引用 MCP 工具时会提示已使用的工具（绿字），仅在工具不存在时显示红字确认。
      </p>

      <section className="skills-build-panel">
        <header className="skills-build-panel__head">
          <h3>对话</h3>
          {messages.length > 0 && (
            <button type="button" className="btn btn--toolbar btn--sm" disabled={loading} onClick={resetChat}>
              重新开始
            </button>
          )}
        </header>

        <div className="skills-build-chat__messages">
          {messages.length === 0 && (
            <p className="skills-build-chat__empty">
              从下方输入技能需求开始对话，例如：帮我做一个宝宝生长数据记录技能…
            </p>
          )}
          {messages.map((msg, index) => (
            <div
              key={`${msg.role}-${index}`}
              className={`skills-build-chat__bubble skills-build-chat__bubble--${msg.role}`}
            >
              <span className="skills-build-chat__role">{msg.role === "user" ? "你" : "助手"}</span>
              <div className="skills-build-chat__content">{msg.content}</div>
            </div>
          ))}
          {loading && (
            <div className="skills-build-chat__bubble skills-build-chat__bubble--assistant">
              <span className="skills-build-chat__role">助手</span>
              <div className="skills-build-chat__content skills-build-chat__typing">思考中…</div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </section>

      <SkillBuildQuestions
        questions={
          validation?.ok
            ? []
            : questions.filter((q) => !pendingQuestionIds.has(q.id))
        }
        disabled={loading}
        onAnswer={(label, question) =>
          void sendUserMessage(`我选择：${label}｜question=${question.id}`, question)
        }
      />

      {draftSkillMd && (
        <section className="skills-build-panel skills-build-preview skills-build-preview--inline">
          <div className="skills-build-preview__header">
            <h3>当前草稿</h3>
            {readyToSave && <span className="tag tag--active">可保存</span>}
          </div>
          {validation && (
            <SkillBuildValidationPanel
              validation={validation}
              pendingQuestionIds={pendingQuestionIds}
              questions={questions}
            />
          )}
          <pre className="skills-build-preview__code">{draftSkillMd}</pre>
          <div className="skills-build-preview__actions">
            <InstallProgressButton
              variant="primary"
              label={validation && !validation.ok ? "仍要保存" : "确认保存"}
              installingLabel="保存中…"
              installing={installing}
              disabled={loading}
              onClick={() => void handleSave()}
            />
          </div>
        </section>
      )}

      <section className="skills-build-panel skills-build-chat__composer">
        {pendingAttachments.length > 0 && (
          <div className="skills-build-chat__attachments">
            {pendingAttachments.map((file, index) => (
              <span key={`${file.name}-${index}`} className="skills-build-chat__attachment-chip">
                {file.name}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <label className="field skills-build-chat__field">
          <span className="field__label">输入消息</span>
          <textarea
            className="skills-build-chat__input"
            rows={4}
            placeholder="补充需求、回答疑问，或描述要调用的 MCP 工具…"
            value={input}
            disabled={loading}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const imageFiles: File[] = [];
              for (const item of items) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              if (imageFiles.length) {
                e.preventDefault();
                void addFiles(imageFiles);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void sendUserMessage(input);
              }
            }}
          />
          <span className="field__help">⌘/Ctrl + Enter 发送</span>
        </label>
        <div className="skills-build-chat__composer-actions">
          <button
            type="button"
            className="btn btn--toolbar"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconPlus className="btn__icon" />
            添加附件
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={(!input.trim() && pendingAttachments.length === 0) || loading}
            onClick={() => void sendUserMessage(input)}
          >
            {loading ? "发送中…" : "发送"}
          </button>
        </div>
      </section>
    </div>
  );
}
