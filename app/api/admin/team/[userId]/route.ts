import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest, listStaffMembers, updateStaffMember, type StaffRole } from "@/lib/iam";

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

  try {
    const member = await updateStaffMember({ targetUserId: userId, role, enabled });
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
      },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, member });
  } catch (cause) {
    return NextResponse.json({ ok: false, error: cause instanceof Error ? cause.message : "No se pudo actualizar" }, { status: 422 });
  }
}
