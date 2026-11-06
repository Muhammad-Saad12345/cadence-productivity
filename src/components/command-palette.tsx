"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Target } from "lucide-react";
import { StatusBadge } from "@/components/badges";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NAV } from "@/components/nav";
import { useGoals, useSearchTasks, useTasks, useTz } from "@/lib/queries";
import { fmtWhen } from "@/lib/tz";

export function CommandPalette({
  open, onOpenChange, onOpenTask, onNewTask,
}: { open: boolean; onOpenChange: (o: boolean) => void; onOpenTask: (id: string) => void; onNewTask: () => void }) {
  const router = useRouter();
  const tz = useTz();
  const [q, setQ] = useState("");
  const { data: tasks } = useTasks();
  const { data: remote } = useSearchTasks(q);
  const { data: goals } = useGoals();

  const taskHits = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = new Map((tasks ?? []).map((t) => [t.id, t]));
    remote?.forEach((t) => all.set(t.id, t));
    const list = [...all.values()];
    if (!term) return list.filter((t) => ["overdue", "pending", "in_progress"].includes(t.status)).slice(0, 6);
    return list
      .filter((t) => `${t.title} ${t.description ?? ""} ${t.notes ?? ""} ${t.tags.join(" ")}`.toLowerCase().includes(term))
      .slice(0, 12);
  }, [q, tasks, remote]);
  const goalHits = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (goals ?? []).filter((g) => !term || g.title.toLowerCase().includes(term)).slice(0, term ? 8 : 4);
  }, [q, goals]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    setQ("");
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-xl translate-y-0 overflow-hidden p-0 sm:p-0" showClose={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search tasks and goals or jump to a page.</DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search tasks, goals, pages…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {taskHits.length > 0 && (
              <CommandGroup heading={q ? "Tasks" : "Needs attention"}>
                {taskHits.map((t) => (
                  <CommandItem key={t.id} value={`task-${t.id}`} onSelect={() => go(() => onOpenTask(t.id))}>
                    <span className="flex-1 truncate">{t.title}</span>
                    {(t.scheduled_at ?? t.due_at) && <span className="text-xs text-muted-foreground">{fmtWhen((t.scheduled_at ?? t.due_at)!, tz)}</span>}
                    <StatusBadge status={t.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {goalHits.length > 0 && (
              <CommandGroup heading="Goals">
                {goalHits.map((g) => (
                  <CommandItem key={g.id} value={`goal-${g.id}`} onSelect={() => go(() => router.push(`/goals?goal=${g.id}`))}>
                    <Target />
                    <span className="flex-1 truncate">{g.title}</span>
                    <span className="text-xs text-muted-foreground tabular">{Math.round(g.progress_pct)}%</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Actions">
              <CommandItem value="new-task" onSelect={() => go(onNewTask)}><Plus />New task</CommandItem>
            </CommandGroup>
            <CommandGroup heading="Go to">
              {NAV.filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase())).map((n) => (
                <CommandItem key={n.href} value={`nav-${n.href}`} onSelect={() => go(() => router.push(n.href))}>
                  <n.icon />{n.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
