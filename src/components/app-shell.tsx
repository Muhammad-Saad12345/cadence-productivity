"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Bell, LogOut, Menu, Monitor, Moon, Plus, Search, Sun, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Celebration } from "@/components/celebration";
import { CommandPalette } from "@/components/command-palette";
import { NAV } from "@/components/nav";
import { QuickCapture } from "@/components/quick-capture";
import { TaskEditor } from "@/components/task-editor";
import { UIContext } from "@/components/ui-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { getPushState, registerServiceWorker, syncPushSubscription } from "@/lib/push";
import { type TaskInput, useNotifications, usePrefs, useProfile, useSession, useTaskAction, useUnreadCount } from "@/lib/queries";
import { supabase } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";

function Logo({ className }: { className?: string }) {
  return (
    <Link href="/dashboard" className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" className="size-7 rounded-lg" />
      Cadence
    </Link>
  );
}

function NavLinks({ onNavigate, unread }: { onNavigate?: () => void; unread: number }) {
  const pathname = usePathname();
  const groups = [
    { key: "main", label: null },
    { key: "plan", label: "Plan" },
    { key: "insight", label: "Insight" },
  ];
  return (
    <nav className="flex flex-col gap-4" aria-label="Main">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-0.5">
          {g.label && <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">{g.label}</p>}
          {NAV.filter((n) => n.group === g.key).map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-primary/10 font-medium text-primary" : "text-foreground/75 hover:bg-accent hover:text-foreground",
                )}
              >
                <n.icon className="size-4" />
                <span className="flex-1">{n.label}</span>
                {n.href === "/notifications" && unread > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular">{unread > 99 ? "99+" : unread}</span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const opts = [
    { v: "light", icon: Sun, label: "Light" },
    { v: "dark", icon: Moon, label: "Dark" },
    { v: "system", icon: Monitor, label: "System" },
  ];
  return (
    <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={theme === o.v}
          aria-label={o.label}
          onClick={() => setTheme(o.v)}
          className={cn("flex flex-1 items-center justify-center rounded-md py-1 text-muted-foreground transition", theme === o.v && "bg-background text-foreground shadow-sm")}
        >
          <o.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

/** Live updates (Supabase Realtime) with polling as a fallback. */
function RealtimeBridge({ userId }: { userId: string }) {
  const qc = useQueryClient();
  useEffect(() => {
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const bump = (key: string) => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        qc.invalidateQueries({ queryKey: [key] });
        if (key === "tasks") qc.invalidateQueries({ queryKey: ["goals"] });
      }, 250);
    };
    const ch = supabase()
      .channel(`user-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` }, () => bump("tasks"))
      .on("postgres_changes", { event: "*", schema: "public", table: "goals", filter: `user_id=eq.${userId}` }, () => bump("goals"))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => bump("notifications"))
      .subscribe();
    return () => {
      Object.values(timers).forEach(clearTimeout);
      supabase().removeChannel(ch);
    };
  }, [qc, userId]);
  return null;
}

/**
 * In-app fallback: when this device has no active push subscription (permission denied,
 * unsupported browser, iOS not installed…), new reminders surface as toasts while the app is open.
 */
