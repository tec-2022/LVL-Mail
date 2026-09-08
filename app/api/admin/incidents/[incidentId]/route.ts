import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/admin-auth";
import { changeIncidentStatus, getIncident } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  if (!authenticateAdminRequest(request)) return error("Unauthorized administrator", 401);
  const { incidentId } = await params;
  const incident = await getIncident(incidentId);
  if (!incident) return error("Incident not found", 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body", 400);
  }

  const status = body.status;
  if (status !== "acknowledged" && status !== "resolved") {
    return error("Unsupported incident status", 400);
  }

  try {
    const updated = await changeIncidentStatus({
      incidentId,
      status,
      actor: process.env.LVL_MAIL_ADMIN_USER || "lvl-mail-admin",
    });
    return NextResponse.json({ ok: true, incident: updated });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not update incident", 422);
  }
}
