"use client";
import { useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAchievements, useGoals, usePrefs, useStreaks, useUpsertGoal } from "@/lib/queries";
import type { Goal } from "@/lib/types";

const MESSAGES = [
  "You set a target and you hit it. That consistency compounds.",
  "Commitment kept. This is how bigger goals get built.",
  "Well executed. Take a moment to note what made this work.",
  "Done, and on the record. Carry the momentum into your next goal.",
];

export function burst() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#0ea5e9"];
  confetti({ particleCount: 70, spread: 70, startVelocity: 38, origin: { y: 0.65 }, colors, scalar: 0.9, disableForReducedMotion: true });
  setTimeout(() => confetti({ particleCount: 40, spread: 100, origin: { y: 0.6 }, colors, scalar: 0.8, disableForReducedMotion: true }), 220);
}

/** Celebrates each newly completed goal exactly once (tracked by goals.celebrated_at). */
export function Celebration() {
  const { data: goals } = useGoals();
  const { data: prefs } = usePrefs();
  const { data: streaks } = useStreaks();
  const { data: achievements } = useAchievements();
  const upsert = useUpsertGoal();
  const [goal, setGoal] = useState<Goal | null>(null);

  const pending = useMemo(
    () => (goals ?? []).find((g) => g.status === "completed" && !g.celebrated_at && g.completed_at),
    [goals],
  );

  useEffect(() => {
    if (!pending || goal) return;
    // Don't celebrate old completions (e.g. goals finished before this device ever loaded them).
    if (Date.now() - new Date(pending.completed_at!).getTime() > 7 * 86400_000) {
      upsert.mutate({ id: pending.id, celebrated_at: new Date().toISOString() });
      return;
    }
    if (prefs && !prefs.celebrations_enabled) {
      upsert.mutate({ id: pending.id, celebrated_at: new Date().toISOString() });
      return;
    }
    setGoal(pending);
    burst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id, prefs?.celebrations_enabled]);

  const close = () => {
    if (goal) upsert.mutate({ id: goal.id, celebrated_at: new Date().toISOString() });
    setGoal(null);
  };

  const completedCount = (goals ?? []).filter((g) => g.status === "completed").length;
  const badges = (achievements ?? []).filter((a) => a.kind === "badge").length;
  const msg = goal ? MESSAGES[goal.title.length % MESSAGES.length] : "";

  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-lg shadow-amber-500/30">
          <Trophy className="size-7" />
        </div>
        <DialogTitle className="text-lg">{goal?.period === "monthly" ? "Monthly" : "Weekly"} goal achieved</DialogTitle>
        <DialogDescription className="-mt-2 text-[15px] font-medium text-foreground">{goal?.title}</DialogDescription>
        <p className="text-sm text-muted-foreground">{msg}</p>
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-center">
          <div><p className="text-lg font-semibold tabular">{completedCount}</p><p className="text-[11px] text-muted-foreground">Goals done</p></div>
          <div><p className="text-lg font-semibold tabular">{streaks?.current_streak ?? 0}</p><p className="text-[11px] text-muted-foreground">Day streak</p></div>
          <div><p className="text-lg font-semibold tabular">{badges}</p><p className="text-[11px] text-muted-foreground">Badges</p></div>
        </div>
        <Button onClick={close} className="w-full">Continue</Button>
      </DialogContent>
    </Dialog>
  );
}
