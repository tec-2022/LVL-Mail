import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest } from "@/lib/iam";
import { createAlertRule, setAlertRuleEnabled } from "@/lib/alerting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body");
  }

  const appId = typeof body.appId === "string" && body.appId.trim() ? body.appId.trim() : null;
  const principal = await authorizeAdminRequest(request, "apps.manage", appId);
  if (!principal) return error("Forbidden", 403);

  const minSeverity = body.minSeverity === "critical" ? "critical" : "warning";
  try {
    const rule = await createAlertRule({
      name: typeof body.name === "string" ? body.name : "",
      channelId: typeof body.channelId === "string" ? body.channelId : "",
      appId,
      incidentType: typeof body.incidentType === "string" ? body.incidentType : null,
      minSeverity,
      notifyOpen: body.notifyOpen !== false,
      notifyEscalation: body.notifyEscalation !== false,
      notifyRecovery: body.notifyRecovery !== false,
      cooldownSeconds: Number(body.cooldownSeconds ?? 300),
    });
    await appendAccessAudit({
      principal,
      permission: "apps.manage",
      action: "alert.rule.created",
      appId,
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: { ruleId: rule.id, channelId: rule.channel_id, minSeverity: rule.min_severity },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, rule });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not create rule", 422);
  }
}

export async function PATCH(request: NextRequest) {
  const principal = await authorizeAdminRequest(request, "apps.manage");
  if (!principal) return error("Forbidden", 403);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body");
  }
  const ruleId = typeof body.ruleId === "string" ? body.ruleId : "";
  const enabled = body.enabled;
  if (!ruleId || typeof enabled !== "boolean") return error("Invalid rule update");
  try {
    const rule = await setAlertRuleEnabled(ruleId, enabled);
    if (!rule) return error("Rule not found", 404);
    await appendAccessAudit({
      principal,
      permission: "apps.manage",
      action: enabled ? "alert.rule.enabled" : "alert.rule.disabled",
      appId: rule.app_id,
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: { ruleId },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, rule });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not update rule", 422);
  }
}
