"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ListFilter, ListTodo, Plus, Search, X } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/task-item";
import { useUI } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { useCategories, useGoals, useProjects, useSearchTasks } from "@/lib/queries";
import { anchorOf, sortTasks, useTaskViews } from "@/lib/task-views";
import { addDaysKey, dateKey, startOfWeekKey } from "@/lib/tz";
import type { Task } from "@/lib/types";

const ALL = "all";

function TasksInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { openTask, openQuickAdd } = useUI();
  const v = useTaskViews();
  const { data: categories } = useCategories();
  const { data: projects } = useProjects();
  const { data: goals } = useGoals();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "open");
  const [priority, setPriority] = useState(ALL);
  const [category, setCategory] = useState(params.get("category") ?? ALL);
  const [project, setProject] = useState(params.get("project") ?? ALL);
  const [goal, setGoal] = useState(params.get("goal") ?? ALL);
  const [range, setRange] = useState(ALL);
  const { data: remote } = useSearchTasks(q);

  // Deep link: /tasks?task=<id> opens the editor (used by notification clicks).
  useEffect(() => {
    const id = params.get("task");
    if (id) {
      openTask(id);
      router.replace("/tasks");
    }
  }, [params, openTask, router]);

  const filtered = useMemo(() => {
    const pool = new Map<string, Task>(v.all.map((t) => [t.id, t]));
    remote?.forEach((t) => pool.set(t.id, t));
    const term = q.trim().toLowerCase();
    const weekStart = startOfWeekKey(v.today);
    return [...pool.values()].filter((t) => {
      if (status === "open" && !["upcoming", "pending", "in_progress", "overdue"].includes(t.status)) return false;
      if (status !== "open" && status !== ALL && t.status !== status) return false;
      if (priority !== ALL && t.priority !== priority) return false;
      if (category !== ALL && t.category_id !== category) return false;
      if (project !== ALL && t.project_id !== project) return false;
      if (goal !== ALL && t.goal_id !== goal) return false;
      const a = anchorOf(t);
      const k = a ? dateKey(a, v.tz) : null;
      if (range === "today" && k !== v.today) return false;
      if (range === "week" && (!k || k < weekStart || k > addDaysKey(weekStart, 6))) return false;
      if (range === "nodate" && k) return false;
      if (range === "past" && (!k || k >= v.today)) return false;
      if (term && !`${t.title} ${t.description ?? ""} ${t.notes ?? ""} ${t.tags.join(" ")}`.toLowerCase().includes(term)) return false;
      return true;
    }).sort(sortTasks);
  }, [v, remote, q, status, priority, category, project, goal, range]);

  const active = [status !== "open", priority !== ALL, category !== ALL, project !== ALL, goal !== ALL, range !== ALL].filter(Boolean).length;
  const reset = () => { setStatus("open"); setPriority(ALL); setCategory(ALL); setProject(ALL); setGoal(ALL); setRange(ALL); setQ(""); };

  return (
    <div>
      <PageHeader title="All tasks" description="Search and filter everything." actions={<Button size="sm" onClick={() => openQuickAdd()}><Plus />Add task</Button>} />
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, description, notes, tags…" className="pl-9" aria-label="Search tasks" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ListFilter className="size-4 text-muted-foreground" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger size="sm" className="w-36" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value={ALL}>Any status</SelectItem>
              {TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger size="sm" className="w-32" aria-label="Date"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any date</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This week</SelectItem>
              <SelectItem value="past">Past</SelectItem>
              <SelectItem value="nodate">No date</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger size="sm" className="w-32" aria-label="Priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any priority</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger size="sm" className="w-36" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any category</SelectItem>
              {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger size="sm" className="w-36" aria-label="Project"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any project</SelectItem>
              {projects?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={goal} onValueChange={setGoal}>
            <SelectTrigger size="sm" className="w-36" aria-label="Goal"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any goal</SelectItem>
              {goals?.map((g) => <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>)}
            </SelectContent>
          </Select>
          {active > 0 && <Button variant="ghost" size="sm" onClick={reset}><X />Clear</Button>}
          <span className="ml-auto text-xs text-muted-foreground tabular">{filtered.length} tasks</span>
        </div>
      </div>
      <TaskList tasks={filtered} empty={<EmptyState icon={<ListTodo />} title="No tasks match" description="Try a different filter or search term." />} />
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksInner />
    </Suspense>
  );
}
