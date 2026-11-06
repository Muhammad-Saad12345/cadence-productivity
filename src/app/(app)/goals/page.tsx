"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Check, CircleX, Ellipsis, Flag, Minus, Pencil, Plus, RotateCcw, Target, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { GoalStatusBadge, PriorityLabel } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { ProgressRing } from "@/components/progress-ring";
import { TaskList } from "@/components/task-item";
import { useUI } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITIES } from "@/lib/constants";
import {
  type GoalInput, useCategories, useDeleteGoal, useGoals, useMilestoneMutations, useMilestones, useProfile, useTasks, useUpsertGoal,
} from "@/lib/queries";
import type { Goal, GoalPeriod, Priority, ProgressMode } from "@/lib/types";
import { addDaysKey, addMonthsKey, fmtKey, startOfMonthKey, startOfWeekKey, todayKey } from "@/lib/tz";
import { cn } from "@/lib/utils";

const NONE = "__none";
const MODES: { value: ProgressMode; label: string; hint: string }[] = [
  { value: "tasks", label: "Linked tasks", hint: "Progress = completed linked tasks ÷ all linked tasks" },
  { value: "milestones", label: "Milestones", hint: "Progress = milestones checked off" },
  { value: "target", label: "Measurable target", hint: "e.g. read 10 chapters, run 20 km" },
  { value: "children", label: "Weekly goals (monthly only)", hint: "Average of the weekly goals linked to it" },
  { value: "manual", label: "Manual %", hint: "Set the percentage yourself" },
];

function defaultDates(period: GoalPeriod, tz: string, weekStartsOn: number) {
  const today = todayKey(tz);
  if (period === "weekly") {
    const s = startOfWeekKey(today, weekStartsOn);
    return { start_date: s, due_date: addDaysKey(s, 6) };
  }
  const s = startOfMonthKey(today);
  return { start_date: s, due_date: addDaysKey(addMonthsKey(s, 1), -1) };
}

