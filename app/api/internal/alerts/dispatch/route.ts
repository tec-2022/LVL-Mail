import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingAlerts, validDispatchSecret } from "@/lib/alerting";
import { logEvent, requestIdFromHeaders } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  if (!validDispatchSecret(request.headers.get("authorization"))) {
    logEvent("warn", "alerts.dispatch.unauthorized", { requestId });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }
  try {
    const result = await dispatchPendingAlerts(50);
    logEvent(result.failed > 0 ? "warn" : "info", "alerts.dispatch.completed", { requestId, ...result });
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch {
    logEvent("error", "alerts.dispatch.failed", { requestId });
    return NextResponse.json({ ok: false, error: "Alert dispatch failed" }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }
}
