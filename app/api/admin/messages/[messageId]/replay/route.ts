import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/admin-auth";
import { resolveRegisteredApp } from "@/lib/app-registry";
import {
  beginTrackedMessage,
  getTrackedMessage,
  setTrackedMessageResult,
  trackingConfigured,
} from "@/lib/mail-tracking";
import {
  claimReplay,
  getReplayContext,
} from "@/lib/search-recovery";
import { getSafeReplayDecision } from "@/lib/replay-safety";
import { getRecoveryEnvelope } from "@/lib/recovery-envelope";
import {
  getProviderTopology,
  getReplayProvider,
} from "@/lib/mail-provider";
import {
  getAppPolicy,
  recordProviderOutcome,
  reserveSendBudget,
} from "@/lib/control-plane";
import { reputationAllows } from "@/lib/reputation-guard";
import { isRecipientSuppressed } from "@/lib/supabase-rest";
import { attachTemplateAttribution } from "@/lib/template-attribution";
import { attachProvider } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  if (!authenticateAdminRequest(request)) return error("Unauthorized administrator", 401);
  const { messageId } = await params;
  const source = await getTrackedMessage(messageId);
  if (!source) return error("Source message not found", 404);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const context = await getReplayContext(source.id);
  const decision = getSafeReplayDecision(source, context);
  if (!decision.allowed) {
    return error(decision.explanation, 409, { code: decision.code, decision });
  }

  const envelope = await getRecoveryEnvelope(source.id);
  if (!envelope) return error("Recovery envelope is unavailable or expired", 409, { code: "recovery_payload_unavailable" });
  if (
    envelope.payload.templateKey !== source.template_key ||
    envelope.payload.templateSource !== source.template_source ||
    envelope.payload.templateVersion !== source.template_version
  ) {
    return error("Recovery envelope does not match the tracked message", 409, { code: "recovery_integrity_mismatch" });
  }

  const app = await resolveRegisteredApp(source.app_id);
  if (!app || !app.isEnabled) return error("Application is disabled or unavailable", 409, { code: "app_unavailable" });
  if (!trackingConfigured()) return error("Mandatory tracking is not configured", 503, { code: "tracking_required" });

  const requestedSlot = body.providerSlot === "secondary" ? "secondary" : "primary";
  const topology = getProviderTopology();
  if (requestedSlot === "secondary") {
    if (topology.failoverMode !== "manual") {
      return error("Manual failover is not enabled", 409, { code: "failover_disabled" });
    }
    if (!topology.secondary || !topology.secondaryReady) {
      return error("Secondary provider is not ready", 503, { code: "secondary_provider_unavailable" });
    }
  }

  const provider = getReplayProvider(requestedSlot);
  if (!provider) return error("Selected provider is not configured", 503, { code: "provider_unavailable" });

  const appPolicy = await getAppPolicy(source.app_id);
  if (!appPolicy.enabled_templates.includes(source.template_key)) {
    return error("Template is disabled for this application", 403, { code: "template_disabled" });
  }

  const reputation = await reputationAllows(source.app_id, source.priority);
  if (!reputation.allowed) {
    return error("Application reputation guard blocks this replay", 429, { code: "reputation_restricted" });
  }

  try {
    if (await isRecipientSuppressed(envelope.payload.to)) {
      return error("Recipient is suppressed", 422, { code: "recipient_suppressed" });
    }
  } catch {
    return error("Could not verify recipient suppression state", 503, { code: "suppression_check_unavailable" });
  }

  const replayTrackingId = randomUUID();
  const replayIdempotencyKey = `replay-${source.id}-${replayTrackingId}`;
  let replay;
  try {
    replay = await beginTrackedMessage({
      trackingId: replayTrackingId,
      appId: source.app_id,
      templateKey: source.template_key,
      priority: source.priority,
      recipient: envelope.payload.to,
      idempotencyKey: replayIdempotencyKey,
    });
  } catch {
    return error("Could not create replay tracking record", 503, { code: "tracking_unavailable" });
  }

  try {
    await attachTemplateAttribution({
      messageId: replay.id,
      source: source.template_source,
      version: source.template_version,
    });
  } catch {
    await setTrackedMessageResult({
      trackingId: replay.id,
      status: "failed",
      failureCode: "template_attribution_failed",
    }).catch(() => undefined);
    return error("Could not persist replay template attribution", 503, {
      code: "template_attribution_required",
      trackingId: replay.id,
    });
  }

  const recipientDomain = envelope.payload.to.split("@")[1]?.toLowerCase() ?? "";
  const budget = await reserveSendBudget({
    appId: source.app_id,
    priority: source.priority,
    trackingId: replay.id,
    recipientDomain,
  });
  if (!budget.allowed) {
    await setTrackedMessageResult({
      trackingId: replay.id,
      status: "blocked",
      failureCode: budget.reason ?? "policy_blocked",
    }).catch(() => undefined);
    return error("Application delivery policy blocked the replay", 429, {
      code: budget.reason ?? "policy_blocked",
      trackingId: replay.id,
    });
  }

  const actor = process.env.LVL_MAIL_ADMIN_USER || "lvl-mail-admin";
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim().slice(0, 500)
    : "Safe Replay from message recovery";
  const claimed = await claimReplay({
    sourceMessageId: source.id,
    replayMessageId: replay.id,
    actor,
    reason,
  }).catch(() => false);
  if (!claimed) {
    await setTrackedMessageResult({
      trackingId: replay.id,
      status: "blocked",
      failureCode: "replay_claim_conflict",
    }).catch(() => undefined);
    return error("This source message was already claimed for replay", 409, {
      code: "already_replayed",
      trackingId: replay.id,
    });
  }

  const result = await provider.send({
    from: envelope.payload.from,
    to: envelope.payload.to,
    subject: envelope.payload.subject,
    html: envelope.payload.html,
    text: envelope.payload.text,
    replyTo: envelope.payload.replyTo,
    headers: {
      "X-LVL-Mail-App": source.app_id,
      "X-LVL-Mail-Tracking": replay.id,
      "X-LVL-Mail-Priority": source.priority,
      "X-LVL-Mail-Replay-Of": source.id,
      "X-LVL-Mail-Template-Source": source.template_source,
      ...(source.template_version ? { "X-LVL-Mail-Template-Version": String(source.template_version) } : {}),
    },
    tags: [
      { name: "app", value: source.app_id },
      { name: "tracking_id", value: replay.id },
      { name: "template", value: source.template_key },
      { name: "priority", value: source.priority.toLowerCase() },
      { name: "replay_of", value: source.id },
      { name: "template_source", value: source.template_source },
      ...(source.template_version ? [{ name: "template_version", value: String(source.template_version) }] : []),
    ],
    idempotencyKey: `${source.app_id}/${replayIdempotencyKey}`,
  });

  if (!result.ok) {
    await Promise.allSettled([
      attachProvider(replay.id, result.provider),
      setTrackedMessageResult({
        trackingId: replay.id,
        status: "provider_rejected",
        failureCode: result.errorCode,
      }),
      recordProviderOutcome(source.app_id, false),
    ]);
    return error("Provider rejected the replay", 502, {
      code: result.errorCode,
      provider: result.provider,
      trackingId: replay.id,
      sourceTrackingId: source.id,
    });
  }

  await Promise.allSettled([
    attachProvider(replay.id, result.provider),
    setTrackedMessageResult({
      trackingId: replay.id,
      providerId: result.id,
      status: "accepted",
    }),
    recordProviderOutcome(source.app_id, true),
  ]);

  return NextResponse.json({
    ok: true,
    sourceTrackingId: source.id,
    trackingId: replay.id,
    providerId: result.id,
    provider: result.provider,
    providerSlot: requestedSlot,
    status: "accepted",
  }, { status: 202 });
}