function GoalForm({ open, onOpenChange, goal, initialPeriod }: { open: boolean; onOpenChange: (o: boolean) => void; goal?: Goal; initialPeriod?: GoalPeriod }) {
  const { data: profile } = useProfile();
  const tz = profile?.timezone ?? "Asia/Karachi";
  const { data: categories } = useCategories();
  const { data: goals } = useGoals();
  const upsert = useUpsertGoal();
  const blank = (p: GoalPeriod): GoalInput => ({
    title: "", description: "", period: p, priority: "medium", progress_mode: "tasks", target_value: null, unit: "",
    reminder_frequency: "default", category_id: null, parent_goal_id: null, ...defaultDates(p, tz, profile?.week_starts_on ?? 1),
  });
  const [f, setF] = useState<GoalInput>(() => (goal ? { ...goal } : blank(initialPeriod ?? "weekly")));
  useEffect(() => {
    if (open) setF(goal ? { ...goal } : blank(initialPeriod ?? "weekly"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);
  const set = <K extends keyof GoalInput>(k: K, val: GoalInput[K]) => setF((x) => ({ ...x, [k]: val }));
  const monthlies = (goals ?? []).filter((g) => g.period === "monthly" && g.status !== "cancelled" && g.id !== goal?.id);

  const save = async () => {
    if (!f.title?.trim()) return toast.error("Give the goal a title");
    if (f.progress_mode === "target" && !(Number(f.target_value) > 0)) return toast.error("Set a target value");
    if (f.progress_mode === "children" && f.period !== "monthly") return toast.error("Only monthly goals can roll up weekly goals");
    if ((f.due_date ?? "") < (f.start_date ?? "")) return toast.error("Deadline is before the start date");
    const row: GoalInput & { id?: string } = {
      id: goal?.id, title: f.title!.trim(), description: f.description?.trim() || null, period: f.period, priority: f.priority,
      start_date: f.start_date, due_date: f.due_date, progress_mode: f.progress_mode,
      target_value: f.progress_mode === "target" ? Number(f.target_value) : f.target_value ?? null,
      unit: f.unit || null, category_id: f.category_id ?? null, reminder_frequency: f.reminder_frequency,
      parent_goal_id: f.period === "weekly" ? f.parent_goal_id ?? null : null,
    };
    if (f.progress_mode === "manual" && !goal) row.progress_pct = 0;
    await upsert.mutateAsync(row);
    toast.success(goal ? "Goal updated" : "Goal created");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
          <DialogDescription>Make it specific and achievable within the period.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Input autoFocus placeholder="e.g. Finish the authentication module" value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} className="h-11 text-base font-medium" aria-label="Goal title" />
          <Textarea placeholder="Why it matters / definition of done" value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Period</Label>
              <Tabs value={f.period} onValueChange={(p) => setF((x) => ({ ...x, period: p as GoalPeriod, ...(goal ? {} : defaultDates(p as GoalPeriod, tz, profile?.week_starts_on ?? 1)) }))}>
                <TabsList className="w-full">
                  <TabsTrigger value="weekly" className="flex-1">Weekly</TabsTrigger>
                  <TabsTrigger value="monthly" className="flex-1">Monthly</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={f.priority} onValueChange={(v) => set("priority", v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-start">Start date</Label>
              <Input id="g-start" type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-due">Deadline</Label>
              <Input id="g-due" type="date" value={f.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>How is progress measured?</Label>
              <Select value={f.progress_mode} onValueChange={(v) => set("progress_mode", v as ProgressMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODES.filter((m) => m.value !== "children" || f.period === "monthly").map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === f.progress_mode)?.hint}</p>
            </div>
            {f.progress_mode === "target" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="g-target">Target</Label>
                  <Input id="g-target" type="number" min={0.01} step="any" value={f.target_value ?? ""} onChange={(e) => set("target_value", e.target.value === "" ? null : Number(e.target.value))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="g-unit">Unit</Label>
                  <Input id="g-unit" placeholder="chapters, km, hours…" value={f.unit ?? ""} onChange={(e) => set("unit", e.target.value)} />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={f.category_id ?? NONE} onValueChange={(v) => set("category_id", v === NONE ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Reminders</Label>
              <Select value={f.reminder_frequency} onValueChange={(v) => set("reminder_frequency", v as Goal["reminder_frequency"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Use my settings</SelectItem>
                  <SelectItem value="daily">Daily check-in</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {f.period === "weekly" && monthlies.length > 0 && (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Part of monthly goal</Label>
                <Select value={f.parent_goal_id ?? NONE} onValueChange={(v) => set("parent_goal_id", v === NONE ? null : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {monthlies.map((g) => <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={upsert.isPending}>{goal ? "Save" : "Create goal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function progressDetail(g: Goal, linked: { done: number; total: number }, ms: { done: number; total: number }, children: number) {
  switch (g.progress_mode) {
    case "tasks": return linked.total ? `${linked.done}/${linked.total} tasks` : "No linked tasks yet";
    case "milestones": return ms.total ? `${ms.done}/${ms.total} milestones` : "No milestones yet";
    case "target": return `${Number(g.current_value)}/${Number(g.target_value)} ${g.unit ?? ""}`.trim();
    case "children": return children ? `${children} weekly goals` : "No weekly goals linked";
    default: return "Manual progress";
  }
}

function GoalDetail({ goal, onClose, onEdit }: { goal: Goal | null; onClose: () => void; onEdit: (g: Goal) => void }) {
  const { openTask } = useUI();
  const { data: tasks } = useTasks();
  const { data: milestones } = useMilestones(goal?.id);
  const { data: goals } = useGoals();
  const upsert = useUpsertGoal();
  const ms = useMilestoneMutations();
  const [draft, setDraft] = useState("");
  if (!goal) return null;
  const linked = (tasks ?? []).filter((t) => t.goal_id === goal.id);
  const children = (goals ?? []).filter((g) => g.parent_goal_id === goal.id);
  const closed = goal.status === "completed" || goal.status === "cancelled";

  return (
    <Sheet open={!!goal} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-4 pr-8">
          <ProgressRing value={Number(goal.progress_pct)} size={56} stroke={5} />
          <div className="min-w-0">
            <SheetTitle className="text-lg leading-snug">{goal.title}</SheetTitle>
            <SheetDescription className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase">{goal.period}</span>
              <GoalStatusBadge status={goal.status} />
              <span className="text-xs">{fmtKey(goal.start_date)} → {fmtKey(goal.due_date)}</span>
            </SheetDescription>
          </div>
        </div>
        {goal.description && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{goal.description}</p>}

        {goal.progress_mode === "target" && (
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">Progress</p>
            <div className="mt-3 flex items-center gap-3">
              <Button size="icon-sm" variant="outline" disabled={closed || Number(goal.current_value) <= 0} onClick={() => upsert.mutate({ id: goal.id, current_value: Math.max(0, Number(goal.current_value) - 1) })} aria-label="Decrease"><Minus /></Button>
              <Input type="number" className="h-8 w-24 text-center" defaultValue={Number(goal.current_value)} key={goal.current_value} disabled={closed}
                onBlur={(e) => upsert.mutate({ id: goal.id, current_value: Math.max(0, Number(e.target.value) || 0) })} aria-label="Current value" />
              <Button size="icon-sm" variant="outline" disabled={closed} onClick={() => upsert.mutate({ id: goal.id, current_value: Number(goal.current_value) + 1 })} aria-label="Increase"><Plus /></Button>
              <span className="text-sm text-muted-foreground">of {Number(goal.target_value)} {goal.unit}</span>
            </div>
          </div>
        )}
        {goal.progress_mode === "manual" && (
          <div className="rounded-xl border p-4">
            <Label htmlFor="g-manual">Progress {Math.round(goal.progress_pct)}%</Label>
            <input id="g-manual" type="range" min={0} max={100} step={5} defaultValue={Number(goal.progress_pct)} key={goal.progress_pct} disabled={closed}
              onPointerUp={(e) => upsert.mutate({ id: goal.id, progress_pct: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => upsert.mutate({ id: goal.id, progress_pct: Number((e.target as HTMLInputElement).value) })}
              className="mt-3 w-full accent-[var(--primary)]" />
          </div>
        )}

        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Milestones</h3>
            <span className="text-xs text-muted-foreground">{goal.progress_mode === "milestones" ? "drive progress" : "for planning"}</span>
          </div>
          {(milestones ?? []).map((m) => (
            <div key={m.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
              <Checkbox checked={m.done} onCheckedChange={(v) => ms.toggle.mutate({ id: m.id, done: v === true })} aria-label={m.title} />
              <span className={cn("flex-1 text-sm", m.done && "text-muted-foreground line-through")}>{m.title}</span>
              {m.target_date && <span className="text-xs text-muted-foreground">{fmtKey(m.target_date)}</span>}
              <button onClick={() => ms.remove.mutate(m.id)} className="opacity-0 group-hover:opacity-100" aria-label="Remove milestone"><X className="size-3.5 text-muted-foreground" /></button>
            </div>
          ))}
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            ms.add.mutate({ goal_id: goal.id, title: draft.trim(), position: (milestones?.length ?? 0) + 1 });
            setDraft("");
          }}>
            <Input className="h-8" placeholder="Add a milestone" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button size="sm" variant="outline" type="submit"><Plus />Add</Button>
          </form>
        </section>

        <section className="grid gap-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Linked tasks</h3>
            <Button size="sm" variant="ghost" onClick={() => openTask(null, { goal_id: goal.id })}><Plus />Task</Button>
          </div>
          <TaskList tasks={linked} empty={<p className="text-xs text-muted-foreground">Break this goal into tasks; completing them moves the goal forward{goal.progress_mode === "tasks" ? "" : " (progress mode is not ‘Linked tasks’)"}.</p>} />
        </section>

        {goal.period === "monthly" && (
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold">Weekly goals</h3>
            {children.length === 0 && <p className="text-xs text-muted-foreground">Link weekly goals to this monthly goal from their edit form.</p>}
            {children.map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{c.title}</span>
                <Progress value={Number(c.progress_pct)} className="w-24" />
                <span className="w-10 text-right text-xs tabular">{Math.round(c.progress_pct)}%</span>
              </div>
            ))}
          </section>
        )}

        <div className="mt-auto flex flex-wrap gap-2 border-t pt-4">
          {!closed && <Button size="sm" variant="success" onClick={() => upsert.mutate({ id: goal.id, status: "completed" })}><Check />Mark achieved</Button>}
          <Button size="sm" variant="outline" onClick={() => onEdit(goal)}><Pencil />Edit</Button>
          {closed && <Button size="sm" variant="outline" onClick={() => upsert.mutate({ id: goal.id, status: "in_progress" })}><RotateCcw />Reopen</Button>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function GoalsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: goals, isLoading } = useGoals();
  const { data: tasks } = useTasks();
  const { data: milestones } = useMilestones();
  const upsert = useUpsertGoal();
  const del = useDeleteGoal();
  const [tab, setTab] = useState<"weekly" | "monthly" | "completed" | "all">("weekly");
  const [form, setForm] = useState<{ open: boolean; goal?: Goal; period?: GoalPeriod }>({ open: false });
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const n = params.get("new");
    const g = params.get("goal") ?? params.get("celebrate");
    if (n === "weekly" || n === "monthly") setForm({ open: true, period: n });
    if (g) setDetailId(g);
    if (n || g) router.replace("/goals");
  }, [params, router]);

  const stats = useMemo(() => {
    const linked = new Map<string, { done: number; total: number }>();
    for (const t of tasks ?? []) {
      if (!t.goal_id || t.status === "cancelled") continue;
      const m = linked.get(t.goal_id) ?? { done: 0, total: 0 };
      m.total++;
      if (t.status === "completed") m.done++;
      linked.set(t.goal_id, m);
    }
    const ms = new Map<string, { done: number; total: number }>();
    for (const m of milestones ?? []) {
      const x = ms.get(m.goal_id) ?? { done: 0, total: 0 };
      x.total++;
      if (m.done) x.done++;
      ms.set(m.goal_id, x);
    }
    return { linked, ms };
  }, [tasks, milestones]);

  const list = (goals ?? []).filter((g) =>
    tab === "all" ? true : tab === "completed" ? g.status === "completed" : g.period === tab && !["completed", "cancelled"].includes(g.status),
  );
  const active = (goals ?? []).filter((g) => !["completed", "cancelled"].includes(g.status));
  const detail = goals?.find((g) => g.id === detailId) ?? null;

  return (
    <div>
      <PageHeader
        title="Goals"
        description={`${active.length} active · ${(goals ?? []).filter((g) => g.status === "completed").length} achieved`}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setForm({ open: true, period: "monthly" })}><Plus />Monthly goal</Button>
            <Button size="sm" onClick={() => setForm({ open: true, period: "weekly" })}><Plus />Weekly goal</Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-5">
        <TabsList>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="completed">Achieved</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      {!isLoading && list.length === 0 && (
        <EmptyState icon={<Target />} title={tab === "completed" ? "No achieved goals yet" : `No active ${tab === "all" ? "" : tab} goals`}
          description="Good goals are specific, measurable and fit the period."
          action={tab !== "completed" && <Button size="sm" onClick={() => setForm({ open: true, period: tab === "monthly" ? "monthly" : "weekly" })}><Plus />Create goal</Button>} />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((g) => {
          const parent = goals?.find((p) => p.id === g.parent_goal_id);
          const childCount = (goals ?? []).filter((c) => c.parent_goal_id === g.id).length;
          return (
            <Card key={g.id} className={cn("group flex cursor-pointer flex-col gap-3 p-4 transition hover:shadow-md", g.status === "completed" && "bg-emerald-500/[0.03]")}
              onClick={() => setDetailId(g.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setDetailId(g.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{g.period}</span>
                    <GoalStatusBadge status={g.status} />
                  </div>
                  <p className="leading-snug font-medium">{g.title}</p>
                  {parent && <p className="mt-0.5 truncate text-xs text-muted-foreground">↳ {parent.title}</p>}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-60 group-hover:opacity-100" aria-label="Goal actions"><Ellipsis /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => setForm({ open: true, goal: g })}><Pencil />Edit</DropdownMenuItem>
                    {g.status !== "completed" && <DropdownMenuItem onSelect={() => upsert.mutate({ id: g.id, status: "completed" })}><Flag />Mark achieved</DropdownMenuItem>}
                    {g.status !== "cancelled" && g.status !== "completed" && <DropdownMenuItem onSelect={() => upsert.mutate({ id: g.id, status: "cancelled" })}><CircleX />Cancel goal</DropdownMenuItem>}
                    {(g.status === "completed" || g.status === "cancelled") && <DropdownMenuItem onSelect={() => upsert.mutate({ id: g.id, status: "in_progress" })}><RotateCcw />Reopen</DropdownMenuItem>}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => confirm("Delete this goal? Linked tasks are kept.") && del.mutate(g.id)}><Trash2 />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{progressDetail(g, stats.linked.get(g.id) ?? { done: 0, total: 0 }, stats.ms.get(g.id) ?? { done: 0, total: 0 }, childCount)}</span>
                  <span className="font-semibold tabular">{Math.round(g.progress_pct)}%</span>
                </div>
                <Progress value={Number(g.progress_pct)} className="h-2" indicatorClassName={g.status === "completed" ? "bg-emerald-500" : g.status === "at_risk" ? "bg-amber-500" : undefined} />
              </div>
              <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                <PriorityLabel priority={g.priority} />
                <span>Due {fmtKey(g.due_date)}</span>
              </div>
            </Card>
          );
        })}
      </div>
      <GoalForm open={form.open} goal={form.goal} initialPeriod={form.period} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} />
      <GoalDetail goal={detail} onClose={() => setDetailId(null)} onEdit={(g) => setForm({ open: true, goal: g })} />
    </div>
  );
}

export default function GoalsPage() {
  return (
    <Suspense fallback={null}>
      <GoalsInner />
    </Suspense>
  );
}
