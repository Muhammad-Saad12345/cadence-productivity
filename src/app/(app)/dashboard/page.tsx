"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleDashed, Flame, NotebookPen, Plus, Target, Timer } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip as RTooltip, XAxis } from "recharts";
import { GoalStatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/page-header";
import { ProgressRing } from "@/components/progress-ring";
import { PushStatusCard } from "@/components/push-status";
import { TaskList } from "@/components/task-item";
import { useUI } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, useGoals, useProfile, useStreaks } from "@/lib/queries";
import { useTaskViews } from "@/lib/task-views";
import { fmtDate, fmtKey, fmtWhen, greeting } from "@/lib/tz";
import { cn, pluralize } from "@/lib/utils";

function Stat({ icon, label, value, hint, tone, href, className }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string; tone: string; href?: string; className?: string }) {
  const body = (
    <Card className={cn("h-full p-4 transition hover:shadow-sm", className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className={cn("rounded-md p-1.5 [&_svg]:size-3.5", tone)}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-xl">{body}</Link> : body;
}

export default function DashboardPage() {
  const { openQuickAdd } = useUI();
  const { data: profile } = useProfile();
  const v = useTaskViews();
  const { data: goals } = useGoals();
  const { data: streaks } = useStreaks();
  const { data: series } = useAnalytics(14);

  const activeGoals = (goals ?? []).filter((g) => ["not_started", "in_progress", "at_risk"].includes(g.status));
  const weekly = activeGoals.filter((g) => g.period === "weekly");
  const monthly = activeGoals.filter((g) => g.period === "monthly");
  const tracked = (goals ?? []).filter((g) => g.status !== "cancelled");
  const overallGoalPct = tracked.length ? tracked.reduce((s, g) => s + Number(g.progress_pct), 0) / tracked.length : 0;

  const todayDue = v.todays.length + v.completedToday.length;
  const last7 = (series ?? []).slice(-7);
  const prev7 = (series ?? []).slice(-14, -7);
  const sum = (a: typeof last7, k: "completed" | "focus_minutes") => a.reduce((s, d) => s + d[k], 0);
  const weekDelta = sum(last7, "completed") - sum(prev7, "completed");
  const focusToday = series?.at(-1)?.focus_minutes ?? 0;

  const goalDeadlines = activeGoals.filter((g) => g.due_date >= v.today).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{fmtDate(new Date(), v.tz, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(v.tz)}{profile?.display_name ? `, ${profile.display_name}` : ""}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/review"><NotebookPen />Daily review</Link></Button>
          <Button size="sm" onClick={() => openQuickAdd()}><Plus />Add task</Button>
        </div>
      </div>

      <PushStatusCard compact />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Today" icon={<CalendarClock />} tone="bg-sky-500/10 text-sky-600" value={`${v.completedToday.length}/${todayDue}`} hint="completed / scheduled" href="/today" />
        <Stat label="Overdue" icon={<AlertTriangle />} tone="bg-rose-500/10 text-rose-600" value={v.overdue.length} hint={v.overdue.length ? "needs attention" : "all clear"} href="/tasks?status=overdue" />
        <Stat label="Pending" icon={<CircleDashed />} tone="bg-amber-500/10 text-amber-600" value={v.pending.length + v.inProgress.length} hint={`${v.inProgress.length} in progress`} href="/tasks?status=pending" />
        <Stat label="Completed (7d)" icon={<CheckCircle2 />} tone="bg-emerald-500/10 text-emerald-600" value={sum(last7, "completed")} hint={weekDelta === 0 ? "same as last week" : `${weekDelta > 0 ? "+" : ""}${weekDelta} vs last week`} href="/analytics" />
        <Stat className="col-span-2 md:col-span-1" label="Streak" icon={<Flame />} tone="bg-orange-500/10 text-orange-600" value={`${streaks?.current_streak ?? 0}d`} hint={`best ${streaks?.best_streak ?? 0}d`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Today&apos;s tasks</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">{pluralize(v.todays.length, "task")} open · {v.completedToday.length} done</p>
              </div>
              <Button variant="ghost" size="sm" asChild><Link href="/today">Open <ArrowRight /></Link></Button>
            </CardHeader>
            <CardContent className="px-2 sm:px-3">
              {v.isLoading ? (
                <div className="space-y-2 px-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : (
                <>
                  {v.overdue.length > 0 && (
                    <div className="mb-2">
                      <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-rose-600 uppercase">Overdue</p>
                      <TaskList tasks={v.overdue.slice(0, 5)} />
                    </div>
                  )}
                  <TaskList
                    tasks={v.todays}
                    timeOnly
                    empty={
                      !v.overdue.length && (
                        <EmptyState className="mx-3" icon={<CheckCircle2 />} title="Nothing scheduled for today"
                          description="Plan your day by adding the few tasks that matter most."
                          action={<Button size="sm" onClick={() => openQuickAdd()}><Plus />Add a task</Button>} />
                      )
                    }
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming</CardTitle>
              <Button variant="ghost" size="sm" asChild><Link href="/upcoming">All upcoming <ArrowRight /></Link></Button>
            </CardHeader>
            <CardContent className="px-2 sm:px-3">
              <TaskList tasks={v.upcoming.slice(0, 7)} empty={<p className="px-3 pb-2 text-sm text-muted-foreground">No upcoming tasks scheduled.</p>} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Weekly performance</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">Tasks completed per day · {focusToday} focus minutes today</p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={last7.map((d) => ({ ...d, label: fmtKey(d.day, { weekday: "short" }) }))} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <RTooltip cursor={{ fill: "var(--accent)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="completed" name="Completed" fill="var(--chart-1)" radius={[5, 5, 2, 2]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Goals</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">{weekly.length} weekly · {monthly.length} monthly active</p>
              </div>
              <ProgressRing value={overallGoalPct} />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {activeGoals.length === 0 && (
                <EmptyState icon={<Target />} title="No active goals" description="Set one achievable goal for this week."
                  action={<Button size="sm" variant="outline" asChild><Link href="/goals?new=weekly">Create goal</Link></Button>} />
              )}
              {[...weekly, ...monthly].slice(0, 6).map((g) => (
                <Link key={g.id} href={`/goals?goal=${g.id}`} className="group block">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium group-hover:text-primary">{g.title}</p>
                    <span className="text-xs text-muted-foreground tabular">{Math.round(g.progress_pct)}%</span>
                  </div>
                  <Progress value={Number(g.progress_pct)} className="mt-1.5" indicatorClassName={g.status === "at_risk" ? "bg-amber-500" : undefined} />
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="uppercase">{g.period}</span>· due {fmtKey(g.due_date)}
                    {g.status === "at_risk" && <GoalStatusBadge status="at_risk" />}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Upcoming deadlines</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {v.deadlines.length === 0 && goalDeadlines.length === 0 && <p className="text-sm text-muted-foreground">No deadlines in the next 7 days.</p>}
              {v.deadlines.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">{fmtWhen(t.due_at!, v.tz)}</span>
                </div>
              ))}
              {goalDeadlines.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 truncate"><Target className="size-3.5 shrink-0 text-primary" />{g.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtKey(g.due_date)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Today&apos;s summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xl font-semibold tabular">{todayDue ? Math.round((v.completedToday.length / todayDue) * 100) : 0}%</p>
                <p className="text-[11px] text-muted-foreground">of today done</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="flex items-center justify-center gap-1 text-xl font-semibold tabular"><Timer className="size-4 text-primary" />{focusToday}m</p>
                <p className="text-[11px] text-muted-foreground">focused</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
