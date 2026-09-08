import { NextResponse } from "next/server";
import { getMailProvider } from "@/lib/mail-provider";
import { trackingConfigured } from "@/lib/mail-tracking";
import { supabaseConfigured } from "@/lib/supabase-rest";
import { iamConfigured } from "@/lib/iam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const ready = Boolean(
    getMailProvider()
    && trackingConfigured()
    && supabaseConfigured()
    && iamConfigured()
    && process.env.RESEND_WEBHOOK_SECRET
    && process.env.LVL_MAIL_SENDING_DOMAIN,
  );

  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", service: "lvl-mail" },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        "X-LVL-Mail-Health": ready ? "ready" : "not-ready",
        ...(ready ? {} : { "Retry-After": "30" }),
      },
    },
  );
}
