import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest } from "@/lib/iam";
import { createWebhookChannel, setAlertChannelEnabled } from "@/lib/alerting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const principal = await authorizeAdminRequest(request, "apps.manage");
  if (!principal) return error("Forbidden", 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body");
  }

  const name = typeof body.name === "string" ? body.name : "";
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  try {
    const result = await createWebhookChannel({ name, endpoint });
    await appendAccessAudit({
      principal,
      permission: "apps.manage",
      action: "alert.channel.created",
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: { channelId: result.channel.id, channelType: result.channel.channel_type, name: result.channel.name },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not create channel", 422);
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

  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const enabled = body.enabled;
  if (!channelId || typeof enabled !== "boolean") return error("Invalid channel update");
  try {
    const channel = await setAlertChannelEnabled(channelId, enabled);
    if (!channel) return error("Channel not found", 404);
    await appendAccessAudit({
      principal,
      permission: "apps.manage",
      action: enabled ? "alert.channel.enabled" : "alert.channel.disabled",
      requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
      details: { channelId },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, channel });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not update channel", 422);
  }
}
