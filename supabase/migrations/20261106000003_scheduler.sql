-- =====================================================================
-- Cadence · 003 · Reminder scheduler
--
--   pg_cron (every minute) ─▶ run_scheduler_tick()
--        ├─ refresh_statuses()        upcoming→pending→overdue, goal at-risk
--        ├─ enqueue_task_reminders()  due tasks → notifications (queued)
--        └─ enqueue_digests()         summaries / check-ins / reviews / warnings
--   Edge Function dispatch-reminders ─▶ lease_notifications() → Web Push
--                                     └▶ finish_notification()
--
-- Idempotency: row locks (SKIP LOCKED) + atomic advance of next_reminder_at
-- + UNIQUE(dedupe_key) + leases with attempt counters.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- If p_now falls inside the user's quiet hours, returns when they end; else null.
create or replace function public.quiet_hours_end(
  p_now timestamptz, p_tz text, p_enabled boolean, p_start time, p_end time)
returns timestamptz language plpgsql stable as $$
declare
  v_lt time := (p_now at time zone p_tz)::time;
  v_ld date := (p_now at time zone p_tz)::date;
begin
  if not p_enabled or p_start = p_end then
    return null;
  end if;
  if p_start < p_end then                         -- same-day window, e.g. 13:00–14:00
    if v_lt >= p_start and v_lt < p_end then
      return (v_ld + p_end) at time zone p_tz;
    end if;
  else                                            -- overnight window, e.g. 22:30–07:00
    if v_lt >= p_start then
      return ((v_ld + 1) + p_end) at time zone p_tz;
    elsif v_lt < p_end then
      return (v_ld + p_end) at time zone p_tz;
    end if;
  end if;
  return null;
end $$;

-- Is local time p_t within [p_target, p_target + 2h)? Digests use a 2h catch-up window.
create or replace function public.in_digest_window(p_t time, p_target time)
returns boolean language sql immutable as $$
  select case when p_t >= p_target then p_t - p_target < interval '2 hours'
              else (p_t - p_target) + interval '24 hours' < interval '2 hours' end
$$;

-- Notifications already scheduled for the user's current local day.
create or replace function public.notifications_today(p_user_id uuid, p_tz text, p_now timestamptz)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.notifications
  where user_id = p_user_id
    and status <> 'superseded'
    and scheduled_for >= (((p_now at time zone p_tz)::date)::timestamp at time zone p_tz)
    and scheduled_for <= p_now
$$;

create or replace function public.fmt_local(p_ts timestamptz, p_tz text)
returns text language sql stable as $$
  select case
    when p_ts is null then null
    when (p_ts at time zone p_tz)::date = (public.clock_now() at time zone p_tz)::date
      then 'today ' || ltrim(to_char(p_ts at time zone p_tz, 'HH12:MI AM'), '0')
    when (p_ts at time zone p_tz)::date = (public.clock_now() at time zone p_tz)::date + 1
      then 'tomorrow ' || ltrim(to_char(p_ts at time zone p_tz, 'HH12:MI AM'), '0')
    else to_char(p_ts at time zone p_tz, 'Dy DD Mon, ') || ltrim(to_char(p_ts at time zone p_tz, 'HH12:MI AM'), '0')
  end
$$;

-- ---------------------------------------------------------------------
-- 1. Status refresh
-- ---------------------------------------------------------------------
create or replace function public.refresh_statuses(p_now timestamptz default public.clock_now())
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_tasks int;
  v_goals int;
begin
  update public.tasks
     set status = public.derive_open_status(scheduled_at, due_at, p_now)
   where status in ('upcoming', 'pending', 'overdue')
     and status <> public.derive_open_status(scheduled_at, due_at, p_now);
  get diagnostics v_tasks = row_count;

  with calc as (
    select g.id,
           case
             when (p_now at time zone pr.timezone)::date > g.due_date then 'at_risk'
             when ((p_now at time zone pr.timezone)::date - g.start_date + 1)::numeric
                    / (g.due_date - g.start_date + 1) >= 0.5
                  and g.progress_pct / 100.0 <
                      ((p_now at time zone pr.timezone)::date - g.start_date + 1)::numeric
                        / (g.due_date - g.start_date + 1) - 0.25
               then 'at_risk'
             when g.progress_pct > 0 then 'in_progress'
             else 'not_started'
           end as new_status
    from public.goals g
    join public.profiles pr on pr.id = g.user_id
    where g.status in ('not_started', 'in_progress', 'at_risk')
  )
  update public.goals g
     set status = calc.new_status
    from calc
   where g.id = calc.id and g.status <> calc.new_status;
  get diagnostics v_goals = row_count;

  return v_tasks + v_goals;
