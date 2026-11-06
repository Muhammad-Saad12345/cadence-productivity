"use client";
import { useEffect, useMemo, useState } from "react";
import { BellOff, BellRing, Check, CircleX, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isOpen, PRIORITIES, WEEKDAYS } from "@/lib/constants";
import {
  type TaskInput, useCategories, useCreateTask, useDeleteTask, useGoals, useProjects, useSubtaskMutations, useSubtasks,
  useTaskAction, useTasks, useTz, useUpdateTask,
} from "@/lib/queries";
import type { Priority, Recurrence, RecurrenceFreq, Task } from "@/lib/types";
import { fmtDuration, fmtWhen, fromLocalInput, toLocalInput } from "@/lib/tz";
import { cn } from "@/lib/utils";

const NONE = "__none";

interface FormState {
  title: string;
  description: string;
  notes: string;
  scheduled: string;
  due: string;
  estimate: string;
  priority: Priority;
  category_id: string;
  project_id: string;
  goal_id: string;
  tags: string;
  reminder_enabled: boolean;
  in_progress: boolean;
  freq: RecurrenceFreq | "none";
  interval: string;
  byweekday: number[];
  until: string;
}

function toForm(t: Partial<Task> | undefined, tz: string): FormState {
  const r = t?.recurrence ?? null;
  return {
    title: t?.title ?? "",
    description: t?.description ?? "",
    notes: t?.notes ?? "",
    scheduled: toLocalInput(t?.scheduled_at, tz),
    due: toLocalInput(t?.due_at, tz),
    estimate: t?.estimated_minutes ? String(t.estimated_minutes) : "",
    priority: t?.priority ?? "medium",
    category_id: t?.category_id ?? NONE,
    project_id: t?.project_id ?? NONE,
    goal_id: t?.goal_id ?? NONE,
    tags: (t?.tags ?? []).join(", "),
    reminder_enabled: t?.reminder_enabled ?? true,
    in_progress: t?.status === "in_progress",
    freq: r?.freq ?? "none",
    interval: String(r?.interval ?? 1),
    byweekday: r?.byweekday ?? [],
    until: r?.until ?? "",
  };
}

