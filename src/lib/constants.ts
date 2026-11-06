import type { GoalStatus, Priority, TaskStatus } from "./types";

export const DEFAULT_TIMEZONE = "Asia/Karachi";

export const PRIORITIES: { value: Priority; label: string; dot: string; text: string }[] = [
  { value: "critical", label: "Critical", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  { value: "high", label: "High", dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  { value: "medium", label: "Medium", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  { value: "low", label: "Low", dot: "bg-zinc-400", text: "text-zinc-500 dark:text-zinc-400" },
];
export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const priorityMeta = (p: Priority) => PRIORITIES.find((x) => x.value === p)!;

export const TASK_STATUSES: { value: TaskStatus; label: string; badge: string }[] = [
  { value: "upcoming", label: "Upcoming", badge: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300" },
  { value: "pending", label: "Pending", badge: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300" },
  { value: "in_progress", label: "In progress", badge: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300" },
  { value: "overdue", label: "Overdue", badge: "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300" },
  { value: "completed", label: "Completed", badge: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" },
  { value: "cancelled", label: "Cancelled", badge: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400" },
];
export const statusMeta = (s: TaskStatus) => TASK_STATUSES.find((x) => x.value === s)!;
export const OPEN_STATUSES: TaskStatus[] = ["upcoming", "pending", "in_progress", "overdue"];
export const isOpen = (s: TaskStatus) => OPEN_STATUSES.includes(s);

export const GOAL_STATUSES: { value: GoalStatus; label: string; badge: string }[] = [
  { value: "not_started", label: "Not started", badge: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300" },
  { value: "in_progress", label: "In progress", badge: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300" },
  { value: "at_risk", label: "At risk", badge: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300" },
  { value: "completed", label: "Completed", badge: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" },
  { value: "cancelled", label: "Cancelled", badge: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20" },
];
export const goalStatusMeta = (s: GoalStatus) => GOAL_STATUSES.find((x) => x.value === s)!;

export const WEEKDAYS = [
  { iso: 1, short: "Mon" }, { iso: 2, short: "Tue" }, { iso: 3, short: "Wed" }, { iso: 4, short: "Thu" },
  { iso: 5, short: "Fri" }, { iso: 6, short: "Sat" }, { iso: 7, short: "Sun" },
];

export const SWATCHES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#14b8a6", "#64748b"];
