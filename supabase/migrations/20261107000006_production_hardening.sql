-- =====================================================================
-- Cadence · 006 · Production hardening (Supabase security advisor)
--  * Pin search_path on every remaining function (all bodies use
--    schema-qualified names, so '' is safe).
--  * user_tz() is an internal SECURITY DEFINER helper: not callable by clients.
-- =====================================================================
alter function public.touch_updated_at()                                   set search_path = '';
alter function public.is_valid_timezone(text)                              set search_path = '';
alter function public.clock_now()                                          set search_path = '';
alter function public.derive_open_status(timestamptz, timestamptz, timestamptz) set search_path = '';
alter function public.profiles_before_write()                              set search_path = '';
alter function public.next_occurrence(timestamptz, jsonb, text)            set search_path = '';
alter function public.tasks_before_write()                                 set search_path = '';
alter function public.goals_before_write()                                 set search_path = '';
alter function public.milestones_before_write()                            set search_path = '';
alter function public.quiet_hours_end(timestamptz, text, boolean, time, time) set search_path = '';
alter function public.in_digest_window(time, time)                         set search_path = '';
alter function public.fmt_local(timestamptz, text)                         set search_path = '';
alter function public.require_uid()                                        set search_path = '';

revoke execute on function public.user_tz(uuid) from public, anon, authenticated;
