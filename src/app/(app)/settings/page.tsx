"use client";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, Laptop, Smartphone, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { PushStatusCard } from "@/components/push-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePrefs, useProfile, usePushSubscriptions, useUpdatePrefs, useUpdateProfile } from "@/lib/queries";
import { supabase } from "@/lib/supabase/client";
import type { NotificationPreferences, Profile } from "@/lib/types";
import { fmtWhen, listTimezones } from "@/lib/tz";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
const hhmm = (t?: string | null) => (t ?? "").slice(0, 5);

export default function SettingsPage() {
  const { data: prefs } = usePrefs();
  const { data: profile } = useProfile();
  const { data: subs } = usePushSubscriptions();
  const updPrefs = useUpdatePrefs();
  const updProfile = useUpdateProfile();
  const qc = useQueryClient();
  const { setTheme } = useTheme();
  const zones = useMemo(() => listTimezones(), []);
  const [name, setName] = useState("");
  useEffect(() => setName(profile?.display_name ?? ""), [profile?.display_name]);

  const P = <K extends keyof NotificationPreferences>(k: K, val: NotificationPreferences[K]) => updPrefs.mutate({ [k]: val } as Partial<NotificationPreferences>);
  const U = (patch: Partial<Profile>) => updProfile.mutate(patch, { onSuccess: () => toast.success("Saved") });

  const exportData = async () => {
    const sb = supabase();
    const tables = ["tasks", "subtasks", "goals", "goal_milestones", "projects", "categories", "habits", "habit_logs", "focus_sessions", "task_completion_history", "achievements"];
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
    for (const t of tables) out[t] = (await sb.from(t).select("*")).data;
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cadence-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  if (!prefs || !profile) return <PageHeader title="Settings" description="Loading…" />;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description="Notifications, reminders, profile and preferences." />

      <Card>
        <CardHeader><div><CardTitle>This device</CardTitle><CardDescription>Push notifications are enabled per browser/device.</CardDescription></div></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PushStatusCard />
          {!!subs?.length && (
            <div className="flex flex-col divide-y rounded-xl border">
              {subs.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  {/Android|iPhone|iPad|iOS/.test(s.device_label ?? s.user_agent ?? "") ? <Smartphone className="size-4 text-muted-foreground" /> : <Laptop className="size-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.device_label ?? "Browser"}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.last_success_at ? `Last delivered ${fmtWhen(s.last_success_at, profile.timezone)}` : `Added ${fmtWhen(s.created_at, profile.timezone)}`}
                    </p>
                  </div>
                  {s.disabled_at ? <Badge variant="outline" className="text-rose-600">{s.disabled_reason ?? "disabled"}</Badge> : <Badge variant="outline" className="text-emerald-600">active</Badge>}
                  <Button variant="ghost" size="icon-sm" aria-label="Remove device" onClick={async () => { await supabase().from("push_subscriptions").delete().eq("id", s.id); qc.invalidateQueries({ queryKey: ["push_subscriptions"] }); }}><Trash2 /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div><CardTitle>Task reminders</CardTitle><CardDescription>A task reminds you at its time, then repeatedly until you complete or cancel it.</CardDescription></div></CardHeader>
        <CardContent className="divide-y">
          <Row label="Push notifications" hint="Master switch for all devices"><Switch checked={prefs.push_enabled} onCheckedChange={(v) => P("push_enabled", v)} aria-label="Push notifications" /></Row>
          <Row label="In-app notifications" hint="Toasts inside the app when push isn't available"><Switch checked={prefs.in_app_enabled} onCheckedChange={(v) => P("in_app_enabled", v)} aria-label="In-app notifications" /></Row>
          <Row label="Repeat reminder every" hint="Applies to unfinished tasks">
            <Select value={String(prefs.reminder_interval_minutes)} onValueChange={(v) => P("reminder_interval_minutes", Number(v))}>
              <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <SelectItem key={m} value={String(m)}>{m < 60 ? `${m} min` : `${m / 60} hour${m > 60 ? "s" : ""}`}</SelectItem>)}</SelectContent>
            </Select>
          </Row>
          <Row label="Quiet hours" hint="Reminders are held (not dropped) and delivered when quiet hours end">
            <Switch checked={prefs.quiet_hours_enabled} onCheckedChange={(v) => P("quiet_hours_enabled", v)} aria-label="Quiet hours" />
            <Input type="time" className="h-8 w-28" value={hhmm(prefs.quiet_start)} disabled={!prefs.quiet_hours_enabled} onChange={(e) => e.target.value && P("quiet_start", e.target.value)} aria-label="Quiet hours start" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="time" className="h-8 w-28" value={hhmm(prefs.quiet_end)} disabled={!prefs.quiet_hours_enabled} onChange={(e) => e.target.value && P("quiet_end", e.target.value)} aria-label="Quiet hours end" />
          </Row>
          <Row label="Daily notification limit" hint="Extra reminders roll over to the next morning">
            <Select value={prefs.daily_limit ? String(prefs.daily_limit) : "none"} onValueChange={(v) => P("daily_limit", v === "none" ? null : Number(v))}>
              <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">No limit</SelectItem>{[10, 20, 30, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n} per day</SelectItem>)}</SelectContent>
            </Select>
          </Row>
          <Row label="Keep reminders on screen" hint="Notification stays until you act on it (where supported)"><Switch checked={prefs.require_interaction} onCheckedChange={(v) => P("require_interaction", v)} aria-label="Require interaction" /></Row>
          <Row label="Sound" hint="Uses the system notification sound"><Switch checked={prefs.sound_enabled} onCheckedChange={(v) => P("sound_enabled", v)} aria-label="Sound" /></Row>
          <Row label="Vibration" hint="Android"><Switch checked={prefs.vibrate_enabled} onCheckedChange={(v) => P("vibrate_enabled", v)} aria-label="Vibration" /></Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div><CardTitle>Summaries & goal reminders</CardTitle><CardDescription>Times are in {profile.timezone}.</CardDescription></div></CardHeader>
        <CardContent className="divide-y">
          <Row label="Morning priorities" hint="Today's tasks and overdue items">
            <Switch checked={prefs.morning_summary_enabled} onCheckedChange={(v) => P("morning_summary_enabled", v)} aria-label="Morning summary" />
            <Input type="time" className="h-8 w-28" value={hhmm(prefs.morning_summary_time)} onChange={(e) => e.target.value && P("morning_summary_time", e.target.value)} aria-label="Morning summary time" />
          </Row>
          <Row label="Evening summary" hint="What got done and what's still open">
            <Switch checked={prefs.evening_summary_enabled} onCheckedChange={(v) => P("evening_summary_enabled", v)} aria-label="Evening summary" />
            <Input type="time" className="h-8 w-28" value={hhmm(prefs.evening_summary_time)} onChange={(e) => e.target.value && P("evening_summary_time", e.target.value)} aria-label="Evening summary time" />
          </Row>
          <Row label="Goal check-in" hint="Progress nudge for active goals">
            <Select value={prefs.goal_reminder_frequency} onValueChange={(v) => P("goal_reminder_frequency", v as NotificationPreferences["goal_reminder_frequency"])}>
              <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="every_other_day">Every other day</SelectItem><SelectItem value="weekly">Weekly (Monday)</SelectItem><SelectItem value="off">Off</SelectItem></SelectContent>
            </Select>
            <Input type="time" className="h-8 w-28" value={hhmm(prefs.goal_checkin_time)} disabled={prefs.goal_reminder_frequency === "off"} onChange={(e) => e.target.value && P("goal_checkin_time", e.target.value)} aria-label="Goal check-in time" />
          </Row>
          <Row label="Goal deadline warning" hint="Once per goal, before its deadline">
            <Select value={String(prefs.deadline_warning_hours)} onValueChange={(v) => P("deadline_warning_hours", Number(v))}>
              <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{[6, 12, 24, 48, 72].map((h) => <SelectItem key={h} value={String(h)}>{h} hours</SelectItem>)}</SelectContent>
            </Select>
          </Row>
          <Row label="Weekly review" hint="Sunday, at your evening summary time"><Switch checked={prefs.weekly_review_enabled} onCheckedChange={(v) => P("weekly_review_enabled", v)} aria-label="Weekly review" /></Row>
          <Row label="Monthly review" hint="Last day of the month"><Switch checked={prefs.monthly_review_enabled} onCheckedChange={(v) => P("monthly_review_enabled", v)} aria-label="Monthly review" /></Row>
          <Row label="Habit reminders" hint="At each habit's reminder time if not yet logged"><Switch checked={prefs.habit_reminders_enabled} onCheckedChange={(v) => P("habit_reminders_enabled", v)} aria-label="Habit reminders" /></Row>
          <Row label="Celebrations" hint="Confetti and a summary when you achieve a goal"><Switch checked={prefs.celebrations_enabled} onCheckedChange={(v) => P("celebrations_enabled", v)} aria-label="Celebrations" /></Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="divide-y">
          <Row label="Display name">
            <Input className="h-8 w-56" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== profile.display_name && U({ display_name: name || null })} aria-label="Display name" />
          </Row>
          <Row label="Timezone" hint="All dates, reminders and summaries use this timezone">
            <Select value={profile.timezone} onValueChange={(tz) => U({ timezone: tz })}>
              <SelectTrigger size="sm" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </Row>
          <Row label="Theme">
            <Select value={profile.theme} onValueChange={(t) => { setTheme(t); U({ theme: t as Profile["theme"] }); }}>
              <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent>
            </Select>
          </Row>
          <Row label="Week starts on">
            <Select value={String(profile.week_starts_on)} onValueChange={(d) => U({ week_starts_on: Number(d) })}>
              <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="1">Monday</SelectItem><SelectItem value="0">Sunday</SelectItem><SelectItem value="6">Saturday</SelectItem></SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pomodoro</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["pomodoro_focus_min", "Focus (min)", 5, 180], ["pomodoro_short_min", "Short break", 1, 60], ["pomodoro_long_min", "Long break", 1, 90], ["pomodoro_long_every", "Long break every", 2, 12]] as const).map(([k, label, min, max]) => (
            <div key={k} className="grid gap-1.5">
              <Label htmlFor={k}>{label}</Label>
              <Input id={k} type="number" min={min} max={max} defaultValue={profile[k]} key={profile[k]}
                onBlur={(e) => { const n = Math.min(max, Math.max(min, Number(e.target.value) || min)); if (n !== profile[k]) U({ [k]: n } as Partial<Profile>); }} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div><CardTitle>Integrations</CardTitle><CardDescription>Planned for a later phase.</CardDescription></div></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-xl border border-dashed p-3">
            <CalendarDays className="size-5 text-muted-foreground" />
            <div className="flex-1"><p className="text-sm font-medium">Google Calendar sync</p><p className="text-xs text-muted-foreground">Not implemented yet — requires a Google Cloud OAuth client. See README → Roadmap.</p></div>
            <Badge variant="outline">Phase 3</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your data</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportData}><Download />Export all data (JSON)</Button>
        </CardContent>
      </Card>
    </div>
  );
}
