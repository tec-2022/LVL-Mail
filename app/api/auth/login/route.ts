import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient, supabaseAuthConfigured } from "@/lib/supabase/auth-server";
import { getStaffContext } from "@/lib/iam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!supabaseAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "IAM authentication is not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || password.length < 1) {
    return NextResponse.json({ ok: false, error: "Email y contraseña son obligatorios" }, { status: 400 });
  }

  const supabase = await createAuthServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "IAM authentication is not configured" }, { status: 503 });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user?.id) {
    return NextResponse.json({ ok: false, error: "Credenciales inválidas" }, { status: 401 });
  }

  const member = await getStaffContext(data.user.id);
  if (!member) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: "Tu cuenta no tiene acceso activo a LVL Mail" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      email: member.email,
      displayName: member.display_name,
      role: member.role,
    },
  });
}
