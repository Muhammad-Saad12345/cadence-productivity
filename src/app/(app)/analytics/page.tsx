"use client";
import { useMemo, useState } from "react";
import { Award, CheckCircle2, Flame, Medal, Target, Timer, Trophy } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PRIORITIES } from "@/lib/constants";
import { useAchievements, useAnalytics, useCategories, useGoals, useStreaks, useTasks, useTz } from "@/lib/queries";
import { dateKey, fmtDate, fmtDuration, fmtKey, todayKey, addDaysKey } from "@/lib/tz";
import { cn } from "@/lib/utils";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 };

export default function AnalyticsPage() {
  const tz = useTz();
  const [days, setDays] = useState(30);
  const { data: series } = useAnalytics(days);
  const { data: streaks } = useStreaks();
  const { data: achievements } = useAchievements();
  const { data: goals } = useGoals();
  const { data: tasks } = useTasks();
  const { data: categories } = useCategories();

  const data = (series ?? []).map((d) => ({ ...d, label: fmtKey(d.day, days > 31 ? { day: "numeric", month: "short" } : { day: "numeric", month: "short" }) }));
  const totals = data.reduce((a, d) => ({ completed: a.completed + d.completed, created: a.created + d.created, cancelled: a.cancelled + d.cancelled, focus: a.focus + d.focus_minutes }), { completed: 0, created: 0, cancelled: 0, focus: 0 });
  const activeDays = data.filter((d) => d.completed > 0).length;

  const since = addDaysKey(todayKey(tz), -(days - 1));
  const breakdown = useMemo(() => {
    const done = (tasks ?? []).filter((t) => t.status === "completed" && t.completed_at && dateKey(t.completed_at, tz) >= since);
    const byCat = new Map<string, number>();
    const byPrio = new Map<string, number>();
    let onTime = 0;
    let withDeadline = 0;
    for (const t of done) {
      byCat.set(t.category_id ?? "none", (byCat.get(t.category_id ?? "none") ?? 0) + 1);
      byPrio.set(t.priority, (byPrio.get(t.priority) ?? 0) + 1);
      if (t.due_at) {
        withDeadline++;
        if (t.completed_at! <= t.due_at) onTime++;
      }
    }
    return { done: done.length, byCat, byPrio, onTime, withDeadline };
  }, [tasks, tz, since]);

  const periodGoals = (goals ?? []).filter((g) => g.due_date >= since && g.status !== "cancelled");
  const goalRate = periodGoals.length ? (periodGoals.filter((g) => g.status === "completed").length / periodGoals.length) * 100 : 0;
  const badges = (achievements ?? []).filter((a) => a.kind === "badge");
  const goalWins = (achievements ?? []).filter((a) => a.kind === "goal_completed");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Analytics" description="Your productivity over time."
        actions={
          <Tabs value={String(days)} onValueChange={(x) => setDays(Number(x))}>
            <TabsList><TabsTrigger value="7">7 days</TabsTrigger><TabsTrigger value="30">30 days</TabsTrigger><TabsTrigger value="90">90 days</TabsTrigger></TabsList>
          </Tabs>
        } />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { icon: <CheckCircle2 />, label: "Completed", value: totals.completed, hint: `${(totals.completed / Math.max(1, days)).toFixed(1)} / day` },
          { icon: <Target />, label: "Goal completion", value: `${Math.round(goalRate)}%`, hint: `${periodGoals.filter((g) => g.status === "completed").length}/${periodGoals.length} goals` },
          { icon: <Timer />, label: "Focus time", value: fmtDuration(totals.focus * 60), hint: `${activeDays} active days` },
          { icon: <Flame />, label: "Current streak", value: `${streaks?.current_streak ?? 0}d`, hint: `best ${streaks?.best_streak ?? 0}d` },
          { icon: <CheckCircle2 />, label: "On time", value: breakdown.withDeadline ? `${Math.round((breakdown.onTime / breakdown.withDeadline) * 100)}%` : "—", hint: "of tasks with deadlines" },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">{s.icon}{s.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><div><CardTitle>Tasks completed vs created</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">{totals.created} created · {totals.completed} completed · {totals.cancelled} cancelled</p></div></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="completed" name="Completed" stroke="var(--chart-2)" fill="url(#gc)" strokeWidth={2} />
                <Area type="monotone" dataKey="created" name="Created" stroke="var(--chart-1)" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Focus minutes</CardTitle></CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="focus_minutes" name="Focus min" fill="var(--chart-1)" radius={[4, 4, 1, 1]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Completed by category & priority</CardTitle></CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              {[...breakdown.byCat.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => {
                const c = categories?.find((x) => x.id === id);
                return (
                  <div key={id} className="flex items-center gap-3 text-sm">
                    <span className="w-24 truncate">{c?.name ?? "Uncategorised"}</span>
                    <Progress value={(n / Math.max(1, breakdown.done)) * 100} className="flex-1" indicatorClassName="bg-[var(--c)]" style={{ ["--c" as string]: c?.color ?? "var(--muted-foreground)" }} />
                    <span className="w-8 text-right text-xs tabular">{n}</span>
                  </div>
                );
              })}
              {breakdown.done === 0 && <p className="text-sm text-muted-foreground">No completed tasks in this period.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((p) => (
                <span key={p.value} className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs">
                  <span className={cn("size-2 rounded-full", p.dot)} />{p.label}<b className="tabular">{breakdown.byPrio.get(p.value) ?? 0}</b>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><div><CardTitle>Achievements</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">{goalWins.length} goals achieved · {badges.length} badges</p></div></CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {badges.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-200 to-amber-400 text-amber-900 dark:from-amber-400/30 dark:to-amber-600/30 dark:text-amber-200">
                  {b.code.startsWith("streak") ? <Flame className="size-5" /> : b.code.includes("goal") ? <Trophy className="size-5" /> : <Medal className="size-5" />}
                </div>
                <div className="min-w-0"><p className="text-sm font-medium">{b.title}</p><p className="truncate text-xs text-muted-foreground">{b.description} · {fmtDate(b.earned_at, tz, { day: "numeric", month: "short" })}</p></div>
              </div>
            ))}
            {badges.length === 0 && <p className="text-sm text-muted-foreground">Badges unlock as you complete tasks, keep streaks and achieve goals.</p>}
          </div>
          {goalWins.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase">Goal history</p>
              {goalWins.slice(0, 12).map((a) => (
                <p key={a.id} className="flex items-center gap-2 text-sm"><Award className="size-4 text-amber-500" /><span className="flex-1 truncate">{a.description}</span><span className="text-xs text-muted-foreground">{a.title.replace(" achieved", "")} · {fmtDate(a.earned_at, tz, { day: "numeric", month: "short", year: "numeric" })}</span></p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
