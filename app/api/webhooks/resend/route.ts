import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  supabaseConfigured,
  upsertSuppression,
} from "@/lib/supabase-rest";
import { recordTrackedEvent } from "@/lib/mail-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EventTag = { name?: string; value?: string };
type WebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    email?: string;
    recipient?: string;
    to?: string[];
    tags?: Record<string, string> | EventTag[];
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

function recipientFrom(event: WebhookEvent) {
  const direct = event.data?.email ?? event.data?.recipient;
  if (typeof direct === "string") return direct;
  const to = event.data?.to;
  return Array.isArray(to) && typeof to[0] === "string" ? to[0] : null;
}

function normalizedTags(value: WebhookEvent["data"] extends infer D
  ? D extends { tags?: infer T } ? T : never
  : never) {
  const result: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const tag of value) {
      if (tag && typeof tag.name === "string" && typeof tag.value === "string") {
        result[tag.name] = tag.value;
      }
    }
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") result[key] = item;
    }
  }
  return result;
}

function safeEventDetails(event: WebhookEvent, tags: Record<string, string>) {
  return {
    tags,
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
    event = verified as unknown as WebhookEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 400 });
  }

  if (!supabaseConfigured()) {
    // Email delivery without persistence is not a supported production state.
    // Return 5xx so provider retries rather than silently losing traceability.
    return NextResponse.json({ ok: false, error: "Tracking persistence is not configured" }, { status: 503 });
  }

  const tags = normalizedTags(event.data?.tags);
  const trackingId = tags.tracking_id ?? null;
  const providerEmailId = event.data?.email_id ?? null;
  const isEmailEvent = event.type.startsWith("email.");

  try {
    if (isEmailEvent) {
      const linked = await recordTrackedEvent({
        eventId: id,
        providerEmailId,
        trackingId,
        eventType: event.type,
        payload: safeEventDetails(event, tags),
        occurredAt: event.created_at ?? null,
      });

      // A verified email event without a tracked message is never accepted as
      // "good enough". Returning 5xx lets Resend retry while the send-side row
      // or provider id is reconciled.
      if (!linked) {
        return NextResponse.json({ ok: false, error: "Email event has no tracking owner" }, { status: 503 });
      }
    }

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
    return NextResponse.json({ ok: false, error: "Webhook persistence failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    verified: true,
    tracked: isEmailEvent,
    trackingId: trackingId ?? undefined,
  });
}
