"use client";
// Data access layer: React Query hooks over supabase-js. Every query is scoped by
// Postgres RLS to the signed-in user; filters here are for relevance, not security.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "./supabase/client";
import { DEFAULT_TIMEZONE, OPEN_STATUSES } from "./constants";
import { errorMessage } from "./utils";
import type {
  Achievement, AppNotification, Category, FocusSession, Goal, Habit, HabitLog, HistoryEvent, Milestone,
  NotificationPreferences, Profile, Project, PushSubscriptionRow, Subtask, Task, TaskAction,
} from "./types";

const sb = () => supabase();

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------------------------------------------------------------- session / profile
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await sb().auth.getUser();
      return data.user ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => unwrap<Profile>(sb().from("profiles").select("*").single()),
    staleTime: 5 * 60_000,
  });
}

/** The user's timezone (falls back to Asia/Karachi while loading). */
export function useTz(): string {
  return useProfile().data?.timezone ?? DEFAULT_TIMEZONE;
}

export function usePrefs() {
  return useQuery({
    queryKey: ["prefs"],
    queryFn: () => unwrap<NotificationPreferences>(sb().from("notification_preferences").select("*").single()),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      const { data: u } = await sb().auth.getUser();
      return unwrap<Profile>(sb().from("profiles").update(patch).eq("id", u.user!.id).select().single());
    },
    onSuccess: (p) => {
      qc.setQueryData(["profile"], p);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useUpdatePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NotificationPreferences>) => {
      const { data: u } = await sb().auth.getUser();
      return unwrap<NotificationPreferences>(
        sb().from("notification_preferences").update(patch).eq("user_id", u.user!.id).select().single(),
      );
    },
    onMutate: async (patch) => {
      const prev = qc.getQueryData<NotificationPreferences>(["prefs"]);
      if (prev) qc.setQueryData(["prefs"], { ...prev, ...patch });
      return { prev };
    },
    onError: (e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(["prefs"], ctx.prev);
      toast.error(errorMessage(e));
    },
    onSuccess: (p) => qc.setQueryData(["prefs"], p),
  });
}

// ---------------------------------------------------------------- organisation
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => unwrap<Category[]>(sb().from("categories").select("*").order("name")),
    staleTime: 10 * 60_000,
  });
}
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => unwrap<Project[]>(sb().from("projects").select("*").order("created_at")),
    staleTime: 5 * 60_000,
  });
}

export function useUpsertCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Partial<Category> & { name: string }) =>
      c.id
        ? unwrap<Category>(sb().from("categories").update({ name: c.name, color: c.color }).eq("id", c.id).select().single())
        : unwrap<Category>(sb().from("categories").insert({ name: c.name, color: c.color }).select().single()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}
export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(sb().from("categories").delete().eq("id", id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}
export function useUpsertProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Partial<Project> & { name: string }) => {
      const row = { name: p.name, description: p.description ?? null, color: p.color, category_id: p.category_id ?? null, archived_at: p.archived_at ?? null };
      return p.id
        ? unwrap<Project>(sb().from("projects").update(row).eq("id", p.id).select().single())
        : unwrap<Project>(sb().from("projects").insert(row).select().single());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(sb().from("projects").delete().eq("id", id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

// ---------------------------------------------------------------- tasks
const RECENT_DAYS = 120;

/** All open tasks + tasks closed in the last 120 days. Views filter client-side. */
export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () => {
      const since = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString();
      return unwrap<Task[]>(
        sb().from("tasks").select("*")
          .or(`status.in.(${OPEN_STATUSES.join(",")}),updated_at.gte.${since}`)
          .order("scheduled_at", { ascending: true, nullsFirst: false })
          .limit(5000),
      );
    },
  });
}

export function useSearchTasks(term: string) {
  return useQuery({
    queryKey: ["tasks", "search", term],
    enabled: term.trim().length >= 2,
    queryFn: () => {
      const t = term.trim().replace(/[%,()]/g, " ");
      return unwrap<Task[]>(
        sb().from("tasks").select("*")
          .or(`title.ilike.%${t}%,description.ilike.%${t}%,notes.ilike.%${t}%`)
          .order("updated_at", { ascending: false }).limit(50),
      );
    },
  });
}

