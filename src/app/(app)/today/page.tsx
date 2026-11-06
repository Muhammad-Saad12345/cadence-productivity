"use client";
import { useState } from "react";
import { ChevronDown, Inbox, Plus, Sun } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/task-item";
import { useUI } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskViews } from "@/lib/task-views";
import { fmtDate, parseKey, zonedParts, zonedToUtc } from "@/lib/tz";
import { cn } from "@/lib/utils";

function Section({ title, count, tone, children, collapsible = false, defaultOpen = true }: {
  title: string; count: number; tone?: string; children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col gap-1">
      <button
        type="button"
        disabled={!collapsible}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1 text-left text-xs font-semibold tracking-wide uppercase disabled:cursor-default"
        aria-expanded={open}
      >
        {collapsible && <ChevronDown className={cn("size-3.5 transition", !open && "-rotate-90")} />}
        <span className={tone ?? "text-muted-foreground"}>{title}</span>
        <span className="font-normal text-muted-foreground tabular">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

export default function TodayPage() {
  const v = useTaskViews();
  const { openQuickAdd } = useUI();
  const total = v.todays.length + v.completedToday.length;
  const pct = total ? (v.completedToday.length / total) * 100 : 0;

  const addForToday = () => {
    const p = zonedParts(new Date(), v.tz);
    const { y, m, d } = parseKey(v.today);
    const h = Math.min(23, p.hour + 1);
    openQuickAdd({ scheduled_at: zonedToUtc(y, m, d, h, 0, v.tz).toISOString() });
  };

  return (
    <div>
      <PageHeader
        title="Today"
        description={fmtDate(new Date(), v.tz, { weekday: "long", day: "numeric", month: "long" })}
        actions={<Button size="sm" onClick={addForToday}><Plus />Add task</Button>}
      />
      {total > 0 && (
        <div className="mb-6 flex items-center gap-3">
          <Progress value={pct} className="h-2 flex-1" indicatorClassName="bg-emerald-500" />
          <span className="text-xs text-muted-foreground tabular">{v.completedToday.length}/{total} done</span>
        </div>
      )}
      {v.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {v.overdue.length > 0 && (
            <Section title="Overdue" count={v.overdue.length} tone="text-rose-600">
              <TaskList tasks={v.overdue} />
            </Section>
          )}
          <Section title="Scheduled today" count={v.todays.length}>
            <TaskList
              tasks={v.todays}
              timeOnly
              empty={<EmptyState icon={<Sun />} title="Your day is clear" description="Add the tasks you intend to finish today." action={<Button size="sm" variant="outline" onClick={addForToday}><Plus />Add task</Button>} />}
            />
          </Section>
          {v.noDate.length > 0 && (
            <Section title="Anytime (no date)" count={v.noDate.length} collapsible defaultOpen={v.todays.length === 0}>
              <TaskList tasks={v.noDate} empty={<EmptyState icon={<Inbox />} title="Inbox empty" />} />
            </Section>
          )}
          {v.completedToday.length > 0 && (
            <Section title="Completed today" count={v.completedToday.length} tone="text-emerald-600" collapsible defaultOpen={false}>
              <TaskList tasks={v.completedToday} timeOnly />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
