import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest, type StaffRole } from "@/lib/iam";
import { inviteStaffMemberAtomic } from "@/lib/staff-invite";
import { listRegisteredApps } from "@/lib/app-registry";

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
  const requestedAllApps = typeof body.allApps === "boolean" ? body.allApps : true;
  const requestedAppIds = Array.isArray(body.appIds)
    ? body.appIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Correo inválido" }, { status: 400 });
  }
  if (!role || !roles.has(role)) {
    return NextResponse.json({ ok: false, error: "Rol inválido" }, { status: 400 });
  }

  const allApps = role === "owner" || role === "admin" ? true : requestedAllApps;
  const appIds = allApps ? [] : [...new Set(requestedAppIds)];
  if (!allApps && appIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Selecciona al menos una aplicación" }, { status: 400 });
  }
  if (!allApps) {
    const validIds = new Set((await listRegisteredApps()).map((app) => app.id));
    if (appIds.some((appId) => !validIds.has(appId))) {
      return NextResponse.json({ ok: false, error: "El scope contiene una aplicación inválida" }, { status: 400 });
    }
  }

  try {
    const member = await inviteStaffMemberAtomic({ email, role, displayName, allApps, appIds, invitedBy: principal });
    await appendAccessAudit({
      principal,
      permission: "team.manage",
      action: "staff.invited",
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: {
        targetEmail: email,
        targetRole: role,
        targetUserId: member?.user_id ?? null,
        allApps,
        appIds,
      },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, member }, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ ok: false, error: cause instanceof Error ? cause.message : "No se pudo invitar" }, { status: 422 });
  }
}
