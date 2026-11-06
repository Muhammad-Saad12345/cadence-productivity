"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Flag, Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { useUI } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGoals, useProfile, useUpdateTask } from "@/lib/queries";
import { anchorOf, useTaskViews } from "@/lib/task-views";
import type { Task } from "@/lib/types";
import {
  addDaysKey, addMonthsKey, dateKey, fmtKey, fmtTime, parseKey, startOfMonthKey, startOfWeekKey, zonedParts, zonedToUtc,
} from "@/lib/tz";
import { cn } from "@/lib/utils";

type View = "day" | "week" | "month";

const CHIP: Record<Task["status"], string> = {
  overdue: "bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300",
  in_progress: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300",
  pending: "bg-amber-500/12 text-amber-800 ring-amber-500/30 dark:text-amber-300",
  upcoming: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  completed: "bg-emerald-500/10 text-emerald-700/80 ring-emerald-500/20 line-through dark:text-emerald-300/80",
  cancelled: "bg-muted text-muted-foreground ring-border line-through",
};

function TaskChip({ task, tz, onOpen, showTime = true }: { task: Task; tz: string; onOpen: () => void; showTime?: boolean }) {
  const a = anchorOf(task);
  const draggable = !["completed", "cancelled"].includes(task.status);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      className={cn("flex w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium ring-1 ring-inset", CHIP[task.status], draggable && "cursor-grab active:cursor-grabbing")}
      title={`${task.title}${a ? ` — ${fmtTime(a, tz)}` : ""}`}
    >
      {!task.scheduled_at && task.due_at && <Flag className="size-3 shrink-0" />}
      {showTime && a && <span className="shrink-0 opacity-70 tabular">{fmtTime(a, tz).replace(":00", "").replace(" ", "").toLowerCase()}</span>}
      <span className="truncate">{task.title}</span>
    </button>
  );
}

