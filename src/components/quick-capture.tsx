"use client";
import { useMemo, useState } from "react";
import { CalendarClock, CornerDownLeft, Flag, FolderKanban, Hash, Repeat, SlidersHorizontal, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { priorityMeta } from "@/lib/constants";
import { parseQuickAdd } from "@/lib/quick-add";
import { type TaskInput, useCategories, useCreateTask, useProjects, useTz } from "@/lib/queries";
import { fmtWhen } from "@/lib/tz";
import { cn } from "@/lib/utils";

export function QuickCapture({
  open, onOpenChange, defaults, onMore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaults?: TaskInput;
  onMore: (input: TaskInput) => void;
}) {
  const tz = useTz();
  const [text, setText] = useState("");
  const create = useCreateTask();
  const { data: projects } = useProjects();
  const { data: categories } = useCategories();

  const parsed = useMemo(() => parseQuickAdd(text, tz), [text, tz]);
  const resolved = useMemo(() => {
    const project = parsed.projectName
      ? projects?.find((p) => p.name.toLowerCase().startsWith(parsed.projectName!.toLowerCase()))
      : undefined;
    const category = categories?.find((c) => parsed.tags.includes(c.name.toLowerCase()));
    const input: TaskInput & { title: string } = {
      ...defaults,
      title: parsed.title,
      scheduled_at: parsed.scheduledAt ?? defaults?.scheduled_at ?? null,
      due_at: parsed.dueAt ?? defaults?.due_at ?? null,
      priority: parsed.priority ?? defaults?.priority ?? "medium",
      tags: parsed.tags.filter((t) => t !== category?.name.toLowerCase()),
      project_id: project?.id ?? defaults?.project_id ?? null,
      category_id: category?.id ?? defaults?.category_id ?? null,
      estimated_minutes: parsed.estimateMinutes,
      recurrence: parsed.recurrence,
    };
    return { input, project, category };
  }, [parsed, projects, categories, defaults]);

  const submit = async () => {
    if (!resolved.input.title) return;
    await create.mutateAsync(resolved.input);
    toast.success("Task added", {
      description: resolved.input.scheduled_at ? `Reminder ${fmtWhen(resolved.input.scheduled_at, tz)}` : resolved.input.title,
    });
    setText("");
    onOpenChange(false);
  };

  const chip = "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium";

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setText(""); }}>
      <DialogContent className="top-[22%] max-w-xl translate-y-0 gap-3 p-0 sm:p-0" showClose={false}>
        <DialogTitle className="sr-only">Quick add task</DialogTitle>
        <DialogDescription className="sr-only">Type a task in natural language and press Enter.</DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Submit report tomorrow 5pm !high #study @Uni ~45m"
            className="h-14 w-full rounded-t-2xl bg-transparent px-5 text-[15px] outline-none placeholder:text-muted-foreground/60"
            aria-label="Task"
          />
          <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-t px-4 py-2.5">
            {resolved.input.scheduled_at && (
              <span className={cn(chip, "text-primary")}><CalendarClock className="size-3" />{fmtWhen(resolved.input.scheduled_at, tz)}</span>
            )}
            {resolved.input.due_at && (
              <span className={cn(chip, "text-rose-600 dark:text-rose-400")}><CalendarClock className="size-3" />Due {fmtWhen(resolved.input.due_at, tz)}</span>
            )}
            {parsed.priority && <span className={cn(chip, priorityMeta(parsed.priority).text)}><Flag className="size-3" />{priorityMeta(parsed.priority).label}</span>}
            {resolved.project && <span className={chip}><FolderKanban className="size-3" />{resolved.project.name}</span>}
            {parsed.projectName && !resolved.project && <span className={cn(chip, "text-muted-foreground line-through")} title="No project with that name">@{parsed.projectName}</span>}
            {resolved.category && <span className={chip}><span className="size-1.5 rounded-full" style={{ background: resolved.category.color }} />{resolved.category.name}</span>}
            {resolved.input.tags?.map((t) => <span key={t} className={cn(chip, "text-primary")}><Hash className="size-3" />{t}</span>)}
            {parsed.estimateMinutes && <span className={chip}><Timer className="size-3" />{parsed.estimateMinutes}m</span>}
            {parsed.recurrence && <span className={chip}><Repeat className="size-3" />{parsed.chips.find((c) => c.kind === "repeat")?.label}</span>}
            {!text && <span className="text-xs text-muted-foreground">Dates, times, <b>!priority</b>, <b>#tag</b>, <b>@project</b>, <b>~30m</b>, <b>every weekday</b>, <b>by fri</b> are understood.</span>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => { onMore(resolved.input); setText(""); }}>
              <SlidersHorizontal />More options
            </Button>
            <Button type="submit" size="sm" disabled={!resolved.input.title || create.isPending}>
              Add task <CornerDownLeft className="opacity-60" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