end $$;

-- ---------------------------------------------------------------------
-- 2. Task reminders
-- ---------------------------------------------------------------------
create or replace function public.enqueue_task_reminders(
  p_now   timestamptz default public.clock_now(),
  p_limit int default 500)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r           record;
  v_cnt       int := 0;
  v_interval  interval;
  v_quiet_end timestamptz;
  v_k         bigint;
  v_body      text;
begin
  for r in
    select t.id, t.user_id, t.title, t.priority, t.status, t.due_at, t.next_reminder_at, t.reminder_count,
           pr.timezone as tz,
           np.reminder_interval_minutes, np.quiet_hours_enabled, np.quiet_start, np.quiet_end,
           np.daily_limit, np.morning_summary_time
      from public.tasks t
      join public.profiles pr on pr.id = t.user_id
      join public.notification_preferences np on np.user_id = t.user_id
     where t.next_reminder_at <= p_now
       and t.reminder_enabled
       and t.status in ('upcoming', 'pending', 'in_progress', 'overdue')
     order by t.next_reminder_at
     limit p_limit
     for update of t skip locked
  loop
    v_interval := make_interval(mins => r.reminder_interval_minutes);

    -- Quiet hours: defer, don't drop.
    v_quiet_end := public.quiet_hours_end(p_now, r.tz, r.quiet_hours_enabled, r.quiet_start, r.quiet_end);
    if v_quiet_end is not null then
      update public.tasks set next_reminder_at = v_quiet_end where id = r.id;
      continue;
    end if;

    -- Daily cap: defer to tomorrow morning.
    if r.daily_limit is not null
       and public.notifications_today(r.user_id, r.tz, p_now) >= r.daily_limit then
      update public.tasks
         set next_reminder_at = ((((p_now at time zone r.tz)::date + 1) + r.morning_summary_time) at time zone r.tz)
       where id = r.id;
      continue;
    end if;

    v_body := concat_ws(' · ',
      case when r.status = 'overdue' then 'Overdue' end,
      case when r.due_at is not null then 'Due ' || public.fmt_local(r.due_at, r.tz) end,
      initcap(r.priority) || ' priority',
      case when r.reminder_count > 0 then 'Reminder ' || (r.reminder_count + 1) end);

    insert into public.notifications (user_id, kind, task_id, title, body, url, dedupe_key, scheduled_for)
    values (r.user_id, 'task_reminder', r.id, r.title, v_body, '/tasks?task=' || r.id,
            'task:' || r.id || ':' || floor(extract(epoch from r.next_reminder_at) * 1000)::bigint,
            r.next_reminder_at)
    on conflict (dedupe_key) do nothing;
    if found then
      v_cnt := v_cnt + 1;
    end if;

    -- Advance on the original phase (10:00 → 11:00 → 12:00), never into the past.
    v_k := floor(extract(epoch from (p_now - r.next_reminder_at)) / extract(epoch from v_interval))::bigint + 1;
    update public.tasks
       set next_reminder_at = r.next_reminder_at + v_interval * v_k,
           reminder_count   = reminder_count + 1,
           last_reminded_at = p_now,
           snoozed_until    = null
     where id = r.id;
  end loop;
  return v_cnt;
end $$;

-- ---------------------------------------------------------------------
-- 3. Digests: summaries, goal check-ins, reviews, warnings, habits
-- ---------------------------------------------------------------------
create or replace function public.enqueue_digests(p_now timestamptz default public.clock_now())
returns int language plpgsql security definer set search_path = '' as $$
declare
  u        record;
  g        record;
  h        record;
  v_lt     timestamp;
  v_ld     date;
  v_time   time;
  v_day0   timestamptz;
  v_day1   timestamptz;
  v_cnt    int := 0;
  v_n1     int;
  v_n2     int;
  v_n3     int;
  v_txt    text;
