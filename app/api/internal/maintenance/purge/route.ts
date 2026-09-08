import { NextRequest, NextResponse } from "next/server";
import { runRetentionPurge, validMaintenanceSecret } from "@/lib/maintenance";
import { logEvent, requestIdFromHeaders } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  if (!validMaintenanceSecret(request.headers.get("authorization"))) {
    logEvent("warn", "maintenance.purge.unauthorized", { requestId });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }

  try {
    const purged = await runRetentionPurge();
    logEvent("info", "maintenance.purge.completed", { requestId, purged });
    return NextResponse.json({ ok: true, purged }, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch {
    logEvent("error", "maintenance.purge.failed", { requestId });
    return NextResponse.json({ ok: false, error: "Retention maintenance failed" }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }
}
