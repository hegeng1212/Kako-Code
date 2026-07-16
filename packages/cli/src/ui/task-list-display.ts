import { ansi } from "./ansi.js";

export type TaskListItemStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TaskListItemView {
  id: string;
  subject: string;
  status: TaskListItemStatus;
  activeForm?: string;
}

function markerForStatus(status: TaskListItemStatus): string {
  switch (status) {
    case "completed":
      return `${ansi.green}☑${ansi.reset}`;
    case "in_progress":
      return `${ansi.yellow}◐${ansi.reset}`;
    case "cancelled":
      return `${ansi.muted}☒${ansi.reset}`;
    default:
      return `${ansi.muted}☐${ansi.reset}`;
  }
}

function subjectLine(item: TaskListItemView): string {
  const marker = markerForStatus(item.status);
  if (item.status === "cancelled") {
    return `${marker} ${ansi.muted}${item.subject}${ansi.reset}`;
  }
  if (item.status === "in_progress") {
    return `${marker} ${ansi.bold}${ansi.text}${item.subject}${ansi.reset}`;
  }
  if (item.status === "completed") {
    return `${marker} ${ansi.text}${item.subject}${ansi.reset}`;
  }
  return `${marker} ${ansi.text}${item.subject}${ansi.reset}`;
}

/** Claude-style checklist lines for the session task list. */
export function renderTaskListBlockLines(items: TaskListItemView[]): string[] {
  if (items.length === 0) return [];
  return items.map((item) => subjectLine(item));
}

/** Prefer activeForm of the first in_progress task, else its subject. */
export function activityFormFromTasks(
  items: TaskListItemView[],
  activeForms?: Record<string, string>,
): string | undefined {
  const active = items.find((item) => item.status === "in_progress");
  if (!active) return undefined;
  const form = (activeForms?.[active.id] ?? active.activeForm)?.trim();
  if (form) return form;
  return active.subject;
}
