import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest, type StaffRole } from "@/lib/iam";
import { inviteStaffMemberAtomic } from "@/lib/staff-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roles = new Set<StaffRole>(["owner", "admin", "operator", "viewer"]);

export async function POST(request: NextRequest) {
  const principal = await authorizeAdminRequest(request, "team.manage");
  if (!principal) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
  const role = typeof body.role === "string" ? body.role as StaffRole : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Correo inválido" }, { status: 400 });
  }
  if (!role || !roles.has(role)) {
    return NextResponse.json({ ok: false, error: "Rol inválido" }, { status: 400 });
  }

  try {
    const member = await inviteStaffMemberAtomic({ email, role, displayName, invitedBy: principal });
    await appendAccessAudit({
      principal,
      permission: "team.manage",
      action: "staff.invited",
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: { targetEmail: email, targetRole: role, targetUserId: member?.user_id ?? null },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, member }, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ ok: false, error: cause instanceof Error ? cause.message : "No se pudo invitar" }, { status: 422 });
  }
}
