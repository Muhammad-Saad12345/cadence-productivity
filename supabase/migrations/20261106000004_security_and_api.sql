-- =====================================================================
-- Cadence · 004 · Row Level Security, grants and client-facing RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- RLS: owner-only access on every table
-- ---------------------------------------------------------------------
alter table public.profiles                 enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.categories               enable row level security;
alter table public.projects                 enable row level security;
alter table public.goals                    enable row level security;
alter table public.goal_milestones          enable row level security;
alter table public.tasks                    enable row level security;
alter table public.subtasks                 enable row level security;
alter table public.task_completion_history  enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_deliveries  enable row level security;
alter table public.push_subscriptions       enable row level security;
alter table public.habits                   enable row level security;
alter table public.habit_logs               enable row level security;
alter table public.focus_sessions           enable row level security;
alter table public.achievements             enable row level security;

-- Full CRUD for owner on user-managed tables
do $$
declare
  t text;
begin
  foreach t in array array['categories', 'projects', 'goals', 'goal_milestones', 'tasks', 'subtasks',
                           'habits', 'habit_logs', 'focus_sessions']
  loop
    execute format('create policy %1$I on public.%2$I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %1$I on public.%2$I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %1$I on public.%2$I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %1$I on public.%2$I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy prefs_select_own on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy prefs_update_own on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- System-written tables: read-only for the owner
create policy history_select_own on public.task_completion_history for select to authenticated using (user_id = (select auth.uid()));
create policy achievements_select_own on public.achievements for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
create policy push_subs_select_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_subs_delete_own on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
create policy push_subs_update_own on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy deliveries_select_own on public.notification_deliveries for select to authenticated
  using (exists (select 1 from public.notifications n where n.id = notification_id and n.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- Grants: anon gets nothing; authenticated gets only what RLS + columns allow
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke insert, update, delete on public.task_completion_history, public.achievements,
                                 public.notification_deliveries from authenticated;
revoke insert on public.notifications, public.push_subscriptions, public.profiles,
                 public.notification_preferences from authenticated;
-- Only these columns may be changed from the client:
revoke update on public.notifications from authenticated;
grant  update (read_at) on public.notifications to authenticated;
revoke update on public.push_subscriptions from authenticated;
grant  update (device_label) on public.push_subscriptions to authenticated;
revoke update on public.profiles from authenticated;
grant  update (display_name, timezone, theme, week_starts_on, pomodoro_focus_min, pomodoro_short_min,
               pomodoro_long_min, pomodoro_long_every) on public.profiles to authenticated;
revoke update on public.notification_preferences from authenticated;
grant  update (push_enabled, in_app_enabled, reminder_interval_minutes, quiet_hours_enabled, quiet_start,
               quiet_end, daily_limit, goal_reminder_frequency, goal_checkin_time, morning_summary_enabled,
               morning_summary_time, evening_summary_enabled, evening_summary_time, weekly_review_enabled,
               monthly_review_enabled, deadline_warning_hours, habit_reminders_enabled, sound_enabled,
               vibrate_enabled, require_interaction, celebrations_enabled)
  on public.notification_preferences to authenticated;
-- Reminder bookkeeping on tasks is server-owned
revoke update on public.tasks from authenticated;
grant  update (title, description, notes, category_id, project_id, goal_id, priority, status, scheduled_at,
               due_at, estimated_minutes, tags, recurrence, reminder_enabled, sort_order)
  on public.tasks to authenticated;

-- ---------------------------------------------------------------------
-- Internal functions: never callable by clients
-- ---------------------------------------------------------------------
revoke execute on function public.apply_task_action(uuid, uuid, text, text, int, text) from public, anon, authenticated;
revoke execute on function public.refresh_statuses(timestamptz)                     from public, anon, authenticated;
revoke execute on function public.enqueue_task_reminders(timestamptz, int)          from public, anon, authenticated;
revoke execute on function public.enqueue_digests(timestamptz)                      from public, anon, authenticated;
revoke execute on function public.lease_notifications(int, int, timestamptz)        from public, anon, authenticated;
revoke execute on function public.finish_notification(uuid, text, text, int)        from public, anon, authenticated;
revoke execute on function public.run_scheduler_tick(timestamptz)                   from public, anon, authenticated;
revoke execute on function public.cleanup_old_records()                             from public, anon, authenticated;
revoke execute on function public.recompute_goal_progress(uuid)                     from public, anon, authenticated;
revoke execute on function public.award_badges(uuid)                                from public, anon, authenticated;
revoke execute on function public.spawn_next_occurrence(public.tasks)               from public, anon, authenticated;
revoke execute on function public.user_streaks(uuid)                                from public, anon, authenticated;
revoke execute on function public.notifications_today(uuid, text, timestamptz)      from public, anon, authenticated;
revoke execute on function public.handle_new_user()                                 from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Client RPCs (SECURITY DEFINER, always scoped to auth.uid())
-- ---------------------------------------------------------------------
create or replace function public.require_uid()
returns uuid language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.task_action(
  p_task_id uuid, p_action text, p_minutes int default null, p_scope text default 'occurrence')
returns jsonb language sql security definer set search_path = '' as $$
  select public.apply_task_action(p_task_id, public.require_uid(), p_action, 'app', p_minutes, p_scope)
$$;

create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null, p_device_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_uid();
  v_id  uuid;
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 2000 then
    raise exception 'invalid_endpoint' using errcode = '22023';
  end if;
  if length(coalesce(p_p256dh, '')) < 40 or length(coalesce(p_auth, '')) < 8 then
    raise exception 'invalid_keys' using errcode = '22023';
  end if;
  -- An endpoint belongs to one browser profile; re-assign it if another account signs in there.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, device_label)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400), left(p_device_label, 80))
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent,
         device_label = coalesce(excluded.device_label, public.push_subscriptions.device_label),
         disabled_at = null, disabled_reason = null, failure_count = 0
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = public.require_uid();
$$;

