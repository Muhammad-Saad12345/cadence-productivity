-- =====================================================================
-- Cadence · 007 · Supabase advisor follow-ups
--  * Trigger functions are never meant to be called over the API.
--    (Triggers still fire: EXECUTE is not checked when a trigger runs.)
--  * Covering indexes for foreign keys (fast cascades / joins).
-- =====================================================================
revoke execute on function public.assert_same_owner()          from public, anon, authenticated;
revoke execute on function public.tasks_after_write()          from public, anon, authenticated;
revoke execute on function public.goals_after_write()          from public, anon, authenticated;
revoke execute on function public.milestones_after_write()     from public, anon, authenticated;
revoke execute on function public.focus_sessions_after_write() from public, anon, authenticated;

create index if not exists achievements_goal_idx            on public.achievements (goal_id) where goal_id is not null;
create index if not exists focus_sessions_task_idx          on public.focus_sessions (task_id) where task_id is not null;
create index if not exists goal_milestones_user_idx         on public.goal_milestones (user_id);
create index if not exists goals_category_idx               on public.goals (category_id) where category_id is not null;
create index if not exists notification_deliveries_sub_idx  on public.notification_deliveries (subscription_id);
create index if not exists notifications_goal_idx           on public.notifications (goal_id) where goal_id is not null;
create index if not exists projects_category_idx            on public.projects (category_id) where category_id is not null;
create index if not exists subtasks_user_idx                on public.subtasks (user_id);
create index if not exists tch_goal_idx                     on public.task_completion_history (goal_id) where goal_id is not null;
create index if not exists tasks_category_idx               on public.tasks (category_id) where category_id is not null;
