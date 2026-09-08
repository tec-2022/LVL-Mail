import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/admin-auth";
import { searchMessages } from "@/lib/message-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max = 256) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized administrator" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const recipient = text(body.recipient, 254);
  if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return NextResponse.json({ ok: false, error: "Invalid recipient" }, { status: 400 });
  }
  const templateVersion = Number(body.templateVersion);

  const messages = await searchMessages({
    query: text(body.query),
    appId: text(body.appId, 64),
    templateKey: text(body.templateKey, 64),
    templateVersion: Number.isInteger(templateVersion) && templateVersion > 0 ? templateVersion : null,
    status: text(body.status, 64),
    providerName: text(body.providerName, 64),
    recipient,
    from: text(body.from, 32),
    to: text(body.to, 32),
    limit: 150,
  });

  return NextResponse.json({ ok: true, messages });
}
