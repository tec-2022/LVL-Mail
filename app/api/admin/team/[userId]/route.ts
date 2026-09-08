import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest, listStaffMembers, updateStaffMember, type StaffRole } from "@/lib/iam";
import { listRegisteredApps } from "@/lib/app-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roles = new Set<StaffRole>(["owner", "admin", "operator", "viewer"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const principal = await authorizeAdminRequest(request, "team.manage");
  if (!principal) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const { userId } = await params;
  const members = await listStaffMembers();
  const target = members.find((member) => member.user_id === userId);
  if (!target) return NextResponse.json({ ok: false, error: "Miembro no encontrado" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const role = typeof body.role === "string" ? body.role as StaffRole : target.role;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : target.is_enabled;
  if (!roles.has(role)) return NextResponse.json({ ok: false, error: "Rol inválido" }, { status: 400 });

  const requestedAllApps = typeof body.allApps === "boolean" ? body.allApps : target.all_apps;
  const requestedAppIds = Array.isArray(body.appIds)
    ? body.appIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : target.app_ids;
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
    const member = await updateStaffMember({ targetUserId: userId, role, enabled, allApps, appIds });
    await appendAccessAudit({
      principal,
      permission: "team.manage",
      action: "staff.updated",
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: {
        targetUserId: userId,
        targetEmail: target.email,
        previousRole: target.role,
        nextRole: role,
        previousEnabled: target.is_enabled,
        nextEnabled: enabled,
        previousAllApps: target.all_apps,
        nextAllApps: allApps,
        previousAppIds: target.app_ids,
        nextAppIds: appIds,
      },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, member });
  } catch (cause) {
    return NextResponse.json({ ok: false, error: cause instanceof Error ? cause.message : "No se pudo actualizar" }, { status: 422 });
  }
}
