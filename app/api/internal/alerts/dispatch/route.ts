import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingAlerts, validDispatchSecret } from "@/lib/alerting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validDispatchSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await dispatchPendingAlerts(50);
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Alert dispatch failed" }, { status: 503 });
  }
}
