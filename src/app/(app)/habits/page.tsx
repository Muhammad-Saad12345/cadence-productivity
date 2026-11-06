"use client";
import { useEffect, useMemo, useState } from "react";
import { Archive, Check, Flame, Minus, Pencil, Plus, Repeat } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SWATCHES, WEEKDAYS } from "@/lib/constants";
import { useHabitLogs, useHabitMutations, useHabits, useProfile, useTz } from "@/lib/queries";
import type { Habit } from "@/lib/types";
import { addDaysKey, fmtKey, isoDowOfKey, startOfWeekKey, todayKey } from "@/lib/tz";
import { cn } from "@/lib/utils";

function HabitDialog({ open, onOpenChange, habit }: { open: boolean; onOpenChange: (o: boolean) => void; habit?: Habit }) {
  const { upsert } = useHabitMutations();
  const [f, setF] = useState({ name: "", description: "", color: SWATCHES[2], days: [1, 2, 3, 4, 5, 6, 7], target_per_day: 1, reminder_time: "" });
  useEffect(() => {
    if (open) setF({
      name: habit?.name ?? "", description: habit?.description ?? "", color: habit?.color ?? SWATCHES[2],
      days: habit?.days ?? [1, 2, 3, 4, 5, 6, 7], target_per_day: habit?.target_per_day ?? 1, reminder_time: habit?.reminder_time?.slice(0, 5) ?? "",
    });
  }, [open, habit]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{habit ? "Edit habit" : "New habit"}</DialogTitle><DialogDescription>Small, repeatable, and easy to start.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!f.name.trim() || !f.days.length) return toast.error("Name and at least one day are required");
          await upsert.mutateAsync({ id: habit?.id, name: f.name.trim(), description: f.description || null, color: f.color, days: [...f.days].sort(), target_per_day: f.target_per_day, reminder_time: f.reminder_time || null });
          toast.success(habit ? "Habit saved" : "Habit created");
          onOpenChange(false);
        }}>
          <div className="grid gap-1.5"><Label htmlFor="h-name">Habit</Label><Input id="h-name" autoFocus placeholder="Read 20 pages" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="grid gap-1.5">
            <Label>Days</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = f.days.includes(d.iso);
                return <button type="button" key={d.iso} aria-pressed={on} onClick={() => setF({ ...f, days: on ? f.days.filter((x) => x !== d.iso) : [...f.days, d.iso] })}
                  className={cn("h-8 rounded-md border px-3 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>{d.short}</button>;
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="h-target">Times per day</Label><Input id="h-target" type="number" min={1} max={50} value={f.target_per_day} onChange={(e) => setF({ ...f, target_per_day: Math.max(1, Number(e.target.value) || 1) })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="h-time">Reminder (optional)</Label><Input id="h-time" type="time" value={f.reminder_time} onChange={(e) => setF({ ...f, reminder_time: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">{SWATCHES.map((c) => <button type="button" key={c} onClick={() => setF({ ...f, color: c })} aria-label={c} className={cn("size-7 rounded-full ring-offset-2 ring-offset-background", f.color === c && "ring-2 ring-foreground/60")} style={{ background: c }} />)}</div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit">Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function habitStreak(h: Habit, counts: Map<string, number>, today: string) {
  let streak = 0;
  let k = today;
  if ((counts.get(`${h.id}:${k}`) ?? 0) < h.target_per_day) k = addDaysKey(k, -1); // today still open
  for (let i = 0; i < 400; i++) {
    if (h.days.includes(isoDowOfKey(k))) {
      if ((counts.get(`${h.id}:${k}`) ?? 0) >= h.target_per_day) streak++;
      else break;
    }
    if (k <= h.created_at.slice(0, 10)) break;
    k = addDaysKey(k, -1);
  }
  return streak;
}

export default function HabitsPage() {
  const tz = useTz();
  const { data: profile } = useProfile();
  const today = todayKey(tz);
  const from = addDaysKey(today, -90);
  const { data: habits, isLoading } = useHabits();
  const { data: logs } = useHabitLogs(from, today);
  const { log, archive } = useHabitMutations();
  const [dlg, setDlg] = useState<{ open: boolean; habit?: Habit }>({ open: false });
  const weekStart = startOfWeekKey(today, profile?.week_starts_on ?? 1);
  const week = Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i));
  const counts = useMemo(() => new Map((logs ?? []).map((l) => [`${l.habit_id}:${l.log_date}`, l.count])), [logs]);

  return (
    <div>
      <PageHeader title="Habits" description="Track recurring habits and build streaks." actions={<Button size="sm" onClick={() => setDlg({ open: true })}><Plus />New habit</Button>} />
      {!isLoading && !habits?.length && <EmptyState icon={<Repeat />} title="No habits yet" description="Start with one habit you can do in under five minutes." action={<Button size="sm" onClick={() => setDlg({ open: true })}><Plus />Create habit</Button>} />}
      <div className="flex flex-col gap-3">
        {habits?.map((h) => {
          const streak = habitStreak(h, counts, today);
          const scheduled30 = Array.from({ length: 30 }, (_, i) => addDaysKey(today, -i)).filter((k) => h.days.includes(isoDowOfKey(k)) && k >= h.created_at.slice(0, 10));
          const done30 = scheduled30.filter((k) => (counts.get(`${h.id}:${k}`) ?? 0) >= h.target_per_day).length;
          const todayCount = counts.get(`${h.id}:${today}`) ?? 0;
          const dueToday = h.days.includes(isoDowOfKey(today));
          return (
            <Card key={h.id} className="group flex flex-col gap-4 p-4 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="size-9 shrink-0 rounded-xl" style={{ background: `${h.color}22`, boxShadow: `inset 0 0 0 1.5px ${h.color}` }} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{h.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.days.length === 7 ? "Every day" : h.days.map((d) => WEEKDAYS[d - 1].short).join(" ")}
                    {h.target_per_day > 1 && ` · ${h.target_per_day}× / day`}
                    {h.reminder_time && ` · reminder ${h.reminder_time.slice(0, 5)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {week.map((k) => {
                  const c = counts.get(`${h.id}:${k}`) ?? 0;
                  const due = h.days.includes(isoDowOfKey(k));
                  const done = c >= h.target_per_day;
                  const future = k > today;
                  return (
                    <button key={k} disabled={future || !due}
                      onClick={() => log.mutate({ habitId: h.id, date: k, delta: done ? -c : 1 })}
                      title={`${fmtKey(k)}: ${c}/${h.target_per_day}`}
                      className={cn("flex size-8 flex-col items-center justify-center rounded-lg border text-[10px] transition disabled:opacity-35", k === today && "ring-2 ring-primary/40", done ? "border-transparent text-white" : "hover:bg-accent")}
                      style={done ? { background: h.color } : undefined}
                      aria-label={`${h.name} ${fmtKey(k)} ${done ? "done" : "not done"}`}>
                      {done ? <Check className="size-3.5" /> : <span className="text-muted-foreground">{fmtKey(k, { weekday: "narrow" })}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-4 md:justify-end">
                <div className="text-center"><p className="flex items-center gap-1 text-sm font-semibold tabular"><Flame className="size-3.5 text-orange-500" />{streak}</p><p className="text-[10px] text-muted-foreground">streak</p></div>
                <div className="text-center"><p className="text-sm font-semibold tabular">{scheduled30.length ? Math.round((done30 / scheduled30.length) * 100) : 0}%</p><p className="text-[10px] text-muted-foreground">30 days</p></div>
                {dueToday && h.target_per_day > 1 && (
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="outline" disabled={todayCount === 0} onClick={() => log.mutate({ habitId: h.id, date: today, delta: -1 })} aria-label="Decrease"><Minus /></Button>
                    <span className="w-9 text-center text-xs tabular">{todayCount}/{h.target_per_day}</span>
                    <Button size="icon-sm" variant="outline" onClick={() => log.mutate({ habitId: h.id, date: today, delta: 1 })} aria-label="Increase"><Plus /></Button>
                  </div>
                )}
                <div className="flex opacity-60 group-hover:opacity-100">
                  <Button size="icon-sm" variant="ghost" onClick={() => setDlg({ open: true, habit: h })} aria-label="Edit"><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => confirm(`Archive “${h.name}”?`) && archive.mutate(h.id)} aria-label="Archive"><Archive /></Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <HabitDialog open={dlg.open} habit={dlg.habit} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </div>
  );
}