export function useSubtasks(taskId: string | null | undefined) {
  return useQuery({
    queryKey: ["subtasks", taskId],
    enabled: !!taskId,
    queryFn: () => unwrap<Subtask[]>(sb().from("subtasks").select("*").eq("task_id", taskId!).order("position")),
  });
}

/** done/total per task, for list badges. */
export function useSubtaskSummary() {
  return useQuery({
    queryKey: ["subtasks", "summary"],
    queryFn: async () => {
      const rows = await unwrap<{ task_id: string; done: boolean }[]>(sb().from("subtasks").select("task_id,done").limit(10000));
      const map = new Map<string, { done: number; total: number }>();
      for (const r of rows) {
        const m = map.get(r.task_id) ?? { done: 0, total: 0 };
        m.total++;
        if (r.done) m.done++;
        map.set(r.task_id, m);
      }
      return map;
    },
  });
}

export type TaskInput = Partial<Omit<Task, "id" | "user_id" | "created_at" | "updated_at" | "next_reminder_at" | "reminder_count" | "last_reminded_at" | "snoozed_until" | "time_spent_seconds" | "completed_at" | "cancelled_at" | "series_id">> & { title?: string };

function invalidateTaskViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["tasks"] });
  qc.invalidateQueries({ queryKey: ["goals"] });
  qc.invalidateQueries({ queryKey: ["history"] });
  qc.invalidateQueries({ queryKey: ["streaks"] });
  qc.invalidateQueries({ queryKey: ["analytics"] });
  qc.invalidateQueries({ queryKey: ["achievements"] });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TaskInput & { title: string; subtasks?: string[] }) => {
      const { subtasks, ...row } = input;
      const task = await unwrap<Task>(sb().from("tasks").insert(row).select().single());
      if (subtasks?.length) {
        await unwrap(sb().from("subtasks").insert(subtasks.map((title, i) => ({ task_id: task.id, title, position: i }))));
      }
      return task;
    },
    onSuccess: (task) => {
      qc.setQueryData<Task[]>(["tasks"], (old) => (old ? [...old, task] : old));
      invalidateTaskViews(qc);
      qc.invalidateQueries({ queryKey: ["subtasks"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TaskInput }) =>
      unwrap<Task>(sb().from("tasks").update(patch).eq("id", id).select().single()),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      if (prev) qc.setQueryData<Task[]>(["tasks"], prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Task) : t)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks"], ctx.prev);
      toast.error(errorMessage(e));
    },
    onSuccess: (task) => qc.setQueryData<Task[]>(["tasks"], (old) => old?.map((t) => (t.id === task.id ? task : t))),
    onSettled: () => invalidateTaskViews(qc),
  });
}

export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; action: TaskAction; minutes?: number; scope?: "occurrence" | "series" }) =>
      unwrap<{ id: string; status: Task["status"]; next_reminder_at: string | null }>(
        sb().rpc("task_action", { p_task_id: v.id, p_action: v.action, p_minutes: v.minutes ?? null, p_scope: v.scope ?? "occurrence" }),
      ),
    onMutate: async ({ id, action }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      const status = action === "complete" ? "completed" : action === "cancel" ? "cancelled" : action === "start" ? "in_progress" : null;
      if (prev && status) {
        qc.setQueryData<Task[]>(["tasks"], prev.map((t) => (t.id === id ? { ...t, status, next_reminder_at: null } : t)));
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks"], ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => invalidateTaskViews(qc),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(sb().from("tasks").delete().eq("id", id)),
    onMutate: async (id) => {
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      if (prev) qc.setQueryData<Task[]>(["tasks"], prev.filter((t) => t.id !== id));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks"], ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => invalidateTaskViews(qc),
  });
}

