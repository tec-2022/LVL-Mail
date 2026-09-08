import { NextRequest, NextResponse } from "next/server";
import { appendAccessAudit, authorizeAdminRequest, scopeAppIds } from "@/lib/iam";
import { searchMessages } from "@/lib/message-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max = 256) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  const principal = await authorizeAdminRequest(request, "messages.search");
  if (!principal) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
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
  const appId = text(body.appId, 64);
  if (appId && !principal.allApps && !principal.appIds.includes(appId)) {
    return NextResponse.json({ ok: false, error: "Application scope denied" }, { status: 403 });
  }

  const messages = await searchMessages({
    query: text(body.query),
    appId,
    allowedAppIds: scopeAppIds(principal),
    templateKey: text(body.templateKey, 64),
    templateVersion: Number.isInteger(templateVersion) && templateVersion > 0 ? templateVersion : null,
    status: text(body.status, 64),
    providerName: text(body.providerName, 64),
    recipient,
    from: text(body.from, 32),
    to: text(body.to, 32),
    limit: 150,
  });

  await appendAccessAudit({
    principal,
    permission: "messages.search",
    action: "messages.searched",
    appId: appId || null,
    requestId: request.headers.get("x-vercel-id") || request.headers.get("x-request-id"),
    details: {
      queryUsed: Boolean(text(body.query)),
      recipientFilterUsed: Boolean(recipient),
      templateKey: text(body.templateKey, 64) || null,
      status: text(body.status, 64) || null,
      providerName: text(body.providerName, 64) || null,
      scope: principal.allApps ? "all" : principal.appIds,
      resultCount: messages.length,
    },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, messages });
}
