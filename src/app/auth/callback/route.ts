import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Email confirmation / magic-link landing.
 *  - `?token_hash=…&type=…` (recommended email template): verified server-side,
 *    so the link works on any device or browser, not only the one that signed up.
 *  - `?code=…` (default PKCE template): exchanged for a session; needs the
 *    code verifier cookie, i.e. the same browser that started sign-up.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const supabase = await supabaseServer();
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  // The link may already have been used (e.g. the address is already confirmed):
  // send the user to sign in rather than a dead end.
  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
