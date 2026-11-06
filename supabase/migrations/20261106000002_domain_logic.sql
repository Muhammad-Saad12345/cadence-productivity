-- =====================================================================
-- Cadence · 002 · Domain logic
-- Triggers that keep task/goal state consistent no matter which path
-- (app UI, notification action, scheduler) changes it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.is_valid_timezone(p_tz text)
returns boolean language sql stable as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz)
$$;

-- Clock used by all scheduling logic. Tests can pin it with
--   set cadence.now = '2026-11-06 10:00+05';
-- In production the setting is never set, so this is simply now().
create or replace function public.clock_now()
returns timestamptz language sql stable as $$
  select coalesce(nullif(current_setting('cadence.now', true), '')::timestamptz, now())
$$;

alter table public.task_completion_history alter column occurred_at set default public.clock_now();

-- Timezone of a user (falls back to Asia/Karachi).
create or replace function public.user_tz(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.profiles where id = p_user_id), 'Asia/Karachi')
$$;

-- Open-task status derived from its schedule.
create or replace function public.derive_open_status(p_scheduled timestamptz, p_due timestamptz, p_now timestamptz)
returns text language sql immutable as $$
  select case
    when p_due is not null and p_due < p_now then 'overdue'
    when p_scheduled is not null and p_scheduled > p_now then 'upcoming'
    else 'pending'
  end
$$;

