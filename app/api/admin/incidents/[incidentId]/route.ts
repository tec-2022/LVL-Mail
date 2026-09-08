import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest } from "@/lib/iam";
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
  const { incidentId } = await params;
  const incident = await getIncident(incidentId);
  if (!incident) return error("Incident not found", 404);

  const principal = await authorizeAdminRequest(request, "incidents.manage", incident.app_id);
  if (!principal) return error("Forbidden", 403);

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
      actor: principal.email,
    });
    await appendAccessAudit({
      principal,
      permission: "incidents.manage",
      action: `incident.${status}`,
      appId: incident.app_id,
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: { incidentId, incidentType: incident.incident_type, severity: incident.severity },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, incident: updated });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not update incident", 422);
  }
}
