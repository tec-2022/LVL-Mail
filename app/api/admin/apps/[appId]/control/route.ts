import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/admin-auth";
import { resolveRegisteredApp } from "@/lib/app-registry";
import {
  appendAudit,
  getAppPolicy,
  listAppKeys,
  listAuditEntries,
  listTemplateSettings,
  revokeAppKey,
  rotateAppKey,
  updateAppPolicy,
  updateTemplateSetting,
  type AppMode,
} from "@/lib/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function actor() {
  return process.env.LVL_MAIL_ADMIN_USER || "lvl-mail-admin";
}

async function stateFor(appId: string) {
  const [policy, keys, templates, audit] = await Promise.all([
    getAppPolicy(appId),
    listAppKeys(appId),
    listTemplateSettings(appId),
    listAuditEntries(appId, 50),
  ]);
  return { policy, keys, templates, audit };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  if (!authenticateAdminRequest(request)) return unauthorized();
  const { appId } = await params;
  const app = await resolveRegisteredApp(appId);
  if (!app) return jsonError("Application not found", 404);
  return NextResponse.json({ ok: true, app, ...(await stateFor(appId)) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  if (!authenticateAdminRequest(request)) return unauthorized();
  const { appId } = await params;
  const app = await resolveRegisteredApp(appId);
  if (!app) return jsonError("Application not found", 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body");
  }

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "policy") {
    const mode = body.mode;
    if (mode !== undefined && !["live", "test", "paused"].includes(String(mode))) {
      return jsonError("Invalid mode");
    }
    const policy = await updateAppPolicy(appId, {
      mode: mode as AppMode | undefined,
      minute_limit: typeof body.minuteLimit === "number" ? body.minuteLimit : undefined,
      daily_limit: typeof body.dailyLimit === "number" ? body.dailyLimit : undefined,
      p0_reserved_per_minute: typeof body.p0ReservedPerMinute === "number" ? body.p0ReservedPerMinute : undefined,
      max_consecutive_failures: typeof body.maxConsecutiveFailures === "number" ? body.maxConsecutiveFailures : undefined,
      test_recipient_domains: Array.isArray(body.testRecipientDomains)
        ? body.testRecipientDomains.filter((item): item is string => typeof item === "string")
        : undefined,
    });
    await appendAudit({
      appId,
      action: "policy.updated",
      actor: actor(),
      details: {
        mode: policy.mode,
        minuteLimit: policy.minute_limit,
        dailyLimit: policy.daily_limit,
        p0ReservedPerMinute: policy.p0_reserved_per_minute,
        maxConsecutiveFailures: policy.max_consecutive_failures,
      },
    });
    return NextResponse.json({ ok: true, ...(await stateFor(appId)) });
  }

  if (action === "rotate_key") {
    const label = typeof body.label === "string" ? body.label : "Production";
    const created = await rotateAppKey(appId, label);
    await appendAudit({
      appId,
      action: "key.created",
      actor: actor(),
      details: { keyPrefix: created.keyPrefix, label },
    });
    return NextResponse.json({
      ok: true,
      oneTimeApiKey: created.apiKey,
      ...(await stateFor(appId)),
    });
  }

  if (action === "revoke_key") {
    const keyId = typeof body.keyId === "string" ? body.keyId : "";
    if (!keyId) return jsonError("keyId is required");
    const keys = await listAppKeys(appId);
    const target = keys.find((key) => key.id === keyId && !key.revoked_at);
    if (!target) return jsonError("Active key not found", 404);
    const activeKeys = keys.filter((key) => !key.revoked_at && (!key.expires_at || new Date(key.expires_at) > new Date()));
    if (activeKeys.length <= 1) {
      return jsonError("Create a replacement key before revoking the last active key", 409);
    }
    await revokeAppKey(appId, keyId);
    await appendAudit({
      appId,
      action: "key.revoked",
      actor: actor(),
      details: { keyPrefix: target.key_prefix, label: target.label },
    });
    return NextResponse.json({ ok: true, ...(await stateFor(appId)) });
  }

  if (action === "template") {
    const templateKey = typeof body.templateKey === "string" ? body.templateKey : "";
    const allowed = ["verify-email", "password-reset", "otp", "transactional-notice", "notification"];
    if (!allowed.includes(templateKey)) return jsonError("Invalid template");
    const current = await getAppPolicy(appId);
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const enabledTemplates = enabled
      ? Array.from(new Set([...current.enabled_templates, templateKey]))
      : current.enabled_templates.filter((value) => value !== templateKey);

    await Promise.all([
      updateTemplateSetting(appId, templateKey, {
        enabled,
        locale: typeof body.locale === "string" ? body.locale : "es-MX",
        replyTo: typeof body.replyTo === "string" ? body.replyTo : null,
      }),
      updateAppPolicy(appId, { enabled_templates: enabledTemplates }),
    ]);
    await appendAudit({
      appId,
      action: "template.updated",
      actor: actor(),
      details: { templateKey, enabled },
    });
    return NextResponse.json({ ok: true, ...(await stateFor(appId)) });
  }

  return jsonError("Unsupported action");
}
