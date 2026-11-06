"use client";
import { useMemo } from "react";
import { isOpen, PRIORITY_RANK } from "./constants";
import { useTasks, useTz } from "./queries";
import type { Task } from "./types";
import { addDaysKey, dateKey, todayKey } from "./tz";

export const anchorOf = (t: Task) => t.scheduled_at ?? t.due_at;

export function sortTasks(a: Task, b: Task) {
  const x = anchorOf(a);
  const y = anchorOf(b);
  if (x && y && x !== y) return x < y ? -1 : 1;
  if (!!x !== !!y) return x ? -1 : 1;
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title);
}

export function useTaskViews() {
  const tz = useTz();
  const { data: tasks, isLoading, error } = useTasks();
  return useMemo(() => {
    const today = todayKey(tz);
    const all = (tasks ?? []).slice().sort(sortTasks);
    const open = all.filter((t) => isOpen(t.status));
    const keyOf = (t: Task) => (anchorOf(t) ? dateKey(anchorOf(t)!, tz) : null);
    const dueKey = (t: Task) => (t.due_at ? dateKey(t.due_at, tz) : null);
    const overdue = open.filter((t) => t.status === "overdue");
    const todays = open.filter((t) => t.status !== "overdue" && (keyOf(t) === today || dueKey(t) === today || (keyOf(t) !== null && keyOf(t)! < today)));
    const upcoming = open.filter((t) => t.status !== "overdue" && keyOf(t) !== null && keyOf(t)! > today && dueKey(t) !== today);
    const noDate = open.filter((t) => keyOf(t) === null);
    const completed = all.filter((t) => t.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    const completedToday = completed.filter((t) => t.completed_at && dateKey(t.completed_at, tz) === today);
    const cancelled = all.filter((t) => t.status === "cancelled");
    const pending = open.filter((t) => t.status === "pending");
    const inProgress = open.filter((t) => t.status === "in_progress");
    const deadlines = open
      .filter((t) => t.due_at && dateKey(t.due_at, tz) >= today && dateKey(t.due_at, tz) <= addDaysKey(today, 7))
      .sort((a, b) => a.due_at!.localeCompare(b.due_at!));
    return { tz, today, all, open, overdue, todays, upcoming, noDate, completed, completedToday, cancelled, pending, inProgress, deadlines, isLoading, error, keyOf };
  }, [tasks, tz, isLoading, error]);
}
