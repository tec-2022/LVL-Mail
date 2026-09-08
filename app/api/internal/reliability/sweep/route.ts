import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sweepReliabilityFleet } from "@/lib/reliability-sweep";
import { logEvent, requestIdFromHeaders } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const secret = process.env.LVL_MAIL_CRON_SECRET;
  if (!secret) {
    logEvent("error", "reliability.sweep.unconfigured", { requestId });
    return NextResponse.json({ ok: false, error: "Reliability sweep secret is not configured" }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }

  const authorization = request.headers.get("authorization");
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!presented || !safeEqual(presented, secret)) {
    logEvent("warn", "reliability.sweep.unauthorized", { requestId });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }

  try {
    const result = await sweepReliabilityFleet();
    logEvent("info", "reliability.sweep.completed", { requestId, ...result });
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch {
    logEvent("error", "reliability.sweep.failed", { requestId });
    return NextResponse.json({ ok: false, error: "Reliability sweep failed" }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  }
}
