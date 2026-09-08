import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "lvl-mail",
      revision: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || null,
      time: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-LVL-Mail-Health": "live",
      },
    },
  );
}
