"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";

type Mode = "signin" | "signup" | "magic";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") && params.get("next")!.startsWith("/") ? params.get("next")! : "/dashboard";
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const sb = supabase();
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect, data: { full_name: name, timezone } } });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else setSent(true);
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-primary/[0.06] to-transparent px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="size-12 rounded-2xl shadow-lg shadow-primary/20" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Cadence</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tasks, reminders that persist, and goals you actually finish.</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          {!configured && (
            <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see README).
            </p>
          )}
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <Mail className="size-8 text-primary" />
              <p className="font-medium">Check your inbox</p>
              <p className="text-sm text-muted-foreground">We sent a link to <b>{email}</b>. Open it on this device to continue.</p>
              <Button variant="ghost" size="sm" onClick={() => setSent(false)}>Use a different email</Button>
            </div>
          ) : (
            <>
              <Tabs value={mode} onValueChange={(m) => setMode(m as Mode)} className="mb-5">
                <TabsList className="w-full">
                  <TabsTrigger value="signin" className="flex-1">Sign in</TabsTrigger>
                  <TabsTrigger value="signup" className="flex-1">Sign up</TabsTrigger>
                  <TabsTrigger value="magic" className="flex-1">Email link</TabsTrigger>
                </TabsList>
              </Tabs>
              <form className="grid gap-4" onSubmit={submit}>
                {mode === "signup" && (
                  <div className="grid gap-1.5"><Label htmlFor="name">Name</Label><Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
                )}
                <div className="grid gap-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                {mode !== "magic" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                )}
                <Button type="submit" disabled={busy || !configured} className="w-full">
                  {busy && <Loader2 className="animate-spin" />}
                  {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send sign-in link"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
