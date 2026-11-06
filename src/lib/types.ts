// Row types mirroring supabase/migrations (kept by hand; regenerate with
// `npx supabase gen types typescript --linked` if you prefer generated types).

export type Priority = "critical" | "high" | "medium" | "low";
export type TaskStatus = "upcoming" | "pending" | "in_progress" | "completed" | "cancelled" | "overdue";
export type GoalStatus = "not_started" | "in_progress" | "completed" | "at_risk" | "cancelled";
export type GoalPeriod = "weekly" | "monthly";
export type ProgressMode = "target" | "manual" | "milestones" | "tasks" | "children";
export type RecurrenceFreq = "daily" | "weekdays" | "weekly" | "monthly" | "custom";

export interface Recurrence {
  freq: RecurrenceFreq;
  interval?: number;
  byweekday?: number[]; // ISO 1=Mon … 7=Sun
  until?: string; // YYYY-MM-DD
}

export interface Profile {
  id: string;
  display_name: string | null;
  timezone: string;
  theme: "system" | "light" | "dark";
  week_starts_on: number;
  pomodoro_focus_min: number;
  pomodoro_short_min: number;
  pomodoro_long_min: number;
  pomodoro_long_every: number;
}

export interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean;
  in_app_enabled: boolean;
  reminder_interval_minutes: number;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  daily_limit: number | null;
  goal_reminder_frequency: "off" | "daily" | "every_other_day" | "weekly";
  goal_checkin_time: string;
  morning_summary_enabled: boolean;
  morning_summary_time: string;
  evening_summary_enabled: boolean;
  evening_summary_time: string;
  weekly_review_enabled: boolean;
  monthly_review_enabled: boolean;
  deadline_warning_hours: number;
  habit_reminders_enabled: boolean;
  sound_enabled: boolean;
  vibrate_enabled: boolean;
  require_interaction: boolean;
  celebrations_enabled: boolean;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  category_id: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  notes: string | null;
  category_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  priority: Priority;
  status: TaskStatus;
  scheduled_at: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  tags: string[];
  recurrence: Recurrence | null;
  series_id: string | null;
  reminder_enabled: boolean;
  next_reminder_at: string | null;
  reminder_count: number;
  last_reminded_at: string | null;
  snoozed_until: string | null;
  time_spent_seconds: number;
  sort_order: number;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  user_id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  period: GoalPeriod;
  category_id: string | null;
  parent_goal_id: string | null;
  start_date: string;
  due_date: string;
  priority: Priority;
  status: GoalStatus;
  progress_mode: ProgressMode;
  target_value: number | null;
  current_value: number;
  unit: string | null;
  progress_pct: number;
  reminder_frequency: "default" | "off" | "daily" | "weekly";
  completed_at: string | null;
  celebrated_at: string | null;
  created_at: string;
}

export interface Milestone {
  id: string;
  goal_id: string;
  user_id: string;
  title: string;
  target_date: string | null;
  done: boolean;
  done_at: string | null;
  position: number;
}

export type NotificationKind =
  | "task_reminder" | "morning_summary" | "evening_summary" | "goal_checkin" | "weekly_review"
  | "monthly_review" | "goal_deadline" | "habit_reminder" | "achievement" | "system";

export interface AppNotification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  task_id: string | null;
  goal_id: string | null;
  title: string;
  body: string;
  url: string;
  status: "queued" | "sending" | "sent" | "partial" | "failed" | "no_channel" | "superseded";
  scheduled_for: string;
  sent_at: string | null;
  read_at: string | null;
  action_taken: string | null;
  created_at: string;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  user_agent: string | null;
  device_label: string | null;
  created_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  disabled_at: string | null;
  disabled_reason: string | null;
}

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  days: number[];
  target_per_day: number;
  reminder_time: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  log_date: string;
  count: number;
}

export interface FocusSession {
  id: string;
  task_id: string | null;
  kind: "focus" | "short_break" | "long_break" | "task_timer";
  started_at: string;
  ended_at: string | null;
  planned_seconds: number | null;
  actual_seconds: number;
  completed: boolean;
}

export interface Achievement {
  id: string;
  kind: "goal_completed" | "badge";
  code: string;
  title: string;
  description: string | null;
  goal_id: string | null;
  earned_at: string;
}

export interface HistoryEvent {
  id: number;
  task_id: string | null;
  task_title: string;
  goal_id: string | null;
  event: "completed" | "cancelled" | "reopened" | "snoozed" | "acknowledged" | "rescheduled";
  source: "app" | "notification" | "system";
  occurred_at: string;
}

export type TaskAction = "complete" | "pending" | "cancel" | "snooze" | "snooze_tomorrow" | "start" | "reopen";