begin
  for u in
    select pr.id as user_id, pr.timezone as tz, np.*
      from public.profiles pr
      join public.notification_preferences np on np.user_id = pr.id
  loop
    v_lt   := p_now at time zone u.tz;
    v_ld   := v_lt::date;
    v_time := v_lt::time;
    v_day0 := v_ld::timestamp at time zone u.tz;
    v_day1 := (v_ld + 1)::timestamp at time zone u.tz;

    continue when public.quiet_hours_end(p_now, u.tz, u.quiet_hours_enabled, u.quiet_start, u.quiet_end) is not null;
    continue when u.daily_limit is not null
              and public.notifications_today(u.user_id, u.tz, p_now) >= u.daily_limit;

    -- Morning: today's priorities ---------------------------------------
    if u.morning_summary_enabled and public.in_digest_window(v_time, u.morning_summary_time) then
      select count(*) filter (where coalesce(scheduled_at, due_at) >= v_day0 and coalesce(scheduled_at, due_at) < v_day1),
             count(*) filter (where status = 'overdue')
        into v_n1, v_n2
        from public.tasks
       where user_id = u.user_id and status in ('upcoming', 'pending', 'in_progress', 'overdue');
      select string_agg(title, ', ') into v_txt from (
        select title from public.tasks
         where user_id = u.user_id and status in ('upcoming', 'pending', 'in_progress', 'overdue')
           and (coalesce(scheduled_at, due_at) < v_day1 or status = 'overdue')
         order by array_position(array['critical', 'high', 'medium', 'low'], priority), coalesce(scheduled_at, due_at)
         limit 3) x;
      insert into public.notifications (user_id, kind, title, body, url, dedupe_key, scheduled_for)
      values (u.user_id, 'morning_summary', 'Good morning — today''s priorities',
              case when v_n1 + v_n2 = 0 then 'Nothing scheduled yet. Take a minute to plan your day.'
                   else concat_ws(' · ', v_n1 || ' due today', case when v_n2 > 0 then v_n2 || ' overdue' end,
                                  case when v_txt is not null then 'Top: ' || v_txt end) end,
              '/today', 'morning:' || u.user_id || ':' || v_ld, p_now)
      on conflict (dedupe_key) do nothing;
      if found then v_cnt := v_cnt + 1; end if;
    end if;

    -- Evening: what got done --------------------------------------------
    if u.evening_summary_enabled and public.in_digest_window(v_time, u.evening_summary_time) then
      select count(*) into v_n1 from public.task_completion_history
       where user_id = u.user_id and event = 'completed' and occurred_at >= v_day0 and occurred_at < v_day1;
      select count(*) into v_n2 from public.tasks
       where user_id = u.user_id and status in ('upcoming', 'pending', 'in_progress', 'overdue')
         and coalesce(scheduled_at, due_at) < v_day1;
      insert into public.notifications (user_id, kind, title, body, url, dedupe_key, scheduled_for)
      values (u.user_id, 'evening_summary', 'Evening summary',
              case when v_n1 > 0 then 'You completed ' || v_n1 || ' task' || case when v_n1 = 1 then '' else 's' end || ' today.'
                   else 'No tasks completed today.' end
              || case when v_n2 > 0 then ' ' || v_n2 || ' still open — review and plan tomorrow.' else ' Everything due is done.' end,
              '/review', 'evening:' || u.user_id || ':' || v_ld, p_now)
      on conflict (dedupe_key) do nothing;
      if found then v_cnt := v_cnt + 1; end if;
    end if;

    -- Goal check-in -------------------------------------------------------
    if u.goal_reminder_frequency <> 'off'
       and public.in_digest_window(v_time, u.goal_checkin_time)
       and (u.goal_reminder_frequency = 'daily'
            or (u.goal_reminder_frequency = 'every_other_day' and (v_ld - date '2000-01-03') % 2 = 0)
            or (u.goal_reminder_frequency = 'weekly' and extract(isodow from v_ld) = 1)) then
      select count(*) into v_n1 from public.goals
       where user_id = u.user_id and status in ('not_started', 'in_progress', 'at_risk')
         and start_date <= v_ld and reminder_frequency <> 'off';
      if v_n1 > 0 then
        select '"' || title || '" at ' || round(progress_pct)::int || '%' into v_txt
          from public.goals
         where user_id = u.user_id and status in ('not_started', 'in_progress', 'at_risk')
           and start_date <= v_ld and reminder_frequency <> 'off'
         order by (status = 'at_risk') desc, progress_pct asc, due_date asc
         limit 1;
        insert into public.notifications (user_id, kind, title, body, url, dedupe_key, scheduled_for)
        values (u.user_id, 'goal_checkin', 'Goal check-in',
                v_n1 || ' active goal' || case when v_n1 = 1 then '' else 's' end || '. Needs attention: ' || v_txt || '.',
                '/goals', 'goalcheck:' || u.user_id || ':' || v_ld, p_now)
        on conflict (dedupe_key) do nothing;
        if found then v_cnt := v_cnt + 1; end if;
      end if;
    end if;

    -- Weekly review (Sunday evening) ----------------------------------------
    if u.weekly_review_enabled and extract(isodow from v_ld) = 7
       and public.in_digest_window(v_time, u.evening_summary_time) then
      select count(*) filter (where status = 'completed'), count(*) filter (where status <> 'cancelled')
        into v_n1, v_n2
        from public.goals where user_id = u.user_id and period = 'weekly' and due_date between v_ld - 6 and v_ld + 1;
      select count(*) into v_n3 from public.task_completion_history
       where user_id = u.user_id and event = 'completed' and occurred_at >= v_day0 - interval '6 days';
      insert into public.notifications (user_id, kind, title, body, url, dedupe_key, scheduled_for)
      values (u.user_id, 'weekly_review', 'Weekly review',
              v_n3 || ' tasks completed this week'
              || case when v_n2 > 0 then ' · ' || v_n1 || '/' || v_n2 || ' weekly goals achieved' else '' end
              || '. Review your week and set next week''s goals.',
              '/review?tab=weekly', 'weekly:' || u.user_id || ':' || to_char(v_ld, 'IYYY-IW'), p_now)
      on conflict (dedupe_key) do nothing;
      if found then v_cnt := v_cnt + 1; end if;
    end if;

    -- Monthly review (last day of month, evening) ---------------------------
    if u.monthly_review_enabled and extract(day from v_ld + 1) = 1
       and public.in_digest_window(v_time, u.evening_summary_time) then
      select count(*) filter (where status = 'completed'), count(*) filter (where status <> 'cancelled')
        into v_n1, v_n2
        from public.goals where user_id = u.user_id and period = 'monthly'
         and due_date between date_trunc('month', v_ld)::date and v_ld + 1;
      insert into public.notifications (user_id, kind, title, body, url, dedupe_key, scheduled_for)
      values (u.user_id, 'monthly_review', 'Monthly review',
              case when v_n2 > 0 then v_n1 || '/' || v_n2 || ' monthly goals achieved. ' else '' end
              || 'Take ten minutes to review the month and set next month''s objectives.',
              '/review?tab=monthly', 'monthly:' || u.user_id || ':' || to_char(v_ld, 'YYYY-MM'), p_now)
      on conflict (dedupe_key) do nothing;
      if found then v_cnt := v_cnt + 1; end if;
    end if;

    -- Goal deadline warnings (once per goal) --------------------------------
    for g in
      select id, title, period, due_date, progress_pct
        from public.goals
       where user_id = u.user_id and status in ('not_started', 'in_progress', 'at_risk')
         and reminder_frequency <> 'off'
         and ((due_date + 1)::timestamp at time zone u.tz) > p_now
         and ((due_date + 1)::timestamp at time zone u.tz) - p_now <= make_interval(hours => u.deadline_warning_hours)
    loop
      insert into public.notifications (user_id, kind, goal_id, title, body, url, dedupe_key, scheduled_for)
      values (u.user_id, 'goal_deadline', g.id, 'Goal deadline approaching',
              '"' || g.title || '" (' || g.period || ') is due ' || to_char(g.due_date, 'Dy DD Mon')
              || ' — ' || round(g.progress_pct)::int || '% complete.',
              '/goals?goal=' || g.id, 'goaldl:' || g.id || ':' || g.due_date, p_now)
      on conflict (dedupe_key) do nothing;
      if found then v_cnt := v_cnt + 1; end if;
    end loop;

    -- Habit nudges ----------------------------------------------------------
    if u.habit_reminders_enabled then
      for h in
        select hb.id, hb.name, hb.target_per_day,
               coalesce((select count from public.habit_logs l where l.habit_id = hb.id and l.log_date = v_ld), 0) as done
          from public.habits hb
         where hb.user_id = u.user_id and hb.archived_at is null and hb.reminder_time is not null
           and extract(isodow from v_ld)::smallint = any (hb.days)
           and public.in_digest_window(v_time, hb.reminder_time)
      loop
        continue when h.done >= h.target_per_day;
        insert into public.notifications (user_id, kind, habit_id, title, body, url, dedupe_key, scheduled_for)
        values (u.user_id, 'habit_reminder', h.id, 'Habit: ' || h.name,
                case when h.target_per_day > 1 then h.done || '/' || h.target_per_day || ' done today.'
                     else 'Not logged yet today.' end,
                '/habits', 'habit:' || h.id || ':' || v_ld, p_now)
        on conflict (dedupe_key) do nothing;
        if found then v_cnt := v_cnt + 1; end if;
      end loop;
    end if;
  end loop;
  return v_cnt;
