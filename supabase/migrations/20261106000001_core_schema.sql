-- =====================================================================
-- Cadence · 001 · Core schema
-- Tables, constraints and indexes. Logic lives in 002/003, security in 004.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ---------------------------------------------------------------------
-- Profiles & preferences
-- ---------------------------------------------------------------------
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  display_name           text check (char_length(display_name) <= 80),
  timezone               text not null default 'Asia/Karachi',
  theme                  text not null default 'system' check (theme in ('system', 'light', 'dark')),
  week_starts_on         smallint not null default 1 check (week_starts_on between 0 and 6),
  pomodoro_focus_min     smallint not null default 25 check (pomodoro_focus_min between 5 and 180),
  pomodoro_short_min     smallint not null default 5  check (pomodoro_short_min between 1 and 60),
  pomodoro_long_min      smallint not null default 15 check (pomodoro_long_min between 1 and 90),
  pomodoro_long_every    smallint not null default 4  check (pomodoro_long_every between 2 and 12),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.notification_preferences (
  user_id                    uuid primary key references auth.users (id) on delete cascade,
  push_enabled               boolean not null default true,
  in_app_enabled             boolean not null default true,
  reminder_interval_minutes  integer not null default 60 check (reminder_interval_minutes between 5 and 1440),
  quiet_hours_enabled        boolean not null default false,
  quiet_start                time    not null default '22:30',
  quiet_end                  time    not null default '07:00',
  daily_limit                integer check (daily_limit is null or daily_limit between 1 and 500),
  goal_reminder_frequency    text    not null default 'daily'
                               check (goal_reminder_frequency in ('off', 'daily', 'every_other_day', 'weekly')),
  goal_checkin_time          time    not null default '18:00',
  morning_summary_enabled    boolean not null default true,
  morning_summary_time       time    not null default '08:00',
  evening_summary_enabled    boolean not null default true,
  evening_summary_time       time    not null default '21:30',
  weekly_review_enabled      boolean not null default true,
  monthly_review_enabled     boolean not null default true,
  deadline_warning_hours     integer not null default 24 check (deadline_warning_hours between 1 and 168),
  habit_reminders_enabled    boolean not null default true,
  sound_enabled              boolean not null default true,
  vibrate_enabled            boolean not null default true,
  require_interaction        boolean not null default true,
  celebrations_enabled       boolean not null default true,
  updated_at                 timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now()
);
create unique index categories_user_name_uq on public.categories (user_id, lower(name));

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  description  text check (char_length(description) <= 2000),
  color        text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  category_id  uuid references public.categories (id) on delete set null,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index projects_user_name_uq on public.projects (user_id, lower(name));

-- ---------------------------------------------------------------------
-- Goals (weekly / monthly) & milestones
-- ---------------------------------------------------------------------
create table public.goals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 200),
  description        text check (char_length(description) <= 5000),
  period             text not null check (period in ('weekly', 'monthly')),
  category_id        uuid references public.categories (id) on delete set null,
  parent_goal_id     uuid references public.goals (id) on delete set null,
  start_date         date not null,
  due_date           date not null,
  priority           text not null default 'medium' check (priority in ('critical', 'high', 'medium', 'low')),
  status             text not null default 'not_started'
                       check (status in ('not_started', 'in_progress', 'completed', 'at_risk', 'cancelled')),
  progress_mode      text not null default 'tasks'
                       check (progress_mode in ('target', 'manual', 'milestones', 'tasks', 'children')),
  target_value       numeric(12, 2) check (target_value is null or target_value > 0),
  current_value      numeric(12, 2) not null default 0 check (current_value >= 0),
  unit               text check (char_length(unit) <= 30),
  progress_pct       numeric(5, 2) not null default 0 check (progress_pct between 0 and 100),
  reminder_frequency text not null default 'default'
                       check (reminder_frequency in ('default', 'off', 'daily', 'weekly')),
  completed_at       timestamptz,
  celebrated_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint goals_dates_chk check (due_date >= start_date),
  constraint goals_parent_not_self check (parent_goal_id is null or parent_goal_id <> id),
  constraint goals_target_mode_chk check (progress_mode <> 'target' or target_value is not null)
);
create index goals_user_status_idx on public.goals (user_id, status, due_date);
create index goals_parent_idx on public.goals (parent_goal_id) where parent_goal_id is not null;