export default function CalendarPage() {
  const v = useTaskViews();
  const { data: profile } = useProfile();
  const { data: goals } = useGoals();
  const { openTask, openQuickAdd } = useUI();
  const update = useUpdateTask();
  const weekStartsOn = profile?.week_starts_on ?? 1;
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<string>(() => v.today);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of v.all) {
      const a = anchorOf(t);
      if (!a) continue;
      const k = dateKey(a, v.tz);
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [v.all, v.tz]);
  const goalsByDay = useMemo(() => {
    const m = new Map<string, number>();
    (goals ?? []).filter((g) => !["completed", "cancelled"].includes(g.status)).forEach((g) => m.set(g.due_date, (m.get(g.due_date) ?? 0) + 1));
    return m;
  }, [goals]);

  const move = (taskId: string, dayKey: string, hour?: number) => {
    const t = v.all.find((x) => x.id === taskId);
    if (!t) return;
    const a = anchorOf(t);
    const p = a ? zonedParts(a, v.tz) : { hour: 9, minute: 0 };
    const { y, m, d } = parseKey(dayKey);
    const target = zonedToUtc(y, m, d, hour ?? p.hour, hour !== undefined ? 0 : p.minute, v.tz);
    const delta = a ? target.getTime() - new Date(a).getTime() : 0;
    if (a && delta === 0) return;
    const shift = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + delta).toISOString() : null);
    update.mutate(
      { id: t.id, patch: a ? { scheduled_at: shift(t.scheduled_at), due_at: shift(t.due_at) } : { scheduled_at: target.toISOString() } },
      { onSuccess: () => toast.success(`Moved to ${fmtKey(dayKey)}${hour !== undefined ? `, ${hour}:00` : ""}`) },
    );
  };
  const dropProps = (dayKey: string, hour?: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("text/task-id")) {
        e.preventDefault();
        setDragOver(`${dayKey}-${hour ?? ""}`);
      }
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const id = e.dataTransfer.getData("text/task-id");
      if (id) move(id, dayKey, hour);
    },
    "data-over": dragOver === `${dayKey}-${hour ?? ""}` || undefined,
  });
  const addAt = (k: string, hour = 9) => {
    const { y, m, d } = parseKey(k);
    openQuickAdd({ scheduled_at: zonedToUtc(y, m, d, hour, 0, v.tz).toISOString() });
  };

  const step = (dir: number) =>
    setCursor((c) => (view === "month" ? addMonthsKey(startOfMonthKey(c), dir) : addDaysKey(c, dir * (view === "week" ? 7 : 1))));

  const title =
    view === "month" ? fmtKey(startOfMonthKey(cursor), { month: "long", year: "numeric" })
    : view === "week" ? `${fmtKey(startOfWeekKey(cursor, weekStartsOn), { day: "numeric", month: "short" })} – ${fmtKey(addDaysKey(startOfWeekKey(cursor, weekStartsOn), 6), { day: "numeric", month: "short", year: "numeric" })}`
    : fmtKey(cursor, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const weekdayLabels = Array.from({ length: 7 }, (_, i) => fmtKey(addDaysKey(startOfWeekKey(v.today, weekStartsOn), i), { weekday: "short" }));

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Drag a task to another day (or hour in day view) to reschedule it."
        actions={
          <Tabs value={view} onValueChange={(x) => setView(x as View)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft /></Button>
        <Button variant="outline" size="sm" onClick={() => setCursor(v.today)}>Today</Button>
        <Button variant="outline" size="icon-sm" onClick={() => step(1)} aria-label="Next"><ChevronRight /></Button>
        <h2 className="ml-2 text-base font-semibold">{title}</h2>
      </div>

      {view === "month" && (() => {
        const first = startOfMonthKey(cursor);
        const gridStart = startOfWeekKey(first, weekStartsOn);
        const cells = Array.from({ length: 42 }, (_, i) => addDaysKey(gridStart, i));
        return (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-medium text-muted-foreground">
              {weekdayLabels.map((w) => <div key={w} className="py-2">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((k) => {
                const list = (byDay.get(k) ?? []).slice().sort((a, b) => (anchorOf(a)! < anchorOf(b)! ? -1 : 1));
                const inMonth = k.slice(0, 7) === first.slice(0, 7);
                const isToday = k === v.today;
                return (
                  <div
                    key={k}
                    {...dropProps(k)}
                    onClick={() => { setCursor(k); setView("day"); }}
                    className={cn("group min-h-24 cursor-pointer border-r border-b p-1.5 transition-colors last:border-r-0 data-[over]:bg-primary/10 sm:min-h-28 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/30 text-muted-foreground")}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className={cn("flex size-6 items-center justify-center rounded-full text-xs tabular", isToday && "bg-primary font-semibold text-primary-foreground")}>{parseKey(k).d}</span>
                      <span className="flex items-center gap-1">
                        {goalsByDay.get(k) && <Target className="size-3 text-primary" aria-label="Goal deadline" />}
                        <button onClick={(e) => { e.stopPropagation(); addAt(k); }} className="opacity-0 transition group-hover:opacity-100" aria-label={`Add task on ${k}`}><Plus className="size-3.5 text-muted-foreground" /></button>
                      </span>
                    </div>
                    <div className="hidden flex-col gap-0.5 sm:flex">
                      {list.slice(0, 3).map((t) => <TaskChip key={t.id} task={t} tz={v.tz} onOpen={() => openTask(t.id)} />)}
                      {list.length > 3 && <span className="px-1 text-[10px] text-muted-foreground">+{list.length - 3} more</span>}
                    </div>
                    {list.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 sm:hidden">
                        {list.slice(0, 4).map((t) => <span key={t.id} className={cn("size-1.5 rounded-full", t.status === "overdue" ? "bg-rose-500" : t.status === "completed" ? "bg-emerald-500" : "bg-primary")} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {view === "week" && (() => {
        const start = startOfWeekKey(cursor, weekStartsOn);
        const days = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i));
        return (
          <div className="grid gap-2 md:grid-cols-7">
            {days.map((k) => {
              const list = (byDay.get(k) ?? []).slice().sort((a, b) => (anchorOf(a)! < anchorOf(b)! ? -1 : 1));
              return (
                <div key={k} {...dropProps(k)} className={cn("flex min-h-40 flex-col gap-1 rounded-xl border bg-card p-2 transition-colors data-[over]:bg-primary/10", k === v.today && "border-primary/50")}>
                  <div className="mb-1 flex items-center justify-between">
                    <button className="text-left" onClick={() => { setCursor(k); setView("day"); }}>
                      <p className="text-[11px] text-muted-foreground uppercase">{fmtKey(k, { weekday: "short" })}</p>
                      <p className={cn("text-lg leading-none font-semibold tabular", k === v.today && "text-primary")}>{parseKey(k).d}</p>
                    </button>
                    <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => addAt(k)} aria-label={`Add task on ${k}`}><Plus /></Button>
                  </div>
                  {goalsByDay.get(k) && <p className="flex items-center gap-1 text-[10px] text-primary"><Target className="size-3" />Goal due</p>}
                  {list.map((t) => <TaskChip key={t.id} task={t} tz={v.tz} onOpen={() => openTask(t.id)} />)}
                </div>
              );
            })}
          </div>
        );
      })()}

      {view === "day" && (() => {
        const list = byDay.get(cursor) ?? [];
        const hours = Array.from({ length: 24 }, (_, h) => h);
        const at = (h: number) => list.filter((t) => zonedParts(anchorOf(t)!, v.tz).hour === h);
        const nowH = cursor === v.today ? zonedParts(new Date(), v.tz).hour : -1;
        return (
          <div className="overflow-hidden rounded-xl border bg-card">
            {hours.map((h) => (
              <div key={h} {...dropProps(cursor, h)} className={cn("group flex min-h-11 border-b transition-colors last:border-b-0 data-[over]:bg-primary/10", h === nowH && "bg-primary/[0.04]")}>
                <div className={cn("w-16 shrink-0 border-r px-2 py-1.5 text-right text-[11px] text-muted-foreground tabular", h === nowH && "font-semibold text-primary")}>
                  {new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, h)))}
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-1 p-1">
                  {at(h).map((t) => <div key={t.id} className="w-full sm:w-auto sm:min-w-56"><TaskChip task={t} tz={v.tz} onOpen={() => openTask(t.id)} /></div>)}
                  <button onClick={() => addAt(cursor, h)} className="ml-auto rounded p-1 opacity-0 transition group-hover:opacity-100" aria-label={`Add task at ${h}:00`}><Plus className="size-3.5 text-muted-foreground" /></button>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {(["upcoming", "pending", "in_progress", "overdue", "completed"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm ring-1 ring-inset", CHIP[s])} />{s.replace("_", " ")}</span>
        ))}
        <span className="flex items-center gap-1.5"><Flag className="size-3" />deadline only</span>
        <span className="flex items-center gap-1.5"><Target className="size-3 text-primary" />goal due</span>
      </div>
    </div>
  );
}
