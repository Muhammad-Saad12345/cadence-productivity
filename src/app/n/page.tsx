"use client";
// Notification action screen. Opened from a reminder when the platform can't show all
// buttons (Firefox, Safari, iOS, Chrome's 2-button limit) or when the body is tapped.
// Authorised by the signed token in the URL fragment — works without being signed in.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlarmClock, Check, CircleDashed, CircleX, Loader2, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtWhen } from "@/lib/tz";

interface Snapshot {
  notification: { id: string; kind: string; title: string; body: string; action_taken: string | null };
  task: { id: string; title: string; description: string | null; status: string; priority: string; scheduled_at: string | null; due_at: string | null; next_reminder_at: string | null; timezone: string; recurring: boolean } | null;
}
const ENDPOINT = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/notification-action`;

export default function NotificationActionPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    try {
      const res = await fetch(`${ENDPOINT}?token=${encodeURIComponent(t)}`);
      if (res.status === 401) return setError("This reminder link is invalid or has expired.");
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setError("Couldn't load the task. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get("t");
    if (!t) return setError("Missing reminder token.");
    setToken(t);
    load(t);
  }, [load]);

  const act = async (action: string, minutes?: number) => {
    if (!token) return;
    setBusy(action);
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, action, minutes }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(
          action === "complete" ? "Task completed. Reminders stopped."
          : action === "cancel" ? "Task cancelled. Reminders stopped; it stays in your history."
          : action === "pending" ? `Kept pending. Next reminder ${body.task?.next_reminder_at ? fmtWhen(body.task.next_reminder_at, data?.task?.timezone ?? "Asia/Karachi") : "soon"}.`
          : `Snoozed until ${fmtWhen(body.task.next_reminder_at, data?.task?.timezone ?? "Asia/Karachi")}.`,
        );
        setData((d) => (d && d.task ? { ...d, task: { ...d.task, ...body.task } } : d));
      } else if (res.status === 409) {
        setDone(`This task is already ${body.task?.status ?? "closed"}.`);
      } else setError(body.error ?? "Something went wrong.");
    } catch {
      setError("You're offline. Try again when you're connected.");
    } finally {
      setBusy(null);
    }
  };

  const task = data?.task;
  const closed = task && ["completed", "cancelled"].includes(task.status);
  const actionButton = (a: string, icon: React.ReactNode, label: string, variant: "success" | "outline" = "outline") => (
    <Button key={a} size="lg" variant={variant} className="h-12 w-full justify-start" disabled={!!busy || !!closed} onClick={() => act(a)}>
      {busy === a ? <Loader2 className="animate-spin" /> : icon}{label}
    </Button>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-primary/[0.06] to-transparent p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="size-6 rounded-md" />Cadence reminder
        </div>
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        {!error && !data && <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
        {task && (
          <>
            <h1 className="text-lg leading-snug font-semibold">{task.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{data!.notification.body}</p>
            {task.description && <p className="mt-3 text-sm whitespace-pre-wrap">{task.description}</p>}
            {done && <p className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">{done}</p>}
            <div className="mt-5 grid gap-2">
              {actionButton("complete", <Check />, "Complete", "success")}
              {actionButton("pending", <CircleDashed />, "Pending — keep reminding me")}
              {actionButton("cancel", <CircleX />, task.recurring ? "Cancel this occurrence" : "Cancel task")}
              <div className="grid grid-cols-3 gap-2">
                <Button variant="ghost" size="sm" disabled={!!busy || !!closed} onClick={() => act("snooze", 60)}><AlarmClock />1 hour</Button>
                <Button variant="ghost" size="sm" disabled={!!busy || !!closed} onClick={() => act("snooze", 180)}><AlarmClock />3 hours</Button>
                <Button variant="ghost" size="sm" disabled={!!busy || !!closed} onClick={() => act("snooze_tomorrow")}><Sunrise />Tomorrow</Button>
              </div>
            </div>
            {task.due_at && <p className="mt-4 text-xs text-muted-foreground">Deadline: {fmtWhen(task.due_at, task.timezone)}</p>}
          </>
        )}
        <Link href="/tasks" className="mt-6 block text-center text-sm text-primary hover:underline">Open Cadence</Link>
      </div>
    </div>
  );
}
