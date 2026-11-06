"use client";
import Link from "next/link";
import {
  AlarmClock, BellRing, CalendarClock, Check, CircleX, Copy, Ellipsis, Flag, ListChecks, Pencil, Play,
  Repeat, RotateCcw, Timer, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PriorityDot, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUI } from "@/components/ui-context";
import { isOpen } from "@/lib/constants";
import { describeRecurrence } from "@/lib/quick-add";
import {
  useCategories, useDeleteTask, useDuplicateTask, useProjects, useSubtaskSummary, useTaskAction, useTz, useUpdateTask,
} from "@/lib/queries";
import type { Task } from "@/lib/types";
import { addDaysKey, dateKey, fmtDuration, fmtTime, fmtWhen, parseKey, todayKey, zonedToUtc } from "@/lib/tz";
import { cn } from "@/lib/utils";

const ACCENT: Record<Task["status"], string> = {
  overdue: "before:bg-rose-500",
  in_progress: "before:bg-violet-500",
  pending: "before:bg-amber-400",
  upcoming: "before:bg-sky-400",
  completed: "before:bg-emerald-500/60",
  cancelled: "before:bg-zinc-400/50",
};

export function TaskItem({ task, timeOnly = false, className }: { task: Task; timeOnly?: boolean; className?: string }) {
  const tz = useTz();
  const { openTask } = useUI();
  const action = useTaskAction();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const dup = useDuplicateTask();
  const { data: projects } = useProjects();
  const { data: categories } = useCategories();
  const { data: subSummary } = useSubtaskSummary();

  const open = isOpen(task.status);
  const done = task.status === "completed";
  const project = projects?.find((p) => p.id === task.project_id);
  const category = categories?.find((c) => c.id === task.category_id);
  const subs = subSummary?.get(task.id);
  const when = task.scheduled_at ?? task.due_at;

  const toggle = () => {
    if (done) {
      action.mutate({ id: task.id, action: "reopen" });
      return;
    }
    action.mutate(
      { id: task.id, action: "complete" },
      {
        onSuccess: () =>
          toast.success("Task completed", {
            description: task.title,
            action: { label: "Undo", onClick: () => action.mutate({ id: task.id, action: "reopen" }) },
          }),
      },
    );
  };

  const shift = (minutes: number) => {
    const move = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + minutes * 60_000).toISOString() : null);
    if (!task.scheduled_at && !task.due_at) {
      const k = addDaysKey(todayKey(tz), Math.max(1, Math.round(minutes / 1440)));
      const { y, m, d } = parseKey(k);
      update.mutate({ id: task.id, patch: { scheduled_at: zonedToUtc(y, m, d, 9, 0, tz).toISOString() } });
    } else {
      update.mutate({ id: task.id, patch: { scheduled_at: move(task.scheduled_at), due_at: move(task.due_at) } });
    }
    toast.success("Task rescheduled");
  };

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50",
        "before:absolute before:top-2.5 before:bottom-2.5 before:left-0 before:w-[3px] before:rounded-full",
        ACCENT[task.status],
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={done ? "Mark as not done" : "Complete task"}
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-emerald-500 hover:bg-emerald-500/10",
          task.status === "cancelled" && "border-dashed",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </button>

      <button type="button" onClick={() => openTask(task.id)} className="min-w-0 flex-1 text-left focus-visible:outline-none">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-sm font-medium", !open && "text-muted-foreground line-through decoration-muted-foreground/50")}>
            {task.title}
          </span>
          {(task.status === "overdue" || task.status === "in_progress" || task.status === "cancelled") && (
            <StatusBadge status={task.status} className="shrink-0" />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {when && (
            <span className={cn("inline-flex items-center gap-1 tabular", task.status === "overdue" && "text-rose-600 dark:text-rose-400")}>
              <CalendarClock className="size-3" />
              {timeOnly && dateKey(when, tz) === todayKey(tz) ? fmtTime(when, tz) : fmtWhen(when, tz)}
              {task.scheduled_at && task.due_at && <span className="opacity-70">· due {fmtWhen(task.due_at, tz)}</span>}
            </span>
          )}
          {task.estimated_minutes && <span className="inline-flex items-center gap-1"><Timer className="size-3" />{fmtDuration(task.estimated_minutes * 60)}</span>}
          {project && (
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-sm" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {category && <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: category.color }} />{category.name}</span>}
          {task.recurrence && <span className="inline-flex items-center gap-1"><Repeat className="size-3" />{describeRecurrence(task.recurrence)}</span>}
          {subs && <span className="inline-flex items-center gap-1 tabular"><ListChecks className="size-3" />{subs.done}/{subs.total}</span>}
          {open && task.next_reminder_at && task.reminder_count > 0 && (
            <span className="inline-flex items-center gap-1" title="Reminders sent">
              <BellRing className="size-3" />{task.reminder_count}
            </span>
          )}
          {task.tags.map((t) => <span key={t} className="text-primary/80">#{t}</span>)}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <PriorityDot priority={task.priority} className="mt-1.5" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7 opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Task actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => openTask(task.id)}><Pencil />Edit</DropdownMenuItem>
            {open && task.status !== "in_progress" && (
              <DropdownMenuItem onSelect={() => action.mutate({ id: task.id, action: "start" })}><Play />Start</DropdownMenuItem>
            )}
            {open && (
              <DropdownMenuItem asChild>
                <Link href={`/focus?task=${task.id}`}><Timer />Focus on this</Link>
              </DropdownMenuItem>
            )}
            {open && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><CalendarClock />Postpone</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => shift(60)}>1 hour later</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => shift(1440)}>Tomorrow</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => shift(3 * 1440)}>In 3 days</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => shift(7 * 1440)}>Next week</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {open && task.reminder_enabled && when && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><AlarmClock />Snooze reminders</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => action.mutate({ id: task.id, action: "snooze", minutes: 60 }, { onSuccess: () => toast("Snoozed for 1 hour") })}>1 hour</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => action.mutate({ id: task.id, action: "snooze", minutes: 180 }, { onSuccess: () => toast("Snoozed for 3 hours") })}>3 hours</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => action.mutate({ id: task.id, action: "snooze_tomorrow" }, { onSuccess: () => toast("Snoozed until tomorrow morning") })}>Until tomorrow</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onSelect={() => dup.mutate(task)}><Copy />Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            {open ? (
              <>
                <DropdownMenuItem onSelect={() => action.mutate({ id: task.id, action: "cancel" }, { onSuccess: () => toast("Task cancelled — kept in history") })}>
                  <CircleX />{task.recurrence ? "Skip this occurrence" : "Cancel task"}
                </DropdownMenuItem>
                {task.recurrence && (
                  <DropdownMenuItem onSelect={() => action.mutate({ id: task.id, action: "cancel", scope: "series" }, { onSuccess: () => toast("Series ended") })}>
                    <Flag />End recurring series
                  </DropdownMenuItem>
                )}
              </>
            ) : (
              <DropdownMenuItem onSelect={() => action.mutate({ id: task.id, action: "reopen" })}><RotateCcw />Reopen</DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                if (confirm(`Delete “${task.title}” permanently? (Cancel keeps it in history instead.)`)) del.mutate(task.id);
              }}
            >
              <Trash2 />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function TaskList({ tasks, timeOnly, empty }: { tasks: Task[]; timeOnly?: boolean; empty?: React.ReactNode }) {
  if (!tasks.length) return <>{empty ?? null}</>;
  return (
    <div className="flex flex-col">
      {tasks.map((t) => <TaskItem key={t.id} task={t} timeOnly={timeOnly} />)}
    </div>
  );
}