export function useDuplicateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Task) => {
      const copy: TaskInput & { title: string } = {
        title: `${t.title} (copy)`, description: t.description, notes: t.notes, category_id: t.category_id,
        project_id: t.project_id, goal_id: t.goal_id, priority: t.priority, status: "pending",
        scheduled_at: t.scheduled_at, due_at: t.due_at, estimated_minutes: t.estimated_minutes, tags: t.tags,
        recurrence: t.recurrence, reminder_enabled: t.reminder_enabled,
      };
      const created = await unwrap<Task>(sb().from("tasks").insert(copy).select().single());
      const subs = await unwrap<Subtask[]>(sb().from("subtasks").select("*").eq("task_id", t.id));
      if (subs.length) {
        await unwrap(sb().from("subtasks").insert(subs.map((s) => ({ task_id: created.id, title: s.title, position: s.position }))));
      }
      return created;
    },
    onSuccess: () => {
      invalidateTaskViews(qc);
      qc.invalidateQueries({ queryKey: ["subtasks"] });
      toast.success("Task duplicated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useSubtaskMutations(taskId: string) {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["subtasks", taskId] });
    qc.invalidateQueries({ queryKey: ["subtasks", "summary"] });
  };
  return {
    add: useMutation({
      mutationFn: async ({ title, position }: { title: string; position: number }) =>
        unwrap(sb().from("subtasks").insert({ task_id: taskId, title, position })),
      onSuccess: done, onError: (e) => toast.error(errorMessage(e)),
    }),
    toggle: useMutation({
      mutationFn: async ({ id, done: d }: { id: string; done: boolean }) => unwrap(sb().from("subtasks").update({ done: d }).eq("id", id)),
      onMutate: ({ id, done: d }) => {
        qc.setQueryData<Subtask[]>(["subtasks", taskId], (old) => old?.map((s) => (s.id === id ? { ...s, done: d } : s)));
      },
      onSettled: done,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(sb().from("subtasks").delete().eq("id", id)),
      onSuccess: done,
    }),
  };
}

// ---------------------------------------------------------------- goals
export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: () => unwrap<Goal[]>(sb().from("goals").select("*").order("due_date", { ascending: true }).limit(1000)),
  });
}
export function useMilestones(goalId?: string) {
  return useQuery({
    queryKey: ["milestones", goalId ?? "all"],
    queryFn: () => {
      let q = sb().from("goal_milestones").select("*").order("position");
      if (goalId) q = q.eq("goal_id", goalId);
      return unwrap<Milestone[]>(q);
    },
  });
}
export type GoalInput = Partial<Omit<Goal, "id" | "user_id" | "created_at" | "completed_at">>;
export function useUpsertGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...g }: GoalInput & { id?: string }) =>
      id
        ? unwrap<Goal>(sb().from("goals").update(g).eq("id", id).select().single())
        : unwrap<Goal>(sb().from("goals").insert(g).select().single()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["achievements"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(sb().from("goals").delete().eq("id", id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
export function useMilestoneMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["milestones"] });
    qc.invalidateQueries({ queryKey: ["goals"] });
  };
  return {
    add: useMutation({
      mutationFn: async (m: { goal_id: string; title: string; position: number; target_date?: string | null }) =>
        unwrap(sb().from("goal_milestones").insert(m)),
      onSuccess: done, onError: (e) => toast.error(errorMessage(e)),
    }),
    toggle: useMutation({
      mutationFn: async ({ id, done: d }: { id: string; done: boolean }) => unwrap(sb().from("goal_milestones").update({ done: d }).eq("id", id)),
      onSuccess: done, onError: (e) => toast.error(errorMessage(e)),
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(sb().from("goal_milestones").delete().eq("id", id)),
      onSuccess: done,
    }),
  };
}

