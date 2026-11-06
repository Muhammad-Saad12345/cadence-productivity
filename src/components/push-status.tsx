"use client";
import { useCallback, useEffect, useState } from "react";
import { BellOff, BellRing, Info, Loader2, Send, Share, ShieldAlert, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disablePush, enablePush, getPushState, isIOS, type PushState, sendTestNotification } from "@/lib/push";
import { errorMessage, cn } from "@/lib/utils";

export function usePushState() {
  const [state, setState] = useState<PushState>("loading");
  const refresh = useCallback(() => getPushState().then(setState).catch(() => setState("unsupported")), []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return { state, setState, refresh };
}

/** Explains the device's notification status and offers the right next step. */
export function PushStatusCard({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { state, setState, refresh } = usePushState();
  const [busy, setBusy] = useState(false);

  if (state === "loading") return null;
  if (compact && state === "subscribed") return null;

  const enable = async () => {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "subscribed") toast.success("Notifications enabled on this device");
      if (s === "denied") toast.error("Notifications were blocked");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const content: Record<Exclude<PushState, "loading">, { icon: React.ReactNode; title: string; body: React.ReactNode; tone: string }> = {
    subscribed: {
      icon: <BellRing className="size-4" />, tone: "emerald",
      title: "Push notifications are on for this device",
      body: "Reminders arrive even when Cadence is closed, as long as your browser is allowed to run in the background.",
    },
    default: {
      icon: <BellRing className="size-4" />, tone: "primary",
      title: "Turn on reminders for this device",
      body: "Cadence reminds you at the task time and every hour until you complete or cancel it — even with the tab closed.",
    },
    granted: {
      icon: <BellRing className="size-4" />, tone: "primary",
      title: "Finish setting up notifications",
      body: "Permission is granted, but this device isn't registered for reminders yet.",
    },
    denied: {
      icon: <BellOff className="size-4" />, tone: "amber",
      title: "Notifications are blocked for this site",
      body: (
        <>
          Click the lock/tune icon in the address bar → <b>Notifications</b> → <b>Allow</b>, then reload. Until then you&apos;ll see reminders inside the app only.
        </>
      ),
    },
    "ios-install": {
      icon: <Smartphone className="size-4" />, tone: "amber",
      title: "Install Cadence to get reminders on iPhone/iPad",
      body: (
        <>
          In Safari tap <Share className="inline size-3.5" /> <b>Share</b> → <b>Add to Home Screen</b>, open Cadence from the Home Screen and enable notifications there (iOS 16.4+).
        </>
      ),
    },
    unsupported: {
      icon: <Info className="size-4" />, tone: "amber",
      title: "This browser doesn't support web push",
      body: "You'll still see reminders in the app while it's open. Use a recent Chrome, Edge, Firefox or Safari for background reminders.",
    },
    insecure: {
      icon: <ShieldAlert className="size-4" />, tone: "amber",
      title: "Push needs HTTPS",
      body: "Open Cadence over https:// (or http://localhost during development) to enable notifications.",
    },
  };
  const c = content[state as Exclude<PushState, "loading">];
  const tone =
    c.tone === "emerald" ? "border-emerald-500/30 bg-emerald-500/5 [&_.ic]:text-emerald-600"
    : c.tone === "amber" ? "border-amber-500/30 bg-amber-500/5 [&_.ic]:text-amber-600"
    : "border-primary/30 bg-primary/5 [&_.ic]:text-primary";

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center", tone, className)} data-testid="push-status" data-state={state}>
      <div className="ic mt-0.5 self-start">{c.icon}</div>
      <div className="flex-1">
        <p className="text-sm font-medium">{c.title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{c.body}</p>
        {state === "subscribed" && !compact && isIOS() && (
          <p className="mt-1 text-xs text-muted-foreground">iOS delivers web push only to the installed Home Screen app.</p>
        )}
      </div>
      <div className="flex gap-2">
        {(state === "default" || state === "granted") && (
          <Button size="sm" onClick={enable} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <BellRing />}Enable</Button>
        )}
        {state === "denied" && <Button size="sm" variant="outline" onClick={refresh}>I&apos;ve allowed it</Button>}
        {state === "subscribed" && !compact && (
          <>
            <Button size="sm" variant="outline" onClick={() => sendTestNotification().then(() => toast.success("Test sent — it should arrive within a minute")).catch((e) => toast.error(errorMessage(e)))}>
              <Send />Send test
            </Button>
            <Button size="sm" variant="ghost" onClick={async () => { await disablePush(); refresh(); toast("Notifications turned off for this device"); }}>
              Turn off
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
