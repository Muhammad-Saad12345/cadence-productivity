"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlarmClock, Award, Bell, CheckCheck, Flag, NotebookPen, Repeat, Settings, Sunrise, Target, Trash2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeleteNotification, useMarkRead, useNotifications, useTz } from "@/lib/queries";
import type { AppNotification } from "@/lib/types";
import { fmtWhen } from "@/lib/tz";
import { cn } from "@/lib/utils";

const ICON: Record<AppNotification["kind"], React.ReactNode> = {
  task_reminder: <AlarmClock />, morning_summary: <Sunrise />, evening_summary: <NotebookPen />, goal_checkin: <Target />,
  weekly_review: <NotebookPen />, monthly_review: <NotebookPen />, goal_deadline: <Flag />, habit_reminder: <Repeat />,
  achievement: <Award />, system: <Bell />,
};
const DELIVERY: Partial<Record<AppNotification["status"], { label: string; cls: string }>> = {
  sent: { label: "Pushed", cls: "text-emerald-600 ring-emerald-500/30" },
  partial: { label: "Pushed (some devices)", cls: "text-emerald-600 ring-emerald-500/30" },
  no_channel: { label: "In-app only", cls: "text-amber-600 ring-amber-500/30" },
  failed: { label: "Delivery failed", cls: "text-rose-600 ring-rose-500/30" },
  queued: { label: "Queued", cls: "" },
  sending: { label: "Sending", cls: "" },
};
const FILTERS: Record<string, (n: AppNotification) => boolean> = {
  all: () => true,
  unread: (n) => !n.read_at,
  reminders: (n) => n.kind === "task_reminder",
  goals: (n) => ["goal_checkin", "goal_deadline", "achievement"].includes(n.kind),
  summaries: (n) => ["morning_summary", "evening_summary", "weekly_review", "monthly_review", "habit_reminder"].includes(n.kind),
};

export default function NotificationsPage() {
  const tz = useTz();
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const { data, isLoading } = useNotifications(200);
  const markRead = useMarkRead();
  const del = useDeleteNotification();
  const list = (data ?? []).filter(FILTERS[filter]);
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  return (
    <div>
      <PageHeader title="Notifications" description={`${unread} unread · history of every reminder and summary`}
        actions={<>
          <Button size="sm" variant="ghost" asChild><Link href="/settings"><Settings />Preferences</Link></Button>
          <Button size="sm" variant="outline" onClick={() => markRead.mutate(undefined)} disabled={!unread}><CheckCheck />Mark all read</Button>
        </>} />
      <Tabs value={filter} onValueChange={setFilter} className="mb-4">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread{unread ? ` (${unread})` : ""}</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="summaries">Summaries</TabsTrigger>
        </TabsList>
      </Tabs>
      {!isLoading && list.length === 0 && <EmptyState icon={<Bell />} title="No notifications" description="Reminders and summaries will show up here." />}
      <div className="flex flex-col divide-y rounded-xl border bg-card">
        {list.map((n) => (
          <div key={n.id} className={cn("group flex items-start gap-3 px-4 py-3", !n.read_at && "bg-primary/[0.03]")}>
            <div className={cn("mt-0.5 rounded-lg p-2 [&_svg]:size-4", n.kind === "achievement" ? "bg-amber-500/10 text-amber-600" : n.kind === "task_reminder" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{ICON[n.kind]}</div>
            <button className="min-w-0 flex-1 text-left" onClick={() => { if (!n.read_at) markRead.mutate([n.id]); router.push(n.url); }}>
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn("text-sm", !n.read_at ? "font-semibold" : "font-medium")}>{n.title}</p>
                {!n.read_at && <span className="size-1.5 rounded-full bg-primary" aria-label="unread" />}
              </div>
              {n.body && <p className="mt-0.5 text-[13px] text-muted-foreground">{n.body}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{fmtWhen(n.scheduled_for, tz)}</span>
                {DELIVERY[n.status] && <Badge variant="outline" className={DELIVERY[n.status]!.cls}>{DELIVERY[n.status]!.label}</Badge>}
                {n.action_taken && <Badge variant="secondary">Action: {n.action_taken}</Badge>}
              </div>
            </button>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => del.mutate(n.id)} aria-label="Delete notification"><Trash2 /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