create table public.goal_milestones (
  id           uuid primary key default gen_random_uuid(),
  goal_id      uuid not null references public.goals (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  target_date  date,
  done         boolean not null default false,
  done_at      timestamptz,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index goal_milestones_goal_idx on public.goal_milestones (goal_id, position);

-- ---------------------------------------------------------------------
-- Tasks & subtasks
-- ---------------------------------------------------------------------
create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                 text not null check (char_length(title) between 1 and 300),
  description           text check (char_length(description) <= 10000),
  notes                 text check (char_length(notes) <= 10000),
  category_id           uuid references public.categories (id) on delete set null,
  project_id            uuid references public.projects (id) on delete set null,
  goal_id               uuid references public.goals (id) on delete set null,
  priority              text not null default 'medium' check (priority in ('critical', 'high', 'medium', 'low')),
  status                text not null default 'pending'
                          check (status in ('upcoming', 'pending', 'in_progress', 'completed', 'cancelled', 'overdue')),
  scheduled_at          timestamptz,            -- task date + start / reminder time
  due_at                timestamptz,            -- deadline
  estimated_minutes     integer check (estimated_minutes is null or estimated_minutes between 1 and 10080),
  tags                  text[] not null default '{}'
                          check (cardinality(tags) <= 20),
  recurrence            jsonb,                  -- {freq, interval, byweekday[], until}
  series_id             uuid,                   -- shared by all occurrences of a recurring task
  reminder_enabled      boolean not null default true,
  next_reminder_at      timestamptz,
  reminder_count        integer not null default 0,
  last_reminded_at      timestamptz,
  snoozed_until         timestamptz,
  time_spent_seconds    integer not null default 0 check (time_spent_seconds >= 0),
  sort_order            double precision not null default 0,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- A finished task can NEVER hold a pending reminder. Enforced by the database itself.
  constraint tasks_no_reminder_when_closed
    check (status not in ('completed', 'cancelled') or next_reminder_at is null),
  constraint tasks_recurrence_shape check (
    recurrence is null or (
      jsonb_typeof(recurrence) = 'object'
      and recurrence ->> 'freq' in ('daily', 'weekdays', 'weekly', 'monthly', 'custom')
    )
  )
);

-- Hot path for the scheduler: only active tasks with a pending reminder.
create index tasks_due_reminders_idx on public.tasks (next_reminder_at)
  where next_reminder_at is not null and reminder_enabled
    and status in ('upcoming', 'pending', 'in_progress', 'overdue');
create index tasks_user_scheduled_idx on public.tasks (user_id, scheduled_at);
create index tasks_user_due_idx       on public.tasks (user_id, due_at) where due_at is not null;
create index tasks_user_status_idx    on public.tasks (user_id, status);
create index tasks_goal_idx           on public.tasks (goal_id) where goal_id is not null;
create index tasks_project_idx        on public.tasks (project_id) where project_id is not null;
create index tasks_status_refresh_idx on public.tasks (status, scheduled_at, due_at)
  where status in ('upcoming', 'pending', 'in_progress', 'overdue');
create index tasks_tags_gin           on public.tasks using gin (tags);
create index tasks_title_trgm         on public.tasks using gin (title extensions.gin_trgm_ops);

create table public.subtasks (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 300),
  done        boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index subtasks_task_idx on public.subtasks (task_id, position);

create table public.task_completion_history (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  task_id      uuid references public.tasks (id) on delete set null,
  task_title   text not null,
  goal_id      uuid references public.goals (id) on delete set null,
  event        text not null check (event in ('completed', 'cancelled', 'reopened', 'snoozed', 'acknowledged', 'rescheduled')),
  source       text not null default 'app' check (source in ('app', 'notification', 'system')),
  occurred_at  timestamptz not null default now(),
  meta         jsonb not null default '{}'
);
create index tch_user_time_idx on public.task_completion_history (user_id, occurred_at desc);
create index tch_task_idx on public.task_completion_history (task_id);

-- ---------------------------------------------------------------------
-- Notifications: queue + delivery log + in-app inbox
-- ---------------------------------------------------------------------
create table public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  kind               text not null check (kind in (
                        'task_reminder', 'morning_summary', 'evening_summary', 'goal_checkin',
                        'weekly_review', 'monthly_review', 'goal_deadline', 'habit_reminder',
                        'achievement', 'system')),
  task_id            uuid references public.tasks (id) on delete set null,
  goal_id            uuid references public.goals (id) on delete set null,
  habit_id           uuid,
  title              text not null,
  body               text not null default '',
  url                text not null default '/dashboard',
  dedupe_key         text not null,
  scheduled_for      timestamptz not null default now(),
  status             text not null default 'queued' check (status in (
                        'queued', 'sending', 'sent', 'partial', 'failed', 'no_channel', 'superseded')),
  attempts           integer not null default 0,
  lease_until        timestamptz,
  last_error         text,
  sent_at            timestamptz,
  read_at            timestamptz,
  action_taken       text check (action_taken in ('complete', 'pending', 'cancel', 'snooze')),
  action_at          timestamptz,
  created_at         timestamptz not null default now(),
  constraint notifications_dedupe_uq unique (dedupe_key)
);
create index notifications_dispatch_idx on public.notifications (scheduled_for)
  where status in ('queued', 'sending');