-- ---------------------------------------------------------------------
-- New user bootstrap
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'Asia/Karachi');
begin
  if not public.is_valid_timezone(v_tz) then
    v_tz := 'Asia/Karachi';
  end if;

  insert into public.profiles (id, display_name, timezone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    v_tz
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;

  insert into public.categories (user_id, name, color) values
    (new.id, 'Work',     '#6366f1'),
    (new.id, 'Study',    '#0ea5e9'),
    (new.id, 'Personal', '#10b981'),
    (new.id, 'Health',   '#f43f5e')
  on conflict do nothing;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.profiles_before_write()
returns trigger language plpgsql as $$
begin
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'invalid_timezone: %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

create trigger projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Ownership guard: a row may only reference rows owned by the same user.
-- (FKs alone would let a user attach their task to someone else's goal.)
-- ---------------------------------------------------------------------
create or replace function public.assert_same_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_bad text;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable' using errcode = '42501';
  end if;

  case tg_table_name
    when 'tasks' then
      if new.category_id is not null and not exists (select 1 from public.categories where id = new.category_id and user_id = new.user_id) then v_bad := 'category'; end if;
      if new.project_id  is not null and not exists (select 1 from public.projects   where id = new.project_id  and user_id = new.user_id) then v_bad := 'project';  end if;
      if new.goal_id     is not null and not exists (select 1 from public.goals      where id = new.goal_id     and user_id = new.user_id) then v_bad := 'goal';     end if;
    when 'subtasks' then
      if not exists (select 1 from public.tasks where id = new.task_id and user_id = new.user_id) then v_bad := 'task'; end if;
    when 'goals' then
      if new.category_id    is not null and not exists (select 1 from public.categories where id = new.category_id    and user_id = new.user_id) then v_bad := 'category'; end if;
      if new.parent_goal_id is not null and not exists (select 1 from public.goals      where id = new.parent_goal_id and user_id = new.user_id and period = 'monthly') then v_bad := 'parent_goal'; end if;
    when 'goal_milestones' then
      if not exists (select 1 from public.goals where id = new.goal_id and user_id = new.user_id) then v_bad := 'goal'; end if;
    when 'projects' then
      if new.category_id is not null and not exists (select 1 from public.categories where id = new.category_id and user_id = new.user_id) then v_bad := 'category'; end if;
    when 'habit_logs' then
      if not exists (select 1 from public.habits where id = new.habit_id and user_id = new.user_id) then v_bad := 'habit'; end if;
    when 'focus_sessions' then
      if new.task_id is not null and not exists (select 1 from public.tasks where id = new.task_id and user_id = new.user_id) then v_bad := 'task'; end if;
    else null;
  end case;

  if v_bad is not null then
    raise exception 'invalid_reference: % does not belong to this user', v_bad using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tasks_owner_guard           before insert or update on public.tasks           for each row execute function public.assert_same_owner();
create trigger subtasks_owner_guard        before insert or update on public.subtasks        for each row execute function public.assert_same_owner();
create trigger goals_owner_guard           before insert or update on public.goals           for each row execute function public.assert_same_owner();
create trigger goal_milestones_owner_guard before insert or update on public.goal_milestones for each row execute function public.assert_same_owner();
create trigger projects_owner_guard        before insert or update on public.projects        for each row execute function public.assert_same_owner();
create trigger habit_logs_owner_guard      before insert or update on public.habit_logs      for each row execute function public.assert_same_owner();
create trigger focus_sessions_owner_guard  before insert or update on public.focus_sessions  for each row execute function public.assert_same_owner();

-- ---------------------------------------------------------------------
-- Recurrence
-- rule: {"freq": "daily|weekdays|weekly|monthly|custom",
--        "interval": 1, "byweekday": [1..7], "until": "YYYY-MM-DD"}
-- Computed in the user's local wall-clock time, so 09:00 stays 09:00.
-- ---------------------------------------------------------------------
create or replace function public.next_occurrence(p_from timestamptz, p_rule jsonb, p_tz text)
returns timestamptz language plpgsql immutable as $$
declare
  v_local     timestamp := p_from at time zone p_tz;
  v_freq      text      := p_rule ->> 'freq';
  v_interval  int       := greatest(1, coalesce((p_rule ->> 'interval')::int, 1));
  v_days      int[]     := coalesce(array(select jsonb_array_elements_text(coalesce(p_rule -> 'byweekday', '[]'::jsonb))::int), '{}');
  i           int;
begin
  if v_freq = 'daily' then
    v_local := v_local + make_interval(days => v_interval);
  elsif v_freq = 'weekdays' then
    loop
      v_local := v_local + interval '1 day';
      exit when extract(isodow from v_local) between 1 and 5;
    end loop;
  elsif v_freq in ('weekly', 'custom') and cardinality(v_days) > 0 then
    for i in 1..(7 * v_interval + 7) loop
      v_local := v_local + interval '1 day';
      exit when extract(isodow from v_local)::int = any (v_days);
    end loop;
  elsif v_freq = 'weekly' then
    v_local := v_local + make_interval(weeks => v_interval);
  elsif v_freq = 'monthly' then
    v_local := v_local + make_interval(months => v_interval);
  elsif v_freq = 'custom' then
    v_local := v_local + make_interval(days => v_interval);
  else
    return null;
  end if;
  return v_local at time zone p_tz;
end $$;

-- ---------------------------------------------------------------------
-- Tasks: BEFORE trigger — status & reminder invariants
-- ---------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger language plpgsql as $$
declare
  v_now       timestamptz := public.clock_now();
  v_anchor    timestamptz := coalesce(new.scheduled_at, new.due_at);
  v_closed_o  boolean;
  v_closed_n  boolean := new.status in ('completed', 'cancelled');
  v_resched   boolean;
begin
  new.title := btrim(new.title);
  new.tags := coalesce(
    (select array_agg(distinct lower(btrim(t))) from unnest(new.tags) t where btrim(t) <> ''),
    '{}');
  if new.recurrence is not null and new.series_id is null then
    new.series_id := new.id;
  end if;

  if tg_op = 'INSERT' then
    new.reminder_count   := 0;
    new.last_reminded_at := null;
    new.snoozed_until    := null;
    if v_closed_n then
      new.next_reminder_at := null;
      new.completed_at := case when new.status = 'completed' then coalesce(new.completed_at, v_now) end;
      new.cancelled_at := case when new.status = 'cancelled' then coalesce(new.cancelled_at, v_now) end;
    else
      new.completed_at := null;
      new.cancelled_at := null;
      if new.status <> 'in_progress' then
        new.status := public.derive_open_status(new.scheduled_at, new.due_at, v_now);
      end if;
      new.next_reminder_at := case when new.reminder_enabled then v_anchor end;
    end if;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------
  new.updated_at := v_now;
  v_closed_o := old.status in ('completed', 'cancelled');

  if v_closed_n then
    new.next_reminder_at := null;
    new.snoozed_until    := null;
    if new.status = 'completed' then
      new.completed_at := case when old.status = 'completed' then old.completed_at else v_now end;
      new.cancelled_at := null;
    else
      new.cancelled_at := case when old.status = 'cancelled' then old.cancelled_at else v_now end;
      new.completed_at := null;
    end if;
    return new;
  end if;

  -- Task is open.
  new.completed_at := null;
  new.cancelled_at := null;
  v_resched := new.scheduled_at is distinct from old.scheduled_at
            or new.due_at       is distinct from old.due_at;

  if v_closed_o or v_resched then
    new.reminder_count   := 0;
    new.snoozed_until    := null;
    new.next_reminder_at := case when new.reminder_enabled then v_anchor end;
  elsif new.reminder_enabled and not old.reminder_enabled then
    new.next_reminder_at := case when v_anchor is not null then greatest(v_anchor, v_now) end;
  end if;

  if not new.reminder_enabled then
    new.next_reminder_at := null;
    new.snoozed_until    := null;
  end if;

  if new.status <> 'in_progress' then
    new.status := public.derive_open_status(new.scheduled_at, new.due_at, v_now);
  end if;
  return new;
end $$;

create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- ---------------------------------------------------------------------
-- Goals: progress computation
-- ---------------------------------------------------------------------
create or replace function public.recompute_goal_progress(p_goal_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g      public.goals%rowtype;
  v_pct  numeric;
begin
  if p_goal_id is null then return; end if;
  select * into g from public.goals where id = p_goal_id;
  if not found or g.status in ('completed', 'cancelled') then return; end if;

  case g.progress_mode
    when 'milestones' then
      select coalesce(100.0 * count(*) filter (where done) / nullif(count(*), 0), 0)
        into v_pct from public.goal_milestones where goal_id = g.id;
    when 'tasks' then
      select coalesce(100.0 * count(*) filter (where status = 'completed')
                     / nullif(count(*) filter (where status <> 'cancelled'), 0), 0)
        into v_pct from public.tasks where goal_id = g.id;
    when 'children' then
      select coalesce(avg(case when status = 'completed' then 100 else progress_pct end), 0)
        into v_pct from public.goals where parent_goal_id = g.id and status <> 'cancelled';
    else
      return; -- target/manual are computed from their own columns
  end case;

  update public.goals
     set progress_pct = round(least(v_pct, 100), 2)
   where id = g.id and progress_pct is distinct from round(least(v_pct, 100), 2);
end $$;

create or replace function public.goals_before_write()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.progress_mode = 'target' then
    new.progress_pct := least(100, round(100 * new.current_value / new.target_value, 2));
  end if;

  if tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
    -- explicit or automatic completion
    new.completed_at := public.clock_now();
    if new.progress_pct < 100 then
      new.progress_pct := 100;
      if new.progress_mode = 'target' then new.current_value := new.target_value; end if;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    new.completed_at  := null;
    new.celebrated_at := null;
  end if;

  if new.status not in ('completed', 'cancelled') then
    if new.progress_pct >= 100 then
      new.status := 'completed';
      new.completed_at := public.clock_now();
    elsif new.status = 'not_started' and new.progress_pct > 0 then
      new.status := 'in_progress';
    end if;
  elsif new.status = 'completed' and new.completed_at is null then
    new.completed_at := public.clock_now();
  end if;
  return new;
end $$;

create trigger goals_before_write
  before insert or update on public.goals
  for each row execute function public.goals_before_write();

-- ---------------------------------------------------------------------
-- Streaks & badges
-- ---------------------------------------------------------------------
create or replace function public.user_streaks(p_user_id uuid)
returns table (current_streak int, best_streak int, today_completed int)
language sql stable security definer set search_path = '' as $$
  with tz as (select public.user_tz(p_user_id) as tz),
  days as (
    select distinct (h.occurred_at at time zone (select tz from tz))::date as d
    from public.task_completion_history h
    where h.user_id = p_user_id and h.event = 'completed'
  ),
  islands as (
    select d, d - (row_number() over (order by d))::int as grp from days
  ),
  runs as (
    select min(d) as start_d, max(d) as end_d, count(*)::int as len from islands group by grp
  ),
  today as (select (public.clock_now() at time zone (select tz from tz))::date as t)
  select
    coalesce((select len from runs where end_d >= (select t from today) - 1 order by end_d desc limit 1), 0),
    coalesce((select max(len) from runs), 0),
    (select count(*)::int from public.task_completion_history h
      where h.user_id = p_user_id and h.event = 'completed'
        and (h.occurred_at at time zone (select tz from tz))::date = (select t from today))
$$;

create or replace function public.award_badges(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tasks  int;
  v_goals  int;
  v_streak int;
  b        record;
begin
  select count(distinct task_id) into v_tasks
    from public.task_completion_history where user_id = p_user_id and event = 'completed';
  select count(*) into v_goals from public.goals where user_id = p_user_id and status = 'completed';
  select current_streak into v_streak from public.user_streaks(p_user_id);

  for b in
    select * from (values
      ('tasks_10',   'Getting things done', 'Completed 10 tasks',             v_tasks  >= 10),
      ('tasks_100',  'Centurion',           'Completed 100 tasks',            v_tasks  >= 100),
      ('tasks_500',  'Relentless',          'Completed 500 tasks',            v_tasks  >= 500),
      ('first_goal', 'First goal achieved', 'Completed your first goal',      v_goals  >= 1),
      ('goals_5',    'Goal setter',         'Completed 5 goals',              v_goals  >= 5),
      ('goals_25',   'Strategist',          'Completed 25 goals',             v_goals  >= 25),
      ('streak_3',   '3-day streak',        'Completed tasks 3 days in a row', v_streak >= 3),
      ('streak_7',   '7-day streak',        'Completed tasks 7 days in a row', v_streak >= 7),
      ('streak_30',  '30-day streak',       'Completed tasks 30 days in a row', v_streak >= 30)
    ) as x(code, title, description, earned)
    where earned
  loop
    insert into public.achievements (user_id, kind, code, title, description)
    values (p_user_id, 'badge', b.code, b.title, b.description)
    on conflict (user_id, code) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Tasks: AFTER trigger — history, recurrence, goal progress, badges
-- ---------------------------------------------------------------------
create or replace function public.spawn_next_occurrence(t public.tasks)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tz     text := public.user_tz(t.user_id);
  v_base   timestamptz := coalesce(t.scheduled_at, t.due_at);
  v_next   timestamptz;
  v_delta  interval;
  v_series uuid := coalesce(t.series_id, t.id);
  v_id     uuid;
  i        int := 0;
begin
  if t.recurrence is null or v_base is null then return null; end if;

  v_next := v_base;
  loop
    v_next := public.next_occurrence(v_next, t.recurrence, v_tz);
    i := i + 1;
    exit when v_next is null or v_next > public.clock_now() or i > 2000;
  end loop;
  if v_next is null then return null; end if;

  if t.recurrence ? 'until'
     and (v_next at time zone v_tz)::date > (t.recurrence ->> 'until')::date then
    return null;
  end if;

  -- Idempotent: never create the same occurrence twice.
  if exists (select 1 from public.tasks
              where series_id = v_series and id <> t.id
                and coalesce(scheduled_at, due_at) = v_next) then
    return null;
  end if;

  v_delta := v_next - v_base;
  insert into public.tasks (user_id, title, description, notes, category_id, project_id, goal_id,
                            priority, status, scheduled_at, due_at, estimated_minutes, tags,
                            recurrence, series_id, reminder_enabled, sort_order)
  values (t.user_id, t.title, t.description, t.notes, t.category_id, t.project_id, t.goal_id,
          t.priority, 'pending', t.scheduled_at + v_delta, t.due_at + v_delta, t.estimated_minutes, t.tags,
          t.recurrence, v_series, t.reminder_enabled, t.sort_order)
  returning id into v_id;

  insert into public.subtasks (task_id, user_id, title, done, position)
  select v_id, user_id, title, false, position from public.subtasks where task_id = t.id;

  return v_id;
end $$;

create or replace function public.tasks_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := coalesce(nullif(current_setting('cadence.action_source', true), ''), 'app');
  v_scope  text := coalesce(nullif(current_setting('cadence.cancel_scope', true), ''), 'occurrence');
begin
  if tg_op = 'DELETE' then
    perform public.recompute_goal_progress(old.goal_id);
    return old;
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    insert into public.task_completion_history (user_id, task_id, task_title, goal_id, event, source)
    values (new.user_id, new.id, new.title, new.goal_id, 'completed', v_source);
    perform public.spawn_next_occurrence(new);
    perform public.award_badges(new.user_id);
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' then
    insert into public.task_completion_history (user_id, task_id, task_title, goal_id, event, source, meta)
    values (new.user_id, new.id, new.title, new.goal_id, 'cancelled', v_source, jsonb_build_object('scope', v_scope));
    if v_scope <> 'series' then
      perform public.spawn_next_occurrence(new);
    end if;
  elsif tg_op = 'UPDATE' and old.status in ('completed', 'cancelled')
        and new.status not in ('completed', 'cancelled') then
    insert into public.task_completion_history (user_id, task_id, task_title, goal_id, event, source)
    values (new.user_id, new.id, new.title, new.goal_id, 'reopened', v_source);
  end if;

  if tg_op = 'INSERT' then
    perform public.recompute_goal_progress(new.goal_id);
  elsif new.goal_id is distinct from old.goal_id or new.status is distinct from old.status then
    perform public.recompute_goal_progress(old.goal_id);
    if new.goal_id is distinct from old.goal_id then
      perform public.recompute_goal_progress(new.goal_id);
    end if;
  end if;
  return new;
end $$;

create trigger tasks_after_write
  after insert or update or delete on public.tasks
  for each row execute function public.tasks_after_write();

-- ---------------------------------------------------------------------
-- Goals: AFTER trigger — achievements, parent rollup
-- ---------------------------------------------------------------------
create or replace function public.goals_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_goal_progress(old.parent_goal_id);
    return old;
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    insert into public.achievements (user_id, kind, code, title, description, goal_id)
    values (new.user_id, 'goal_completed', 'goal:' || new.id,
            initcap(new.period) || ' goal achieved',
            new.title, new.id)
    on conflict (user_id, code) do nothing;

    insert into public.notifications (user_id, kind, goal_id, title, body, url, dedupe_key)
    values (new.user_id, 'achievement', new.id,
            initcap(new.period) || ' goal achieved',
            new.title || ' — well done. Your progress has been recorded.',
            '/goals?celebrate=' || new.id,
            'achievement:goal:' || new.id)
    on conflict (dedupe_key) do nothing;

    perform public.award_badges(new.user_id);
  end if;

  if new.parent_goal_id is not null and (
       tg_op = 'INSERT'
       or new.progress_pct is distinct from old.progress_pct
       or new.status is distinct from old.status
       or new.parent_goal_id is distinct from old.parent_goal_id) then
    perform public.recompute_goal_progress(new.parent_goal_id);
  end if;
  if tg_op = 'UPDATE' and old.parent_goal_id is not null
     and old.parent_goal_id is distinct from new.parent_goal_id then
    perform public.recompute_goal_progress(old.parent_goal_id);
  end if;

  -- switching progress mode recomputes immediately
  if tg_op = 'UPDATE' and new.progress_mode is distinct from old.progress_mode then
    perform public.recompute_goal_progress(new.id);
  end if;
  return new;
end $$;

create trigger goals_after_write
  after insert or update or delete on public.goals
  for each row execute function public.goals_after_write();

create or replace function public.milestones_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_goal_progress(coalesce(new.goal_id, old.goal_id));
  return coalesce(new, old);
end $$;

create or replace function public.milestones_before_write()
returns trigger language plpgsql as $$
begin
  new.done_at := case when new.done then coalesce(new.done_at, now()) end;
  return new;
end $$;

create trigger goal_milestones_before_write
  before insert or update on public.goal_milestones
  for each row execute function public.milestones_before_write();

create trigger goal_milestones_after_write
  after insert or update or delete on public.goal_milestones
  for each row execute function public.milestones_after_write();

-- ---------------------------------------------------------------------
-- Focus sessions roll up into tasks.time_spent_seconds
-- ---------------------------------------------------------------------
create or replace function public.focus_sessions_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.task_id is not null and new.kind in ('focus', 'task_timer') and new.ended_at is not null
     and (tg_op = 'INSERT' or old.ended_at is null) then
    update public.tasks
       set time_spent_seconds = time_spent_seconds + new.actual_seconds
     where id = new.task_id;
  end if;
  return new;
end $$;

create trigger focus_sessions_after_write
  after insert or update on public.focus_sessions
  for each row execute function public.focus_sessions_after_write();

-- ---------------------------------------------------------------------
-- Task actions (shared by the app and by notification buttons)
-- ---------------------------------------------------------------------
create or replace function public.apply_task_action(
  p_task_id  uuid,
  p_user_id  uuid,
  p_action   text,
  p_source   text default 'app',
  p_minutes  int  default null,
  p_scope    text default 'occurrence'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t         public.tasks%rowtype;
  p         public.notification_preferences%rowtype;
  v_tz      text;
  v_until   timestamptz;
begin
  if p_action not in ('complete', 'pending', 'cancel', 'snooze', 'snooze_tomorrow', 'start', 'reopen') then
    raise exception 'invalid_action: %', p_action using errcode = '22023';
  end if;
  if p_source not in ('app', 'notification', 'system') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  select * into t from public.tasks where id = p_task_id and user_id = p_user_id for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  perform set_config('cadence.action_source', p_source, true);
  perform set_config('cadence.cancel_scope', coalesce(p_scope, 'occurrence'), true);
  select * into p from public.notification_preferences where user_id = p_user_id;
  v_tz := public.user_tz(p_user_id);

  if p_action = 'complete' then
    if t.status <> 'completed' then
      update public.tasks set status = 'completed' where id = t.id;
    end if;

  elsif p_action = 'cancel' then
    if t.status <> 'cancelled' then
      update public.tasks
         set status = 'cancelled',
             recurrence = case when p_scope = 'series' then null else recurrence end
       where id = t.id;
    end if;

  elsif p_action in ('reopen') then
    if t.status in ('completed', 'cancelled') then
      update public.tasks set status = 'pending' where id = t.id;
    end if;

  elsif t.status in ('completed', 'cancelled') then
    raise exception 'task_closed: task is already %', t.status using errcode = '55000';

  elsif p_action = 'start' then
    update public.tasks set status = 'in_progress' where id = t.id;

  elsif p_action = 'pending' then
    -- Keep active; the hourly cycle continues. Make sure a next reminder exists.
    update public.tasks
       set status = case when status = 'in_progress' then 'in_progress' else 'pending' end,
           next_reminder_at = case
             when not reminder_enabled then null
             when next_reminder_at is null or next_reminder_at <= public.clock_now()
               then public.clock_now() + make_interval(mins => coalesce(p.reminder_interval_minutes, 60))
             else next_reminder_at end
     where id = t.id;
    insert into public.task_completion_history (user_id, task_id, task_title, goal_id, event, source)
    values (t.user_id, t.id, t.title, t.goal_id, 'acknowledged', p_source);

  elsif p_action in ('snooze', 'snooze_tomorrow') then
    if p_action = 'snooze' then
      if p_minutes is null or p_minutes not between 5 and 10080 then
        raise exception 'invalid_snooze_minutes' using errcode = '22023';
      end if;
      v_until := public.clock_now() + make_interval(mins => p_minutes);
    else
      v_until := ((((public.clock_now() at time zone v_tz)::date + 1) + coalesce(p.morning_summary_time, '08:00'::time))
                  at time zone v_tz);
    end if;
    update public.tasks
       set next_reminder_at = case when reminder_enabled then v_until end,
           snoozed_until    = v_until
     where id = t.id;
    insert into public.task_completion_history (user_id, task_id, task_title, goal_id, event, source, meta)
    values (t.user_id, t.id, t.title, t.goal_id, 'snoozed', p_source, jsonb_build_object('until', v_until));
  end if;

  -- Any reminder still waiting in the queue for a closed task is now obsolete.
  update public.notifications
     set status = 'superseded'
   where task_id = t.id and status in ('queued', 'sending')
     and exists (select 1 from public.tasks x where x.id = t.id and x.status in ('completed', 'cancelled'));

  return (
    select jsonb_build_object(
      'id', x.id, 'title', x.title, 'status', x.status,
      'next_reminder_at', x.next_reminder_at, 'completed_at', x.completed_at,
      'cancelled_at', x.cancelled_at, 'snoozed_until', x.snoozed_until)
    from public.tasks x where x.id = t.id);
end $$;
