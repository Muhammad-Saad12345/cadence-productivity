"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Coffee, Maximize2, Minimize2, Pause, Play, RotateCcw, SkipForward, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFocusSessions, useLogFocusSession, useProfile, useTaskAction, useTz } from "@/lib/queries";
import { useTaskViews } from "@/lib/task-views";
import type { FocusSession } from "@/lib/types";
import { addDaysKey, dateKey, fmtDuration, fmtTime, startOfDayUtc, todayKey } from "@/lib/tz";
import { cn } from "@/lib/utils";

type Phase = "focus" | "short_break" | "long_break";
type Mode = "pomodoro" | "stopwatch";
interface TimerState {
  mode: Mode;
  phase: Phase;
  running: boolean;
  endsAt: number | null;      // pomodoro: absolute end time while running
  remaining: number;          // pomodoro: seconds left while paused
  startedAt: number | null;   // when the current phase/stopwatch first started
  elapsedBefore: number;      // stopwatch: accumulated seconds before last resume
  resumedAt: number | null;   // stopwatch
  cycle: number;              // completed focus sessions in this round
  taskId: string | null;
}
const KEY = "cadence.focus.timer.v1";
const NONE = "__none";
const PHASE_LABEL: Record<Phase, string> = { focus: "Focus", short_break: "Short break", long_break: "Long break" };

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i === 2 ? 880 : 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
  } catch {
    /* audio unavailable */
  }
}