create index notifications_user_time_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_user_sched_idx on public.notifications (user_id, scheduled_for);
create index notifications_task_idx on public.notifications (task_id) where task_id is not null;

create table public.push_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  endpoint          text not null unique check (endpoint ~ '^https://'),
  p256dh            text not null,
  auth              text not null,
  user_agent        text,
  device_label      text,
  created_at        timestamptz not null default now(),
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  failure_count     integer not null default 0,
  disabled_at       timestamptz,
  disabled_reason   text
);
create index push_subscriptions_user_active_idx on public.push_subscriptions (user_id) where disabled_at is null;

create table public.notification_deliveries (
  id               bigint generated always as identity primary key,
  notification_id  uuid not null references public.notifications (id) on delete cascade,
  subscription_id  uuid references public.push_subscriptions (id) on delete set null,
  attempt          integer not null,
  ok               boolean not null,
  status_code      integer,
  error            text,
  created_at       timestamptz not null default now()
);
create index notification_deliveries_notif_idx on public.notification_deliveries (notification_id);

-- ---------------------------------------------------------------------
-- Habits
-- ---------------------------------------------------------------------
create table public.habits (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 120),
  description     text check (char_length(description) <= 2000),
  color           text not null default '#10b981' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- ISO weekdays the habit is due on (1 = Monday … 7 = Sunday)
  days            smallint[] not null default '{1,2,3,4,5,6,7}'
                    check (cardinality(days) between 1 and 7 and days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  target_per_day  smallint not null default 1 check (target_per_day between 1 and 50),
  reminder_time   time,
  archived_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index habits_user_idx on public.habits (user_id) where archived_at is null;

create table public.habit_logs (
  id          uuid primary key default gen_random_uuid(),
  habit_id    uuid not null references public.habits (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date    date not null,
  count       smallint not null default 1 check (count between 0 and 50),
  created_at  timestamptz not null default now(),
  constraint habit_logs_uq unique (habit_id, log_date)
);
create index habit_logs_user_date_idx on public.habit_logs (user_id, log_date);

-- ---------------------------------------------------------------------
-- Focus / Pomodoro sessions
-- ---------------------------------------------------------------------
create table public.focus_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id          uuid references public.tasks (id) on delete set null,
  kind             text not null check (kind in ('focus', 'short_break', 'long_break', 'task_timer')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  planned_seconds  integer check (planned_seconds is null or planned_seconds > 0),
  actual_seconds   integer not null default 0 check (actual_seconds >= 0 and actual_seconds <= 86400),
  completed        boolean not null default false,
  created_at       timestamptz not null default now()
);
create index focus_sessions_user_time_idx on public.focus_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------
-- Achievements
-- ---------------------------------------------------------------------
create table public.achievements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('goal_completed', 'badge')),
  code         text not null,
  title        text not null,
  description  text,
  goal_id      uuid references public.goals (id) on delete set null,
  earned_at    timestamptz not null default now(),
  constraint achievements_code_uq unique (user_id, code)
);
create index achievements_user_time_idx on public.achievements (user_id, earned_at desc);