end $$;

-- ---------------------------------------------------------------------
-- 4. Lease queued notifications for delivery
-- ---------------------------------------------------------------------
create or replace function public.lease_notifications(
  p_limit         int default 100,
  p_lease_seconds int default 120,
  p_now           timestamptz default public.clock_now())
returns table (
  id uuid, user_id uuid, kind text, task_id uuid, goal_id uuid,
  title text, body text, url text, attempts int, scheduled_for timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  -- Reminders for tasks that were completed/cancelled/deleted meanwhile are dropped.
  update public.notifications n
     set status = 'superseded', lease_until = null
   where n.status in ('queued', 'sending') and n.kind = 'task_reminder'
     and (n.task_id is null
          or exists (select 1 from public.tasks t
                      where t.id = n.task_id and t.status in ('completed', 'cancelled')));

  -- Give up after 5 attempts.
  update public.notifications n
     set status = 'failed', lease_until = null,
         last_error = coalesce(n.last_error, 'max attempts reached')
   where n.status = 'sending' and n.lease_until < p_now and n.attempts >= 5;

  return query
  with picked as (
    select n.id
      from public.notifications n
     where (n.status = 'queued' and n.scheduled_for <= p_now + interval '30 seconds')
        or (n.status = 'sending' and n.lease_until < p_now and n.attempts < 5)
     order by n.scheduled_for
     limit p_limit
     for update skip locked
  )
  update public.notifications n
     set status = 'sending',
         attempts = n.attempts + 1,
         lease_until = p_now + make_interval(secs => p_lease_seconds)
    from picked
   where n.id = picked.id
  returning n.id, n.user_id, n.kind, n.task_id, n.goal_id, n.title, n.body, n.url, n.attempts, n.scheduled_for;
end $$;

-- p_status: 'sent' | 'partial' | 'failed' | 'no_channel' | 'retry'
create or replace function public.finish_notification(
  p_id uuid, p_status text, p_error text default null, p_retry_seconds int default 60)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status = 'retry' then
    update public.notifications
       set status = case when attempts >= 5 then 'failed' else 'sending' end,
           lease_until = case when attempts >= 5 then null
                              else public.clock_now() + make_interval(secs => p_retry_seconds) end,
           last_error = p_error
     where id = p_id and status = 'sending';
  elsif p_status in ('sent', 'partial', 'failed', 'no_channel') then
    update public.notifications
       set status = p_status,
           lease_until = null,
           last_error = p_error,
           sent_at = case when p_status in ('sent', 'partial') then public.clock_now() else sent_at end
     where id = p_id and status = 'sending';
  else
    raise exception 'invalid status %', p_status;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. One tick = refresh + enqueue (idempotent; safe to call concurrently)
-- ---------------------------------------------------------------------
create or replace function public.run_scheduler_tick(p_now timestamptz default public.clock_now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_status int;
  v_tasks  int;
  v_dig    int;
begin
  v_status := public.refresh_statuses(p_now);
  v_tasks  := public.enqueue_task_reminders(p_now);
  v_dig    := public.enqueue_digests(p_now);
  return jsonb_build_object('status_changes', v_status, 'task_reminders', v_tasks, 'digests', v_dig, 'at', p_now);
end $$;

create or replace function public.cleanup_old_records()
returns void language sql security definer set search_path = '' as $$
  delete from public.notification_deliveries where created_at < now() - interval '60 days';
  delete from public.notifications where created_at < now() - interval '180 days';
$$;
