import type { MemorySettingsGroupId } from "@kako/shared";
import type { HelpTipContent } from "./HelpTip";

export const MEMORY_GROUP_HELP: Record<MemorySettingsGroupId, HelpTipContent> = {
  autoRecall: {
    summary:
      "自动召回：在你每发一条消息后，系统会从记忆索引里检索少量相关片段，自动塞进本轮上下文，让模型「记得」跨会话事实，而不必每次手写搜索。",
    bullets: [
      "有硬上限：片段条数与 token 预算，避免整库 RAG 灌进 prompt。",
      "关闭后：不会自动注入；仍可用 MemorySearch / MemoryGet 工具按需取。",
      "注入内容标记为检索上下文，模型应交叉验证，不当成绝对真相。",
    ],
    example:
      "你上周约定「API 用 JWT」并写入记忆。今天问「鉴权怎么做的？」时，自动召回可能注入那条笔记片段，模型可直接沿用约定。",
  },
  curatedTools: {
    summary:
      "策展与工具：维护两份有界、人类可读的 Markdown（notes / user），在会话开始时注入；并控制主对话里的 Memory 工具与写入是否要审批。",
    bullets: [
      "notes：项目约定、决策、常查事实；user：偏好、角色、沟通风格。",
      "冻结快照：同一会话内注入内容不随磁盘中途改写而变，利于 prompt cache。",
      "超字符上限时写入失败并返回当前条目，不会静默截断。",
      "写入审批开启后，策展/回顾写入先进入 pending，批准后再落盘。",
    ],
    example:
      "让助手记住「回复用中文、测试用 vitest」。它调用 Memory 写入 curated/user；之后新会话 bootstrap 都会带上这段画像。",
  },
  backgroundReview: {
    summary:
      "回合回顾：一轮对话成功结束后，在后台异步跑一次无工具的 LLM 回顾，提炼可沉淀的内容（更新策展、抽事实），不打断你当前输入。",
    bullets: [
      "受冷却时间、每小时/每天次数，以及共享 LLM 配额共同限制。",
      "可指定辅助模型；留空则用当前会话主模型。",
      "适合「聊完再整理」，而不是每句都同步写记忆。",
    ],
    example:
      "你花一小时定下目录结构与命名。回合结束后回顾任务可能把「采用 apps/web + packages/core」写入策展 notes，供下次会话召回。",
  },
  budget: {
    summary:
      "LLM 配额：给「记忆相关」的模型调用单独设小时/日总量与并发上限，避免回顾或后台任务把主对话额度打光。",
    bullets: [
      "覆盖背景回顾，以及未来的 consolidate / curator / dreaming 等任务。",
      "与主对话 turn 的用量分开计数（按记忆子系统记账）。",
      "并发限制可防止多个记忆任务同时打满 API。",
    ],
    example:
      "设每小时 40 次：短时间连续多轮对话时，回顾跑满额度后会跳过，直到下一小时窗口恢复。",
  },
  jobs: {
    summary:
      "高级任务：日终与空闲时段运行的记忆流水线。按需开启后，系统会在约定时机做汇总、清理与离线整理，减轻交互时的负担。",
    bullets: [
      "Consolidate：把多会话沉淀成日汇总 / 结构化摘要。",
      "Curator：清理、合并、晋升长期事实与叙事。",
      "Dreaming：离线再组织策展与索引（类似「做梦整理」）。",
    ],
    example:
      "凌晨 cron 触发 Consolidate，把昨天多个会话的 Goal/决策滚进当日 rolling 摘要，次日自动召回即可命中。",
  },
};

export const MEMORY_JOB_HELP: Record<"consolidate" | "curator" | "dreaming", HelpTipContent> = {
  consolidate: {
    summary:
      "Consolidate（汇总巩固）：把分散会话里的进展压成可叠加的摘要（如 L1 章节或按日的 L2 rolling），减少以后检索要翻的原文量。",
    bullets: [
      "典型在日终或会话变脏时运行，可限制每轮处理的会话数。",
      "可顺带抽取事实；与「回合后即时回顾」不同，更偏批量离线。",
    ],
    example:
      "一天开了 5 个相关会话。Consolidate 生成「2026-07-16」日汇总：目标、关键决策、未完成项，供次日自动召回命中。",
  },
  curator: {
    summary:
      "Curator（策展清理）：审视长期事实库，做去重、过期淘汰、置信度过滤，并把高价值情节晋升到 episodic 档案。",
    bullets: [
      "可按事实最大保留天数、最低置信度过滤。",
      "可选 LLM 做矛盾检测（成本更高，默认偏关）。",
    ],
    example:
      "库里同时有「用 REST」和后来的「改用 gRPC」。Curator 合并或标记过时，避免自动召回同时塞进互相冲突的两条。",
  },
  dreaming: {
    summary:
      "Dreaming（离线整理）：在空闲时段用模型重排策展笔记、重建检索索引等，不占用你交互时的上下文窗口。",
    bullets: [
      "可限制单次 token 预算；可选是否重组 curated、是否 rebuild FTS。",
      "类比睡眠中的记忆巩固，偏维护而非即时问答。",
    ],
    example:
      "夜里任务把杂乱的 notes 条目按主题归并，并重建 FTS，早上搜索「鉴权」能更快命中整理后的段落。",
  },
};
