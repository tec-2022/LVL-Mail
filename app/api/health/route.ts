import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "lvl-mail",
    sendingDomain: process.env.LVL_MAIL_SENDING_DOMAIN ?? "mail.lvltechmx.com",
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
  });
}