// ---------------------------------------------------------------- habits
export function useHabits() {
  return useQuery({
    queryKey: ["habits"],
    queryFn: () => unwrap<Habit[]>(sb().from("habits").select("*").is("archived_at", null).order("created_at")),
  });
}
export function useHabitLogs(fromKey: string, toKey: string) {
  return useQuery({
    queryKey: ["habit_logs", fromKey, toKey],
    queryFn: () => unwrap<HabitLog[]>(sb().from("habit_logs").select("id,habit_id,log_date,count").gte("log_date", fromKey).lte("log_date", toKey)),
  });
}
export function useHabitMutations() {
  const qc = useQueryClient();
  return {
    upsert: useMutation({
      mutationFn: async ({ id, ...h }: Partial<Habit> & { name: string }) =>
        id ? unwrap(sb().from("habits").update(h).eq("id", id)) : unwrap(sb().from("habits").insert(h)),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["habits"] }),
      onError: (e) => toast.error(errorMessage(e)),
    }),
    archive: useMutation({
      mutationFn: async (id: string) => unwrap(sb().from("habits").update({ archived_at: new Date().toISOString() }).eq("id", id)),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["habits"] }),
    }),
    log: useMutation({
      mutationFn: async (v: { habitId: string; date: string; delta: number }) =>
        unwrap<number>(sb().rpc("log_habit", { p_habit_id: v.habitId, p_date: v.date, p_delta: v.delta })),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["habit_logs"] });
        qc.invalidateQueries({ queryKey: ["analytics"] });
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  };
}

// ---------------------------------------------------------------- focus sessions
export function useFocusSessions(sinceIso: string) {
  return useQuery({
    queryKey: ["focus_sessions", sinceIso],
    queryFn: () => unwrap<FocusSession[]>(sb().from("focus_sessions").select("*").gte("started_at", sinceIso).order("started_at", { ascending: false }).limit(500)),
  });
}
export function useLogFocusSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: Omit<FocusSession, "id">) => unwrap(sb().from("focus_sessions").insert(s)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["focus_sessions"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

// ---------------------------------------------------------------- notifications
export function useNotifications(limit = 100) {
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: () =>
      unwrap<AppNotification[]>(
        sb().from("notifications").select("*").neq("status", "superseded").order("created_at", { ascending: false }).limit(limit),
      ),
    refetchInterval: 60_000,
  });
}
export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const { count, error } = await sb().from("notifications").select("id", { count: "exact", head: true })
        .is("read_at", null).neq("status", "superseded");
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => unwrap<number>(sb().rpc("mark_notifications_read", { p_ids: ids ?? null })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(sb().from("notifications").delete().eq("id", id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
export function usePushSubscriptions() {
  return useQuery({
    queryKey: ["push_subscriptions"],
    queryFn: () => unwrap<PushSubscriptionRow[]>(sb().from("push_subscriptions").select("id,endpoint,user_agent,device_label,created_at,last_success_at,last_failure_at,failure_count,disabled_at,disabled_reason").order("created_at", { ascending: false })),
  });
}

// ---------------------------------------------------------------- history / analytics / achievements
export function useHistory(sinceIso: string) {
  return useQuery({
    queryKey: ["history", sinceIso],
    queryFn: () => unwrap<HistoryEvent[]>(sb().from("task_completion_history").select("*").gte("occurred_at", sinceIso).order("occurred_at", { ascending: false }).limit(2000)),
  });
}
export function useAnalytics(days: number) {
  return useQuery({
    queryKey: ["analytics", days],
    queryFn: () => unwrap<{ day: string; completed: number; created: number; cancelled: number; focus_minutes: number; habits_done: number }[]>(
      sb().rpc("analytics_daily", { p_days: days }),
    ),
  });
}
export function useStreaks() {
  return useQuery({
    queryKey: ["streaks"],
    queryFn: async () => {
      const rows = await unwrap<{ current_streak: number; best_streak: number; today_completed: number }[]>(sb().rpc("my_streaks"));
      return rows[0] ?? { current_streak: 0, best_streak: 0, today_completed: 0 };
    },
  });
}
export function useAchievements() {
  return useQuery({
    queryKey: ["achievements"],
    queryFn: () => unwrap<Achievement[]>(sb().from("achievements").select("*").order("earned_at", { ascending: false }).limit(500)),
  });
}