function FocusInner() {
  const params = useSearchParams();
  const tz = useTz();
  const { data: profile } = useProfile();
  const v = useTaskViews();
  const logSession = useLogFocusSession();
  const action = useTaskAction();
  const since = useMemo(() => startOfDayUtc(addDaysKey(todayKey(tz), -6), tz).toISOString(), [tz]);
  const { data: sessions } = useFocusSessions(since);

  const durations = useMemo(() => ({
    focus: (profile?.pomodoro_focus_min ?? 25) * 60,
    short_break: (profile?.pomodoro_short_min ?? 5) * 60,
    long_break: (profile?.pomodoro_long_min ?? 15) * 60,
  }), [profile]);
  const longEvery = profile?.pomodoro_long_every ?? 4;

  const [s, setS] = useState<TimerState>(() => ({
    mode: "pomodoro", phase: "focus", running: false, endsAt: null, remaining: 25 * 60, startedAt: null,
    elapsedBefore: 0, resumedAt: null, cycle: 0, taskId: null,
  }));
  const [now, setNow] = useState(() => Date.now());
  const [zen, setZen] = useState(false);
  const loaded = useRef(false);

  // Restore a running timer after refresh; honour ?task=.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as TimerState | null;
      if (saved) setS(saved);
    } catch { /* ignore */ }
    const t = params.get("task");
    if (t) setS((x) => ({ ...x, taskId: t }));
  }, [params]);
  useEffect(() => {
    if (loaded.current) localStorage.setItem(KEY, JSON.stringify(s));
  }, [s]);
  useEffect(() => {
    if (!s.running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [s.running]);
  // Initialise duration once the profile loads (when idle).
  useEffect(() => {
    if (!s.running && !s.startedAt && s.mode === "pomodoro") setS((x) => ({ ...x, remaining: durations[x.phase] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durations]);

  const record = useCallback((kind: FocusSession["kind"], startedAt: number, seconds: number, planned: number | null, completed: boolean) => {
    if (seconds < 30) return;
    logSession.mutate({
      task_id: kind === "focus" || kind === "task_timer" ? s.taskId : null, kind,
      started_at: new Date(startedAt).toISOString(), ended_at: new Date().toISOString(),
      planned_seconds: planned, actual_seconds: Math.round(seconds), completed,
    });
  }, [logSession, s.taskId]);

  const nextPhase = useCallback((completedPhase: Phase, cycle: number): { phase: Phase; cycle: number } => {
    if (completedPhase !== "focus") return { phase: "focus", cycle };
    const c = cycle + 1;
    return { phase: c % longEvery === 0 ? "long_break" : "short_break", cycle: c };
  }, [longEvery]);

  // Phase completion
  const left = s.mode === "pomodoro" ? (s.running && s.endsAt ? Math.max(0, Math.ceil((s.endsAt - now) / 1000)) : s.remaining) : 0;
  useEffect(() => {
    if (s.mode !== "pomodoro" || !s.running || !s.endsAt || now < s.endsAt) return;
    const planned = durations[s.phase];
    record(s.phase, s.startedAt ?? s.endsAt - planned * 1000, planned, planned, true);
    beep();
    const n = nextPhase(s.phase, s.cycle);
    const msg = s.phase === "focus" ? `Focus session done — time for a ${n.phase === "long_break" ? "long" : "short"} break.` : "Break over — ready to focus?";
    toast.success(msg);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.ready.then((r) => r.showNotification("Cadence focus timer", { body: msg, tag: "pomodoro", icon: "/icons/icon-192.png", data: { kind: "info", url: "/focus" } }));
    }
    setS((x) => ({ ...x, phase: n.phase, cycle: n.cycle, running: false, endsAt: null, startedAt: null, remaining: durations[n.phase] }));
  }, [now, s, durations, record, nextPhase]);

  const elapsed = s.mode === "stopwatch" ? s.elapsedBefore + (s.running && s.resumedAt ? (now - s.resumedAt) / 1000 : 0) : 0;

  const start = () => {
    const t = Date.now();
    setNow(t);
    if (s.mode === "pomodoro") setS((x) => ({ ...x, running: true, endsAt: t + x.remaining * 1000, startedAt: x.startedAt ?? t }));
    else setS((x) => ({ ...x, running: true, resumedAt: t, startedAt: x.startedAt ?? t }));
  };
  const pause = () => {
    const t = Date.now();
    if (s.mode === "pomodoro") setS((x) => ({ ...x, running: false, endsAt: null, remaining: x.endsAt ? Math.max(0, Math.ceil((x.endsAt - t) / 1000)) : x.remaining }));
    else setS((x) => ({ ...x, running: false, elapsedBefore: x.elapsedBefore + (x.resumedAt ? (t - x.resumedAt) / 1000 : 0), resumedAt: null }));
  };
  const reset = () => setS((x) => ({ ...x, running: false, endsAt: null, startedAt: null, remaining: durations[x.phase], elapsedBefore: 0, resumedAt: null }));
  const skip = () => {
    if (s.phase === "focus" && s.startedAt) record("focus", s.startedAt, durations.focus - left, durations.focus, false);
    const n = nextPhase(s.phase, s.cycle);
    setS((x) => ({ ...x, phase: n.phase, cycle: n.cycle, running: false, endsAt: null, startedAt: null, remaining: durations[n.phase] }));
  };
  const stopStopwatch = () => {
    if (s.startedAt) record("task_timer", s.startedAt, elapsed, null, true);
    setS((x) => ({ ...x, running: false, startedAt: null, elapsedBefore: 0, resumedAt: null }));
    if (elapsed >= 30) toast.success(`Logged ${fmtDuration(Math.round(elapsed))}`);
  };
  const setMode = (mode: Mode) => {
    if (s.running) return toast.error("Stop the current timer first");
    setS((x) => ({ ...x, mode, startedAt: null, elapsedBefore: 0, resumedAt: null, remaining: durations[x.phase] }));
  };

  const task = v.open.find((t) => t.id === s.taskId) ?? v.all.find((t) => t.id === s.taskId);
  const secs = s.mode === "pomodoro" ? left : Math.floor(elapsed);
  const display = `${String(Math.floor(secs / 3600) ? Math.floor(secs / 3600) + ":" : "")}${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const total = s.mode === "pomodoro" ? durations[s.phase] : 0;
  const pct = s.mode === "pomodoro" && total ? ((total - left) / total) * 100 : 0;

  useEffect(() => {
    document.title = s.running ? `${display} · ${s.mode === "pomodoro" ? PHASE_LABEL[s.phase] : "Tracking"}` : "Focus · Cadence";
  }, [display, s.running, s.mode, s.phase]);

  const today = todayKey(tz);
  const todays = (sessions ?? []).filter((x) => dateKey(x.started_at, tz) === today);
  const focusToday = todays.filter((x) => x.kind === "focus" || x.kind === "task_timer").reduce((a, x) => a + x.actual_seconds, 0);
  const focusWeek = (sessions ?? []).filter((x) => x.kind === "focus" || x.kind === "task_timer").reduce((a, x) => a + x.actual_seconds, 0);

  const timer = (
    <div className="flex flex-col items-center gap-6">
      {s.mode === "pomodoro" && (
        <Tabs value={s.phase} onValueChange={(p) => !s.running && setS((x) => ({ ...x, phase: p as Phase, startedAt: null, remaining: durations[p as Phase] }))}>
          <TabsList>
            {(Object.keys(PHASE_LABEL) as Phase[]).map((p) => <TabsTrigger key={p} value={p} disabled={s.running}>{PHASE_LABEL[p]}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
      <div className="relative flex size-64 items-center justify-center sm:size-72">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" strokeWidth="3" className="stroke-muted" />
          {s.mode === "pomodoro" && (
            <circle cx="50" cy="50" r="46" fill="none" strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={100 - pct}
              className={cn("transition-[stroke-dashoffset] duration-300", s.phase === "focus" ? "stroke-primary" : "stroke-emerald-500")} />
          )}
        </svg>
        <div className="text-center">
          <p className="text-5xl font-semibold tracking-tight tabular sm:text-6xl" role="timer" aria-live="off">{display}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {s.mode === "pomodoro" ? `${PHASE_LABEL[s.phase]} · session ${(s.cycle % longEvery) + (s.phase === "focus" ? 1 : 0) || longEvery}/${longEvery}` : "Tracking time"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {s.running ? <Button size="lg" variant="secondary" onClick={pause}><Pause />Pause</Button> : <Button size="lg" onClick={start}><Play />{s.startedAt ? "Resume" : "Start"}</Button>}
        {s.mode === "pomodoro" ? (
          <>
            <Button size="icon" variant="outline" onClick={reset} aria-label="Reset"><RotateCcw /></Button>
            <Button size="icon" variant="outline" onClick={skip} aria-label="Skip phase"><SkipForward /></Button>
          </>
        ) : (
          <Button size="lg" variant="outline" onClick={stopStopwatch} disabled={!s.startedAt}><Square />Stop & log</Button>
        )}
      </div>
    </div>
  );

  if (zen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background p-6">
        <Button variant="ghost" size="sm" className="absolute top-4 right-4" onClick={() => setZen(false)}><Minimize2 />Exit focus mode</Button>
        {task ? (
          <div className="max-w-xl text-center">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">Current task</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{task.title}</h2>
            {task.description && <p className="mt-3 text-sm whitespace-pre-wrap text-muted-foreground">{task.description}</p>}
          </div>
        ) : <p className="text-muted-foreground">No task selected — just focus.</p>}
        {timer}
        {task && !["completed", "cancelled"].includes(task.status) && (
          <Button variant="success" onClick={() => action.mutate({ id: task.id, action: "complete" }, { onSuccess: () => { toast.success("Task completed"); if (s.mode === "stopwatch") stopStopwatch(); } })}>
            <Check />Mark task complete
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Focus" description="Pomodoro sessions and time tracking, linked to your tasks."
        actions={<Button size="sm" variant="outline" onClick={() => setZen(true)}><Maximize2 />Focus mode</Button>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col items-center gap-6 pt-6">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <Tabs value={s.mode} onValueChange={(m) => setMode(m as Mode)}>
                <TabsList>
                  <TabsTrigger value="pomodoro"><Timer />Pomodoro</TabsTrigger>
                  <TabsTrigger value="stopwatch"><Coffee />Track time</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={s.taskId ?? NONE} onValueChange={(id) => setS((x) => ({ ...x, taskId: id === NONE ? null : id }))}>
                <SelectTrigger className="w-full sm:w-72" size="sm" aria-label="Task"><SelectValue placeholder="Choose a task" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No specific task</SelectItem>
                  {v.open.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {timer}
            {task && <p className="text-sm text-muted-foreground">Working on <span className="font-medium text-foreground">{task.title}</span>{task.time_spent_seconds ? ` · ${fmtDuration(task.time_spent_seconds)} tracked` : ""}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Session history</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-muted/60 p-3"><p className="text-lg font-semibold tabular">{fmtDuration(focusToday)}</p><p className="text-[11px] text-muted-foreground">today</p></div>
              <div className="rounded-lg bg-muted/60 p-3"><p className="text-lg font-semibold tabular">{fmtDuration(focusWeek)}</p><p className="text-[11px] text-muted-foreground">last 7 days</p></div>
            </div>
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {(sessions ?? []).slice(0, 30).map((x) => {
                const t = v.all.find((tt) => tt.id === x.task_id);
                return (
                  <div key={x.id} className="flex items-center gap-2 text-sm">
                    <span className={cn("size-2 rounded-full", x.kind === "focus" ? "bg-primary" : x.kind === "task_timer" ? "bg-violet-500" : "bg-emerald-500")} />
                    <span className="flex-1 truncate">{t?.title ?? PHASE_LABEL[x.kind as Phase] ?? "Tracked time"}</span>
                    <span className="text-xs text-muted-foreground tabular">{fmtTime(x.started_at, tz)} · {fmtDuration(x.actual_seconds)}</span>
                  </div>
                );
              })}
              {!sessions?.length && <p className="text-sm text-muted-foreground">Completed sessions appear here.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function FocusPage() {
  return <Suspense fallback={null}><FocusInner /></Suspense>;
}
