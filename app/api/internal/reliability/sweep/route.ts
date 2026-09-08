import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sweepReliabilityFleet } from "@/lib/reliability-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = process.env.LVL_MAIL_CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Reliability sweep secret is not configured" }, { status: 503 });

  const authorization = request.headers.get("authorization");
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!presented || !safeEqual(presented, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepReliabilityFleet();
  return NextResponse.json({ ok: true, ...result });
}