function InAppNotifier() {
  const { data: prefs } = usePrefs();
  const { data: notes } = useNotifications(30);
  const action = useTaskAction();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const [pushActive, setPushActive] = useState(true);

  useEffect(() => {
    const check = () => getPushState().then((s) => setPushActive(s === "subscribed"));
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  useEffect(() => {
    if (!notes) return;
    if (!seen.current) {
      seen.current = new Set(notes.map((n) => n.id));
      return;
    }
    const fresh = notes.filter((n) => !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    if (pushActive || prefs?.in_app_enabled === false) return;
    fresh.filter((n) => !n.read_at && !n.action_taken).slice(0, 3).forEach((n) => show(n));

    function show(n: AppNotification) {
      if (n.kind === "task_reminder" && n.task_id) {
        const id = n.task_id;
        toast(n.title, {
          description: n.body,
          duration: Infinity,
          icon: <Bell className="size-4 text-primary" />,
          action: { label: "Complete", onClick: () => action.mutate({ id, action: "complete" }, { onSuccess: () => toast.success("Completed") }) },
          cancel: { label: "Snooze 1h", onClick: () => action.mutate({ id, action: "snooze", minutes: 60 }) },
        });
      } else {
        toast(n.title, { description: n.body, action: { label: "Open", onClick: () => router.push(n.url) } });
      }
      // Tab hidden but notifications allowed (e.g. push unsupported): local OS notification.
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        navigator.serviceWorker?.ready.then((reg) =>
          reg.showNotification(n.title, { body: n.body, tag: n.task_id ? `task-${n.task_id}` : n.id, icon: "/icons/icon-192.png", data: { kind: "info", url: n.url } }),
        );
      }
    }
  }, [notes, pushActive, prefs?.in_app_enabled, action, router]);
  return null;
}

function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const up = () => setOffline(!navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", up);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
      <WifiOff className="size-3.5" />
      You&apos;re offline. Changes can&apos;t be saved until you reconnect; server reminders keep running.
    </div>
  );
}

function NewTaskFromQuery({ onNew }: { onNew: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (params.get("new") === "1") {
      onNew();
      router.replace(pathname);
    }
  }, [params, onNew, router, pathname]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: user } = useSession();
  const { data: profile } = useProfile();
  const { data: unread = 0 } = useUnreadCount();
  const { setTheme } = useTheme();
  const [quick, setQuick] = useState<{ open: boolean; defaults?: TaskInput }>({ open: false });
  const [editor, setEditor] = useState<{ open: boolean; id: string | null; defaults?: TaskInput }>({ open: false, id: null });
  const [search, setSearch] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  const ui = useMemo(
    () => ({
      openQuickAdd: (defaults?: TaskInput) => setQuick({ open: true, defaults }),
      openTask: (id: string | null, defaults?: TaskInput) => setEditor({ open: true, id, defaults }),
      openSearch: () => setSearch(true),
    }),
    [],
  );
  const openNew = useCallback(() => ui.openQuickAdd(), [ui]);

  // Apply the theme stored in the profile once it loads.
  const appliedTheme = useRef(false);
  useEffect(() => {
    if (profile && !appliedTheme.current) {
      appliedTheme.current = true;
      setTheme(profile.theme);
    }
  }, [profile, setTheme]);

  // Service worker, push subscription sync, offline action queue, SW → page messages.
  useEffect(() => {
    registerServiceWorker().then(() => {
      syncPushSubscription();
      navigator.serviceWorker?.controller?.postMessage({ type: "flush-queue" });
    });
    const onMsg = (e: MessageEvent) => {
      const m = e.data ?? {};
      if (m.type === "navigate" && typeof m.url === "string") router.push(m.url);
      if (m.type === "task-updated" || m.type === "push") {
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["goals"] });
      }
      if (m.type === "subscription-changed") syncPushSubscription();
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    const online = () => navigator.serviceWorker?.controller?.postMessage({ type: "flush-queue" });
    window.addEventListener("online", online);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMsg);
      window.removeEventListener("online", online);
    };
  }, [router, qc]);

  // Keyboard shortcuts: N = quick add, / or ⌘K = search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === "n" || e.key === "q") {
          e.preventDefault();
          setQuick({ open: true });
        } else if (e.key === "/") {
          e.preventDefault();
          setSearch(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signOut = async () => {
    await supabase().auth.signOut();
    qc.clear();
    router.replace("/login");
  };

  return (
    <UIContext.Provider value={ui}>
      <div className="flex min-h-dvh">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r bg-sidebar px-3 py-4 lg:flex">
          <Logo className="px-2" />
          <div className="flex gap-2">
            <Button className="flex-1" size="sm" onClick={() => ui.openQuickAdd()}>
              <Plus />Add task
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => setSearch(true)} aria-label="Search (Ctrl+K)">
              <Search />
            </Button>
          </div>
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            <NavLinks unread={unread} />
          </div>
          <div className="flex flex-col gap-3 border-t pt-3">
            <ThemeSwitch />
            <div className="flex items-center gap-2 px-1">
              <div className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {(profile?.display_name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{profile?.display_name ?? "—"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={signOut} aria-label="Sign out"><LogOut /></Button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur lg:hidden">
            <Logo />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => setSearch(true)} aria-label="Search"><Search /></Button>
              <Button variant="ghost" size="icon" asChild aria-label="Notifications">
                <Link href="/notifications" className="relative">
                  <Bell />
                  {unread > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-primary" />}
                </Link>
              </Button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">{children}</main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-safe backdrop-blur lg:hidden" aria-label="Primary">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
          {[NAV[0], NAV[1]].map((n) => <MobileTab key={n.href} href={n.href} label={n.label} Icon={n.icon} />)}
          <button onClick={() => ui.openQuickAdd()} className="mx-auto -mt-5 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95" aria-label="Add task">
            <Plus className="size-6" />
          </button>
          <MobileTab href="/goals" label="Goals" Icon={NAV[5].icon} />
          <button onClick={() => setMobileNav(true)} className="flex flex-col items-center gap-0.5 py-1 text-[11px] text-muted-foreground">
            <Menu className="size-5" />More
          </button>
        </div>
      </nav>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="px-3 py-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Logo className="px-2" />
          <NavLinks unread={unread} onNavigate={() => setMobileNav(false)} />
          <div className="mt-auto flex flex-col gap-3 border-t pt-3">
            <ThemeSwitch />
            <Button variant="outline" size="sm" onClick={signOut}><LogOut />Sign out</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mounted on demand: keeps time-dependent parsing out of the static shell. */}
      {quick.open && <QuickCapture
        open={quick.open}
        defaults={quick.defaults}
        onOpenChange={(open) => setQuick((q) => ({ ...q, open }))}
        onMore={(input) => {
          setQuick({ open: false });
          setEditor({ open: true, id: null, defaults: input });
        }}
      />}
      {editor.open && <TaskEditor open={editor.open} taskId={editor.id} defaults={editor.defaults} onOpenChange={(open) => setEditor((s) => ({ ...s, open }))} />}
      {search && <CommandPalette open={search} onOpenChange={setSearch} onOpenTask={(id) => ui.openTask(id)} onNewTask={() => ui.openQuickAdd()} />}

      {user && <RealtimeBridge userId={user.id} />}
      {user && <InAppNotifier />}
      {user && <Celebration />}
      <Suspense fallback={null}><NewTaskFromQuery onNew={openNew} /></Suspense>
    </UIContext.Provider>
  );
}

function MobileTab({ href, label, Icon }: { href: string; label: string; Icon: React.ComponentType<{ className?: string }> }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link href={href} className={cn("flex flex-col items-center gap-0.5 py-1 text-[11px]", active ? "font-medium text-primary" : "text-muted-foreground")}>
      <Icon className="size-5" />
      {label}
    </Link>
  );
}
