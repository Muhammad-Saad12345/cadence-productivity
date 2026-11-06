-- =====================================================================
-- Cadence · 005 · Background jobs (pg_cron + pg_net)
--
-- Prerequisite (run once, see README "Configure the scheduler"):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'cadence_project_url');
--   select vault.create_secret('<same value as CRON_SECRET edge secret>', 'cadence_cron_secret');
-- Until those secrets exist the dispatch job is a no-op; the SQL tick still
-- enqueues reminders so they appear in the in-app Notification Center.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Pure-SQL tick: status refresh + reminder/digest enqueue. No network dependency.
select cron.schedule(
  'cadence-scheduler-tick',
  '* * * * *',
  $$ select public.run_scheduler_tick(); $$
);

-- 2. Delivery: invoke the dispatch Edge Function (it also runs a tick first).
select cron.schedule(
  'cadence-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cadence_project_url')
           || '/functions/v1/dispatch-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cadence_cron_secret')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'at', now()),
    timeout_milliseconds := 55000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'cadence_project_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'cadence_cron_secret');
  $$
);

-- 3. Weekly housekeeping (Sunday 03:17 UTC).
select cron.schedule('cadence-cleanup', '17 3 * * 0', $$ select public.cleanup_old_records(); $$);
