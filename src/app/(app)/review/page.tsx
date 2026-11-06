"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ArrowRight, CalendarPlus, CheckCircle2, CircleX, Plus, Target, Timer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { GoalStatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/task-item";
import { useUI } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalytics, useGoals, useHistory, useProfile, useUpdateTask } from "@/lib/queries";
import { anchorOf, useTaskViews } from "@/lib/task-views";
import type { Goal } from "@/lib/types";
import {
  addDaysKey, addMonthsKey, dateKey, fmtDuration, fmtKey, parseKey, startOfDayUtc, startOfMonthKey, startOfWeekKey, zonedParts, zonedToUtc,
} from "@/lib/tz";

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">{icon}{label}</p>
      <p className="mt-1 text-xl font-semibold tabular">{value}</p>
    </div>
  );
}

function GoalRows({ list }: { list: Goal[] }) {
  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 && <p className="text-sm text-muted-foreground">No goals for this period.</p>}
      {list.map((g) => (
        <Link key={g.id} href={`/goals?goal=${g.id}`} className="group">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate group-hover:text-primary">{g.title}</span>
            <span className="flex items-center gap-2"><GoalStatusBadge status={g.status} /><span className="w-9 text-right text-xs tabular">{Math.round(g.progress_pct)}%</span></span>
          </div>
          <Progress value={Number(g.progress_pct)} className="mt-1.5" indicatorClassName={g.status === "completed" ? "bg-emerald-500" : g.status === "at_risk" ? "bg-amber-500" : undefined} />
        </Link>
      ))}
    </div>
  );
}

function ReviewInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "daily");
  const v = useTaskViews();
  const { data: profile } = useProfile();
  const { data: goals } = useGoals();
  const { openQuickAdd } = useUI();
  const update = useUpdateTask();
  const weekStart = startOfWeekKey(v.today, profile?.week_starts_on ?? 1);
  const monthStart = startOfMonthKey(v.today);
  const since = useMemo(() => startOfDayUtc(weekStart < monthStart ? weekStart : monthStart, v.tz).toISOString(), [weekStart, monthStart, v.tz]);
  const { data: history } = useHistory(since);
  const { data: series } = useAnalytics(31);
  const tomorrow = addDaysKey(v.today, 1);

  const inRange = (iso: string, from: string, to: string) => {
    const k = dateKey(iso, v.tz);
    return k >= from && k <= to;
  };
  const completedIn = (from: string, to: string) => (history ?? []).filter((h) => h.event === "completed" && inRange(h.occurred_at, from, to));
  const cancelledIn = (from: string, to: string) => (history ?? []).filter((h) => h.event === "cancelled" && inRange(h.occurred_at, from, to));
  const focusIn = (from: string, to: string) => (series ?? []).filter((d) => d.day >= from && d.day <= to).reduce((a, d) => a + d.focus_minutes, 0);

  const unfinishedToday = [...v.overdue, ...v.todays];
  const tomorrowTasks = v.open.filter((t) => anchorOf(t) && dateKey(anchorOf(t)!, v.tz) === tomorrow);

  const moveToTomorrow = (ids: string[]) => {
    for (const id of ids) {
      const t = v.all.find((x) => x.id === id)!;
      const a = anchorOf(t);
      const p = a ? zonedParts(a, v.tz) : { hour: 9, minute: 0 };
      const { y, m, d } = parseKey(tomorrow);
      const target = zonedToUtc(y, m, d, p.hour, p.minute, v.tz);
      const delta = a ? target.getTime() - new Date(a).getTime() : 0;
      const shift = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + delta).toISOString() : null);
      update.mutate({ id, patch: a ? { scheduled_at: shift(t.scheduled_at), due_at: t.due_at && new Date(t.due_at) < target ? shift(t.due_at) : t.due_at } : { scheduled_at: target.toISOString() } });
    }
    toast.success(`Moved ${ids.length} task${ids.length === 1 ? "" : "s"} to tomorrow`);
  };

  const weekEnd = addDaysKey(weekStart, 6);
  const monthEnd = addDaysKey(addMonthsKey(monthStart, 1), -1);
  const weeklyGoals = (goals ?? []).filter((g) => g.period === "weekly" && g.due_date >= weekStart && g.start_date <= weekEnd);
  const monthlyGoals = (goals ?? []).filter((g) => g.period === "monthly" && g.due_date >= monthStart && g.start_date <= monthEnd);
  const goalsAchieved = (from: string, to: string) => (goals ?? []).filter((g) => g.completed_at && inRange(g.completed_at, from, to));


  return (
    <div>
      <PageHeader title="Review" description="Close the loop: see what got done and plan what's next." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric icon={<CheckCircle2 />} label="Completed" value={completedIn(v.today, v.today).length} />
            <Metric icon={<TriangleAlert />} label="Unfinished" value={unfinishedToday.length} />
            <Metric icon={<CircleX />} label="Cancelled" value={cancelledIn(v.today, v.today).length} />
            <Metric icon={<Timer />} label="Focus" value={fmtDuration(focusIn(v.today, v.today) * 60)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {completedIn(v.today, v.today).length === 0 ? "No completions logged today yet." :
              unfinishedToday.length === 0 ? "Everything scheduled for today is done. Well done." :
              `You completed ${completedIn(v.today, v.today).length} and have ${unfinishedToday.length} still open. Decide: do it, move it, or cancel it.`}
          </p>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Unfinished</CardTitle>
                {unfinishedToday.length > 0 && <Button size="sm" variant="outline" onClick={() => moveToTomorrow(unfinishedToday.map((t) => t.id))}><CalendarPlus />Move all to tomorrow</Button>}
              </CardHeader>
              <CardContent className="px-2"><TaskList tasks={unfinishedToday} empty={<p className="px-3 text-sm text-muted-foreground">Nothing left.</p>} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Completed today</CardTitle></CardHeader>
              <CardContent className="px-2"><TaskList tasks={v.completedToday} timeOnly empty={<p className="px-3 text-sm text-muted-foreground">Nothing completed yet.</p>} /></CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <div><CardTitle>Plan tomorrow</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">{fmtKey(tomorrow, { weekday: "long", day: "numeric", month: "long" })}</p></div>
              <Button size="sm" onClick={() => { const { y, m, d } = parseKey(tomorrow); openQuickAdd({ scheduled_at: zonedToUtc(y, m, d, 9, 0, v.tz).toISOString() }); }}><Plus />Add for tomorrow</Button>
            </CardHeader>
            <CardContent className="px-2"><TaskList tasks={tomorrowTasks} timeOnly empty={<p className="px-3 text-sm text-muted-foreground">Nothing planned yet. Pick your top three.</p>} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="weekly" className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">{fmtKey(weekStart, { day: "numeric", month: "short" })} – {fmtKey(weekEnd, { day: "numeric", month: "short" })}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric icon={<CheckCircle2 />} label="Tasks completed" value={completedIn(weekStart, weekEnd).length} />
            <Metric icon={<Target />} label="Goals achieved" value={`${goalsAchieved(weekStart, weekEnd).length}/${weeklyGoals.filter((g) => g.status !== "cancelled").length}`} />
            <Metric icon={<TriangleAlert />} label="Overdue now" value={v.overdue.length} />
            <Metric icon={<Timer />} label="Focus" value={fmtDuration(focusIn(weekStart, weekEnd) * 60)} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Weekly targets</CardTitle><Button size="sm" variant="ghost" asChild><Link href="/goals?new=weekly">Set next week&apos;s goals <ArrowRight /></Link></Button></CardHeader>
              <CardContent><GoalRows list={weeklyGoals} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Accomplishments</CardTitle></CardHeader>
              <CardContent className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
                {goalsAchieved(weekStart, weekEnd).map((g) => <p key={g.id} className="flex items-center gap-2 text-sm font-medium"><Target className="size-3.5 text-emerald-600" />{g.title}</p>)}
                {completedIn(weekStart, weekEnd).map((h) => <p key={h.id} className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-3.5 text-emerald-600" /><span className="truncate">{h.task_title}</span><span className="ml-auto text-xs text-muted-foreground">{fmtKey(dateKey(h.occurred_at, v.tz), { weekday: "short" })}</span></p>)}
                {completedIn(weekStart, weekEnd).length === 0 && <p className="text-sm text-muted-foreground">No completed tasks this week yet.</p>}
              </CardContent>
            </Card>
          </div>
          {v.overdue.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-rose-600">Overdue tasks</CardTitle><Button size="sm" variant="outline" onClick={() => moveToTomorrow(v.overdue.map((t) => t.id))}><CalendarPlus />Reschedule all to tomorrow</Button></CardHeader>
              <CardContent className="px-2"><TaskList tasks={v.overdue} /></CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="monthly" className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">{fmtKey(monthStart, { month: "long", year: "numeric" })}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric icon={<CheckCircle2 />} label="Tasks completed" value={completedIn(monthStart, monthEnd).length} />
            <Metric icon={<Target />} label="Monthly goals" value={`${monthlyGoals.filter((g) => g.status === "completed").length}/${monthlyGoals.filter((g) => g.status !== "cancelled").length}`} />
            <Metric icon={<Target />} label="Weekly goals done" value={goalsAchieved(monthStart, monthEnd).filter((g) => g.period === "weekly").length} />
            <Metric icon={<Timer />} label="Focus" value={fmtDuration(focusIn(monthStart, monthEnd) * 60)} />
          </div>
          <Card>
            <CardHeader><CardTitle>Monthly objectives</CardTitle><Button size="sm" variant="ghost" asChild><Link href="/goals?new=monthly">New monthly goal <ArrowRight /></Link></Button></CardHeader>
            <CardContent><GoalRows list={monthlyGoals} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReviewPage() {
  return <Suspense fallback={null}><ReviewInner /></Suspense>;
}
