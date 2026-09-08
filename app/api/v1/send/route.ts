import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  deliveryPolicy,
  priorityForTemplate,
  renderTemplate,
  type TemplateKey,
} from "@/lib/mail-policy";
import {
  authenticateRegisteredApp,
  resolveRegisteredApp,
} from "@/lib/app-registry";
import { isRecipientSuppressed } from "@/lib/supabase-rest";
import {
  beginTrackedMessage,
  setTrackedMessageResult,
  trackingConfigured,
} from "@/lib/mail-tracking";
import {
  getAppPolicy,
  recordProviderOutcome,
  reserveSendBudget,
} from "@/lib/control-plane";
import { reputationAllows } from "@/lib/reputation-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedTemplates = new Set<TemplateKey>([
  "verify-email",
  "password-reset",
  "otp",
  "transactional-notice",
  "notification",
]);

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function statusForPolicyReason(reason: string | null) {
  if (reason === "minute_limit" || reason === "daily_limit" || reason === "p0_capacity_reserved") return 429;
  if (reason === "test_recipient_not_allowed") return 403;
  if (reason === "app_paused") return 423;
  return 503;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const appId = typeof body.appId === "string" ? body.appId : "";
  const template = typeof body.template === "string" ? body.template as TemplateKey : null;
  const to = body.to;
  const variables = body.variables && typeof body.variables === "object" && !Array.isArray(body.variables)
    ? body.variables as Record<string, unknown>
    : {};
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  const brand = await resolveRegisteredApp(appId);
  if (!brand || !brand.isEnabled) return jsonError("Unknown or disabled appId", 400);
  if (!await authenticateRegisteredApp(appId, request.headers.get("x-lvl-mail-key"))) {
    return jsonError("Unauthorized application", 401);
  }
  if (!template || !allowedTemplates.has(template)) return jsonError("Unsupported template", 400);
  if (!validEmail(to)) return jsonError("Invalid recipient", 400);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 256) {
    return jsonError("A valid idempotencyKey is required", 400);
  }

  let rendered;
  try {
    rendered = renderTemplate(brand, template, variables);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid template variables", 400);
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return jsonError("Mail provider is not configured", 503);
  if (!trackingConfigured()) {
    return jsonError("Mandatory mail tracking is not configured", 503, { code: "tracking_required" });
  }

  const priority = priorityForTemplate(template);
  const policy = deliveryPolicy(priority);
  const requestedTrackingId = randomUUID();

  let tracked;
  try {
    tracked = await beginTrackedMessage({
      trackingId: requestedTrackingId,
      appId,
      templateKey: template,
      priority,
      recipient: to,
      idempotencyKey,
    });
  } catch {
    return jsonError("Could not create mandatory tracking record", 503, { code: "tracking_unavailable" });
  }

  if (tracked.id !== requestedTrackingId) {
    return NextResponse.json({
      ok: Boolean(tracked.provider_id),
      id: tracked.provider_id,
      trackingId: tracked.id,
      appId,
      template,
      priority,
      status: tracked.status,
      idempotentReplay: true,
    }, { status: tracked.provider_id ? 202 : 409 });
  }

  const appPolicy = await getAppPolicy(appId);
  if (!appPolicy.enabled_templates.includes(template)) {
    await setTrackedMessageResult({
      trackingId: tracked.id,
      status: "blocked",
      failureCode: "template_disabled",
    }).catch(() => undefined);
    return jsonError("Template is disabled for this application", 403, {
      code: "template_disabled",
      trackingId: tracked.id,
      appId,
    });
  }

  // Reputation is isolated per application. A restricted app may continue to
  // send P0 authentication mail, but cannot send lower-priority traffic until
  // its 24-hour bounce/complaint window recovers.
  const reputation = await reputationAllows(appId, priority);
  if (!reputation.allowed) {
    await setTrackedMessageResult({
      trackingId: tracked.id,
      status: "blocked",
      failureCode: "reputation_restricted",
    }).catch(() => undefined);
    return jsonError("Application reputation guard blocked non-critical email", 429, {
      code: "reputation_restricted",
      trackingId: tracked.id,
      appId,
      reputation: reputation.state,
    });
  }

  const recipientDomain = to.split("@")[1]?.toLowerCase() ?? "";
  const budget = await reserveSendBudget({
    appId,
    priority,
    trackingId: tracked.id,
    recipientDomain,
  });
  if (!budget.allowed) {
    await setTrackedMessageResult({
      trackingId: tracked.id,
      status: "blocked",
      failureCode: budget.reason ?? "policy_blocked",
    }).catch(() => undefined);
    return jsonError("Application delivery policy blocked this email", statusForPolicyReason(budget.reason), {
      code: budget.reason ?? "policy_blocked",
      trackingId: tracked.id,
      appId,
      policy: {
        mode: budget.mode,
        circuitState: budget.circuit_state,
        minuteUsed: budget.minute_used,
        minuteLimit: budget.minute_limit,
        dayUsed: budget.day_used,
        dailyLimit: budget.daily_limit,
      },
    });
  }

  try {
    if (await isRecipientSuppressed(to)) {
      await setTrackedMessageResult({
        trackingId: tracked.id,
        status: "blocked",
        failureCode: "recipient_suppressed",
      });
      return jsonError("Recipient is suppressed", 422, {
        code: "recipient_suppressed",
        trackingId: tracked.id,
        appId,
      });
    }
  } catch {
    // The send remains tracked. Provider-side suppression remains authoritative.
  }

  const domain = process.env.LVL_MAIL_SENDING_DOMAIN ?? "mail.lvltechmx.com";
  const resend = new Resend(resendKey);

  const { data, error } = await resend.emails.send(
    {
      from: `${brand.name} <${brand.senderLocalPart}@${domain}>`,
      to: [to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "X-LVL-Mail-App": appId,
        "X-LVL-Mail-Tracking": tracked.id,
        "X-LVL-Mail-Priority": priority,
      },
      tags: [
        { name: "app", value: appId },
        { name: "tracking_id", value: tracked.id },
        { name: "template", value: template },
        { name: "priority", value: priority.toLowerCase() },
      ],
    },
    { idempotencyKey: `${appId}/${idempotencyKey}` },
  );

  if (error || !data?.id) {
    const providerCode = error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "provider_rejected";
    await Promise.allSettled([
      setTrackedMessageResult({
        trackingId: tracked.id,
        status: "provider_rejected",
        failureCode: providerCode,
      }),
      recordProviderOutcome(appId, false),
    ]);
    return jsonError("Provider rejected email", 502, {
      providerCode,
      trackingId: tracked.id,
      appId,
    });
  }

  let trackingState: "ready" | "event-reconciliation" = "ready";
  try {
    await setTrackedMessageResult({
      trackingId: tracked.id,
      providerId: data.id,
      status: "accepted",
    });
  } catch {
    trackingState = "event-reconciliation";
  }
  void recordProviderOutcome(appId, true);

  return NextResponse.json({
    ok: true,
    id: data.id,
    trackingId: tracked.id,
    appId,
    template,
    priority,
    status: "accepted",
    delivery: policy,
    tracking: trackingState,
    reputation: reputation.state.reputation_state,
    quota: {
      minuteUsed: budget.minute_used,
      minuteLimit: budget.minute_limit,
      dayUsed: budget.day_used,
      dailyLimit: budget.daily_limit,
    },
  }, { status: 202 });
}