create or replace function public.send_test_notification()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_uid();
  v_id  uuid;
begin
  if (select count(*) from public.notifications
       where user_id = v_uid and kind = 'system' and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'rate_limited' using errcode = '53400';
  end if;
  insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
  values (v_uid, 'system', 'Test notification',
          'Push notifications are working on this device.', '/settings',
          'test:' || v_uid || ':' || extract(epoch from clock_timestamp()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.notifications set read_at = now()
   where user_id = public.require_uid() and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function public.my_streaks()
returns table (current_streak int, best_streak int, today_completed int)
language sql security definer set search_path = '' as $$
  select * from public.user_streaks(public.require_uid())
$$;

create or replace function public.log_habit(p_habit_id uuid, p_date date, p_delta int default 1)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_uid();
  v_cnt int;
begin
  if not exists (select 1 from public.habits where id = p_habit_id and user_id = v_uid) then
    raise exception 'habit_not_found' using errcode = 'P0002';
  end if;
  insert into public.habit_logs (habit_id, user_id, log_date, count)
  values (p_habit_id, v_uid, p_date, greatest(0, least(50, p_delta)))
  on conflict (habit_id, log_date)
    do update set count = greatest(0, least(50, public.habit_logs.count + p_delta))
  returning count into v_cnt;
  return v_cnt;
end $$;

-- Per-day productivity series in the user's timezone.
create or replace function public.analytics_daily(p_days int default 30)
returns table (day date, completed int, created int, cancelled int, focus_minutes int, habits_done int)
language sql security definer set search_path = '' as $$
  with me as (select public.require_uid() as uid),
  tz as (select public.user_tz((select uid from me)) as tz),
  days as (
    select generate_series(
      (public.clock_now() at time zone (select tz from tz))::date - (least(greatest(p_days, 1), 366) - 1),
      (public.clock_now() at time zone (select tz from tz))::date, interval '1 day')::date as day
  )
  select d.day,
    (select count(*)::int from public.task_completion_history h
      where h.user_id = (select uid from me) and h.event = 'completed'
        and (h.occurred_at at time zone (select tz from tz))::date = d.day),
    (select count(*)::int from public.tasks t
      where t.user_id = (select uid from me) and (t.created_at at time zone (select tz from tz))::date = d.day),
    (select count(*)::int from public.task_completion_history h
      where h.user_id = (select uid from me) and h.event = 'cancelled'
        and (h.occurred_at at time zone (select tz from tz))::date = d.day),
    (select coalesce(sum(f.actual_seconds), 0)::int / 60 from public.focus_sessions f
      where f.user_id = (select uid from me) and f.kind in ('focus', 'task_timer')
        and (f.started_at at time zone (select tz from tz))::date = d.day),
    (select count(*)::int from public.habit_logs l join public.habits hb on hb.id = l.habit_id
      where l.user_id = (select uid from me) and l.log_date = d.day and l.count >= hb.target_per_day)
  from days d
  order by d.day
$$;

grant execute on function public.task_action(uuid, text, int, text)                   to authenticated;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text)                   to authenticated;
grant execute on function public.send_test_notification()                             to authenticated;
grant execute on function public.mark_notifications_read(uuid[])                      to authenticated;
grant execute on function public.my_streaks()                                         to authenticated;
grant execute on function public.log_habit(uuid, date, int)                           to authenticated;
grant execute on function public.analytics_daily(int)                                 to authenticated;
revoke execute on function public.task_action(uuid, text, int, text)                  from anon, public;
revoke execute on function public.register_push_subscription(text, text, text, text, text) from anon, public;
revoke execute on function public.unregister_push_subscription(text)                  from anon, public;
revoke execute on function public.send_test_notification()                            from anon, public;
revoke execute on function public.mark_notifications_read(uuid[])                     from anon, public;
revoke execute on function public.my_streaks()                                        from anon, public;
revoke execute on function public.log_habit(uuid, date, int)                          from anon, public;
revoke execute on function public.analytics_daily(int)                                from anon, public;

-- ---------------------------------------------------------------------
-- Realtime: in-app fallback for notifications and live task updates
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.tasks, public.goals;
  end if;
end $$;
