import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  recordWebhookEvent,
  supabaseConfigured,
  upsertSuppression,
} from "@/lib/supabase-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    email?: string;
    recipient?: string;
    to?: string[];
    tags?: Record<string, string>;
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

function recipientFrom(event: WebhookEvent) {
  const direct = event.data?.email ?? event.data?.recipient;
  if (typeof direct === "string") return direct;
  const to = event.data?.to;
  return Array.isArray(to) && typeof to[0] === "string" ? to[0] : null;
}

function safeEventDetails(event: WebhookEvent) {
  return {
    tags: event.data?.tags ?? null,
    bounce: event.data?.bounce
      ? {
          type: event.data.bounce.type ?? null,
          subType: event.data.bounce.subType ?? null,
        }
      : null,
  };
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  if (!secret || !resendKey) {
    return NextResponse.json({ ok: false, error: "Webhook verification is not configured" }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ ok: false, error: "Missing webhook signature headers" }, { status: 400 });
  }

  const payload = await request.text();
  const resend = new Resend(resendKey);

  let event: WebhookEvent;
  try {
    const verified = await resend.webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    });
    // Resend returns a discriminated union covering email, contact, domain and
    // suppression events. LVL Mail intentionally projects only the safe fields
    // it needs after signature verification.
    event = verified as unknown as WebhookEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 400 });
  }

  if (!supabaseConfigured()) {
    return NextResponse.json({ ok: true, verified: true, persisted: false });
  }

  try {
    await recordWebhookEvent({
      eventId: id,
      providerEmailId: event.data?.email_id ?? null,
      eventType: event.type,
      payload: safeEventDetails(event),
      occurredAt: event.created_at ?? null,
    });

    const recipient = recipientFrom(event);
    if (recipient) {
      if (event.type === "email.complained") {
        await upsertSuppression({ email: recipient, reason: "complaint", source: event.type });
      }

      if (event.type === "email.suppressed" || event.type === "suppression.added") {
        await upsertSuppression({ email: recipient, reason: "provider_suppressed", source: event.type });
      }

      if (
        event.type === "email.bounced" &&
        String(event.data?.bounce?.type ?? "").toLowerCase() === "permanent"
      ) {
        await upsertSuppression({ email: recipient, reason: "bounce", source: event.type });
      }
    }
  } catch {
    // Returning 5xx is deliberate so Resend retries its at-least-once webhook delivery.
    return NextResponse.json({ ok: false, error: "Webhook persistence failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, verified: true, persisted: true });
}
