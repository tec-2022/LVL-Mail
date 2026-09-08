import { NextResponse } from "next/server";
import { createAuthServerClient } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createAuthServerClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