function toInput(f: FormState, tz: string): TaskInput & { title: string } {
  const recurrence: Recurrence | null =
    f.freq === "none" ? null : {
      freq: f.freq,
      ...(Number(f.interval) > 1 ? { interval: Number(f.interval) } : {}),
      ...((f.freq === "weekly" || f.freq === "custom") && f.byweekday.length ? { byweekday: [...f.byweekday].sort() } : {}),
      ...(f.until ? { until: f.until } : {}),
    };
  return {
    title: f.title.trim(),
    description: f.description.trim() || null,
    notes: f.notes.trim() || null,
    scheduled_at: f.scheduled ? fromLocalInput(f.scheduled, tz) : null,
    due_at: f.due ? fromLocalInput(f.due, tz) : null,
    estimated_minutes: f.estimate ? Math.max(1, Math.round(Number(f.estimate))) : null,
    priority: f.priority,
    category_id: f.category_id === NONE ? null : f.category_id,
    project_id: f.project_id === NONE ? null : f.project_id,
    goal_id: f.goal_id === NONE ? null : f.goal_id,
    tags: f.tags.split(/[,\s]+/).map((s) => s.replace(/^#/, "").trim().toLowerCase()).filter(Boolean),
    reminder_enabled: f.reminder_enabled,
    recurrence,
  };
}

export function TaskEditor({
  open, onOpenChange, taskId, defaults,
}: { open: boolean; onOpenChange: (o: boolean) => void; taskId: string | null; defaults?: TaskInput }) {
  const tz = useTz();
  const { data: tasks } = useTasks();
  const task = useMemo(() => tasks?.find((t) => t.id === taskId), [tasks, taskId]);
  const [form, setForm] = useState<FormState>(() => toForm(task ?? (defaults as Partial<Task>), tz));
  const [newSubs, setNewSubs] = useState<string[]>([]);
  const [subDraft, setSubDraft] = useState("");

  const { data: categories } = useCategories();
  const { data: projects } = useProjects();
  const { data: goals } = useGoals();
  const create = useCreateTask();
  const update = useUpdateTask();
  const action = useTaskAction();
  const del = useDeleteTask();
  const { data: subtasks } = useSubtasks(taskId);
  const subMut = useSubtaskMutations(taskId ?? "");

  // Reset the form whenever a different task (or a new one) is opened.
  useEffect(() => {
    if (open) {
      setForm(toForm(task ?? (defaults as Partial<Task>), tz));
      setNewSubs([]);
      setSubDraft("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const activeGoals = (goals ?? []).filter((g) => g.status !== "cancelled" && (g.status !== "completed" || g.id === form.goal_id));
  const closed = task && !isOpen(task.status);

  const save = async () => {
    if (!form.title.trim()) {
      toast.error("Give the task a title");
      return;
    }
    if (form.scheduled && form.due && form.due < form.scheduled) {
      toast.error("The deadline is before the start time");
      return;
    }
    const input = toInput(form, tz);
    if (task) {
      const patch: TaskInput = { ...input };
      if (isOpen(task.status)) {
        if (form.in_progress && task.status !== "in_progress") patch.status = "in_progress";
        if (!form.in_progress && task.status === "in_progress") patch.status = "pending";
      }
      await update.mutateAsync({ id: task.id, patch });
      toast.success("Task saved");
    } else {
      await create.mutateAsync({ ...input, status: form.in_progress ? "in_progress" : "pending", subtasks: newSubs });
      toast.success("Task created", { description: input.scheduled_at ? `Reminder ${fmtWhen(input.scheduled_at, tz)}` : undefined });
    }
    onOpenChange(false);
  };

  const addSub = () => {
    const title = subDraft.trim();
    if (!title) return;
    if (task) subMut.add.mutate({ title, position: (subtasks?.length ?? 0) + 1 });
    else setNewSubs((s) => [...s, title]);
    setSubDraft("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" onOpenAutoFocus={(e) => { if (task) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task ? "Edit task" : "New task"}
            {task && <StatusBadge status={task.status} />}
          </DialogTitle>
          <DialogDescription>
            {task?.next_reminder_at && isOpen(task.status)
              ? `Next reminder ${fmtWhen(task.next_reminder_at, tz)}${task.reminder_count ? ` · ${task.reminder_count} sent` : ""}`
              : `Times are in ${tz.replace("_", " ")}.`}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            autoFocus={!task}
            placeholder="What needs to be done?"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className="h-11 text-base font-medium"
            aria-label="Title"
          />
          <Textarea placeholder="Description" value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} aria-label="Description" />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="t-start">Date & reminder time</Label>
              <Input id="t-start" type="datetime-local" value={form.scheduled} onChange={(e) => set("scheduled", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-due">Deadline</Label>
              <Input id="t-due" type="datetime-local" value={form.due} onChange={(e) => set("due", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className={cn("size-2 rounded-full", p.dot)} />{p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-est">Estimated duration (minutes)</Label>
              <Input id="t-est" type="number" min={1} max={10080} inputMode="numeric" placeholder="e.g. 45" value={form.estimate} onChange={(e) => set("estimate", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={form.category_id} onValueChange={(v) => set("category_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}><span className="size-2 rounded-full" style={{ background: c.color }} />{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Project</Label>
              <Select value={form.project_id} onValueChange={(v) => set("project_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No project</SelectItem>
                  {projects?.filter((p) => !p.archived_at || p.id === form.project_id).map((p) => (
                    <SelectItem key={p.id} value={p.id}><span className="size-2 rounded-sm" style={{ background: p.color }} />{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Contributes to goal</Label>
              <Select value={form.goal_id} onValueChange={(v) => set("goal_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No goal</SelectItem>
                  {activeGoals.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{g.period === "weekly" ? "W" : "M"}</span>{g.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="t-tags">Tags</Label>
              <Input id="t-tags" placeholder="study, urgent, client-a" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
            </div>
          </div>

          {/* Recurrence */}
          <div className="grid gap-2 rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Label className="min-w-16">Repeat</Label>
              <Select value={form.freq} onValueChange={(v) => set("freq", v as FormState["freq"])}>
                <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Does not repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {form.freq !== "none" && form.freq !== "weekdays" && !(form.byweekday.length && (form.freq === "weekly" || form.freq === "custom")) && (
                <div className="flex items-center gap-2 text-sm">
                  every
                  <Input type="number" min={1} max={365} className="h-8 w-16" value={form.interval} onChange={(e) => set("interval", e.target.value)} aria-label="Interval" />
                  {form.freq === "daily" || form.freq === "custom" ? "day(s)" : form.freq === "weekly" ? "week(s)" : "month(s)"}
                </div>
              )}
              {form.freq !== "none" && (
                <div className="flex items-center gap-2 text-sm">
                  until
                  <Input type="date" className="h-8 w-40" value={form.until} onChange={(e) => set("until", e.target.value)} aria-label="Repeat until" />
                </div>
              )}
            </div>
            {(form.freq === "weekly" || form.freq === "custom") && (
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => {
                  const on = form.byweekday.includes(d.iso);
                  return (
                    <button
                      type="button"
                      key={d.iso}
                      onClick={() => set("byweekday", on ? form.byweekday.filter((x) => x !== d.iso) : [...form.byweekday, d.iso])}
                      className={cn("h-7 rounded-md border px-2.5 text-xs font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
                      aria-pressed={on}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            )}
            {form.freq !== "none" && !form.scheduled && !form.due && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Set a date for the repeat schedule to start from.</p>
            )}
          </div>

          {/* Subtasks */}
          <div className="grid gap-2">
            <Label>Subtasks</Label>
            <div className="grid gap-1">
              {(task ? subtasks ?? [] : newSubs.map((title, i) => ({ id: String(i), title, done: false }))).map((s) => (
                <div key={s.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
                  <Checkbox
                    checked={s.done}
                    disabled={!task}
                    onCheckedChange={(v) => task && subMut.toggle.mutate({ id: s.id, done: v === true })}
                    aria-label={`Subtask ${s.title}`}
                  />
                  <span className={cn("flex-1 text-sm", s.done && "text-muted-foreground line-through")}>{s.title}</span>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => (task ? subMut.remove.mutate(s.id) : setNewSubs((x) => x.filter((_, i) => String(i) !== s.id)))}
                    aria-label="Remove subtask"
                  >
                    <X className="size-3.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add a subtask"
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSub();
                  }
                }}
                className="h-8"
              />
              <Button type="button" size="sm" variant="outline" onClick={addSub}><Plus />Add</Button>
            </div>
          </div>

          <Textarea placeholder="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} aria-label="Notes" />

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-muted/50 px-3 py-2.5">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.reminder_enabled} onCheckedChange={(v) => set("reminder_enabled", v)} />
              {form.reminder_enabled ? <BellRing className="size-4 text-primary" /> : <BellOff className="size-4 text-muted-foreground" />}
              Remind me until it&apos;s done
            </label>
            {!closed && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.in_progress} onCheckedChange={(v) => set("in_progress", v)} />
                In progress
              </label>
            )}
            {task && task.time_spent_seconds > 0 && (
              <span className="text-xs text-muted-foreground">Tracked: {fmtDuration(task.time_spent_seconds)}</span>
            )}
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {task && isOpen(task.status) && (
                <>
                  <Button type="button" variant="success" size="sm" onClick={() => action.mutate({ id: task.id, action: "complete" }, { onSuccess: () => onOpenChange(false) })}>
                    <Check />Complete
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => action.mutate({ id: task.id, action: "cancel" }, { onSuccess: () => onOpenChange(false) })}>
                    <CircleX />Cancel task
                  </Button>
                </>
              )}
              {closed && (
                <Button type="button" variant="outline" size="sm" onClick={() => action.mutate({ id: task!.id, action: "reopen" })}>
                  <RotateCcw />Reopen
                </Button>
              )}
              {task && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    if (confirm("Delete this task permanently?")) del.mutate(task.id, { onSuccess: () => onOpenChange(false) });
                  }}
                >
                  <Trash2 />Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button type="submit" disabled={create.isPending || update.isPending}>{task ? "Save changes" : "Create task"}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
