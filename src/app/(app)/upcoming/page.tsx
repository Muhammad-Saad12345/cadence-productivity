"use client";
import { useMemo } from "react";
import { CalendarClock, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/task-item";
import { useUI } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { anchorOf, useTaskViews } from "@/lib/task-views";
import { addDaysKey, dateKey, fmtKey, parseKey, zonedToUtc } from "@/lib/tz";

export default function UpcomingPage() {
  const v = useTaskViews();
  const { openQuickAdd } = useUI();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysKey(v.today, i + 1)), [v.today]);
  const byDay = useMemo(() => {
    const m = new Map<string, typeof v.upcoming>();
    for (const t of v.upcoming) {
      const k = dateKey(anchorOf(t)!, v.tz);
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [v]);
  const later = v.upcoming.filter((t) => dateKey(anchorOf(t)!, v.tz) > days[days.length - 1]);
  const addOn = (k: string) => {
    const { y, m, d } = parseKey(k);
    openQuickAdd({ scheduled_at: zonedToUtc(y, m, d, 9, 0, v.tz).toISOString() });
  };

  return (
    <div>
      <PageHeader title="Upcoming" description="The next two weeks, day by day." actions={<Button size="sm" onClick={() => openQuickAdd()}><Plus />Add task</Button>} />
      {v.upcoming.length === 0 && !v.isLoading && (
        <EmptyState icon={<CalendarClock />} title="Nothing scheduled ahead" description="Tasks with a future date appear here." />
      )}
      <div className="flex flex-col gap-5">
        {days.map((k, i) => {
          const list = byDay.get(k) ?? [];
          if (!list.length && i > 6) return null;
          return (
            <section key={k} className="border-b pb-3 last:border-0">
              <div className="flex items-center justify-between px-3">
                <h2 className="text-sm font-semibold">
                  {i === 0 ? "Tomorrow" : fmtKey(k, { weekday: "long" })}
                  <span className="ml-2 font-normal text-muted-foreground">{fmtKey(k, { day: "numeric", month: "short" })}</span>
                </h2>
                <Button variant="ghost" size="icon-sm" onClick={() => addOn(k)} aria-label={`Add task on ${k}`}><Plus /></Button>
              </div>
              <TaskList tasks={list} timeOnly empty={<p className="px-3 pt-1 text-xs text-muted-foreground">No tasks</p>} />
            </section>
          );
        })}
        {later.length > 0 && (
          <section>
            <h2 className="px-3 text-sm font-semibold">Later</h2>
            <TaskList tasks={later} />
          </section>
        )}
      </div>
    </div>
  );
}
