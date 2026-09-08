import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/admin-auth";
import { resolveRegisteredApp } from "@/lib/app-registry";
import { priorityForTemplate, type TemplateKey } from "@/lib/mail-policy";
import { getMailProvider } from "@/lib/mail-provider";
import {
  getAppPolicy,
  recordProviderOutcome,
  reserveSendBudget,
} from "@/lib/control-plane";
import { reputationAllows } from "@/lib/reputation-guard";
import { beginTrackedMessage, setTrackedMessageResult, trackingConfigured } from "@/lib/mail-tracking";
import { isRecipientSuppressed } from "@/lib/supabase-rest";
import { attachTemplateAttribution } from "@/lib/template-attribution";
import {
  listTemplateVersions,
  publishTemplateVersion,
  renderStudioTemplate,
  rollbackTemplateVersion,
  saveTemplateDraft,
  templateDefinitions,
  validateTemplateCopy,
  type TemplateCopy,
} from "@/lib/template-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseCopy(value: unknown): TemplateCopy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fields = ["subject", "preheader", "eyebrow", "title", "body", "actionLabel", "footerNote"] as const;
  const result = {} as TemplateCopy;
  for (const field of fields) {
    if (typeof input[field] !== "string") return null;
    result[field] = input[field] as string;
  }
  return result;
}

function isTemplateKey(value: string): value is TemplateKey {
  return value in templateDefinitions;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; templateKey: string }> },
) {
  if (!authenticateAdminRequest(request)) return jsonError("Unauthorized administrator", 401);
  const { appId, templateKey: rawTemplateKey } = await params;
  if (!isTemplateKey(rawTemplateKey)) return jsonError("Unknown template", 404);
  const templateKey = rawTemplateKey;
  const app = await resolveRegisteredApp(appId);
  if (!app) return jsonError("Unknown application", 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  const actor = process.env.LVL_MAIL_ADMIN_USER || "admin";

  if (action === "preview") {
    const copy = parseCopy(body.copy);
    if (!copy) return jsonError("Invalid template copy", 400);
    const errors = validateTemplateCopy(templateKey, copy);
    if (errors.length) return NextResponse.json({ ok: false, errors }, { status: 422 });
    try {
      const rendered = renderStudioTemplate(app, templateKey, templateDefinitions[templateKey].sampleVariables, copy);
      return NextResponse.json({ ok: true, ...rendered });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Preview failed", 422);
    }
  }

  if (action === "save_draft") {
    const copy = parseCopy(body.copy);
    if (!copy) return jsonError("Invalid template copy", 400);
    try {
      const version = await saveTemplateDraft({
        appId,
        templateKey,
        copy,
        changeNote: typeof body.changeNote === "string" ? body.changeNote.slice(0, 500) : "",
        actor,
      });
      return NextResponse.json({ ok: true, version, versions: await listTemplateVersions(appId, templateKey) });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Could not save draft", 422);
    }
  }

  if (action === "publish") {
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) return jsonError("Invalid version", 400);
    try {
      const published = await publishTemplateVersion(appId, templateKey, version, actor);
      return NextResponse.json({ ok: true, published, versions: await listTemplateVersions(appId, templateKey) });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Could not publish template", 422);
    }
  }

  if (action === "rollback") {
    const sourceVersion = Number(body.version);
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1) return jsonError("Invalid version", 400);
    try {
      const published = await rollbackTemplateVersion(appId, templateKey, sourceVersion, actor);
      return NextResponse.json({ ok: true, published, versions: await listTemplateVersions(appId, templateKey) });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Could not rollback template", 422);
    }
  }

  if (action === "test_send") {
    const copy = parseCopy(body.copy);
    const to = body.to;
    if (!copy) return jsonError("Invalid template copy", 400);
    if (!validEmail(to)) return jsonError("Invalid test recipient", 400);
    const errors = validateTemplateCopy(templateKey, copy);
    if (errors.length) return NextResponse.json({ ok: false, errors }, { status: 422 });
    if (!trackingConfigured()) return jsonError("Mandatory mail tracking is not configured", 503, { code: "tracking_required" });
    const provider = getMailProvider();
    if (!provider) return jsonError("Mail provider is not configured", 503);

    const priority = priorityForTemplate(templateKey);
    const trackingId = randomUUID();
    const idempotencyKey = `studio-test-${trackingId}`;
    const sampleVariables = templateDefinitions[templateKey].sampleVariables;
    let rendered;
    try {
      rendered = renderStudioTemplate(app, templateKey, sampleVariables, copy);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Template render failed", 422);
    }

    try {
      await beginTrackedMessage({ trackingId, appId, templateKey, priority, recipient: to, idempotencyKey });
      await attachTemplateAttribution({ messageId: trackingId, source: "studio_test" });
    } catch {
      await setTrackedMessageResult({ trackingId, status: "failed", failureCode: "template_attribution_failed" }).catch(() => undefined);
      return jsonError("Could not create mandatory tracking and template attribution", 503, { code: "tracking_unavailable" });
    }

    const reputation = await reputationAllows(appId, priority);
    if (!reputation.allowed) {
      await setTrackedMessageResult({ trackingId, status: "blocked", failureCode: "reputation_restricted" }).catch(() => undefined);
      return jsonError("Application reputation guard blocked test email", 429, { trackingId });
    }

    const appPolicy = await getAppPolicy(appId);
    if (!appPolicy.enabled_templates.includes(templateKey)) {
      await setTrackedMessageResult({ trackingId, status: "blocked", failureCode: "template_disabled" }).catch(() => undefined);
      return jsonError("Template is disabled for this application", 403, { trackingId });
    }

    const recipientDomain = to.split("@")[1]?.toLowerCase() ?? "";
    const budget = await reserveSendBudget({ appId, priority, trackingId, recipientDomain });
    if (!budget.allowed) {
      await setTrackedMessageResult({ trackingId, status: "blocked", failureCode: budget.reason ?? "policy_blocked" }).catch(() => undefined);
      return jsonError("Application delivery policy blocked test email", 429, { trackingId, code: budget.reason });
    }

    try {
      if (await isRecipientSuppressed(to)) {
        await setTrackedMessageResult({ trackingId, status: "blocked", failureCode: "recipient_suppressed" });
        return jsonError("Recipient is suppressed", 422, { trackingId });
      }
    } catch {
      // Provider-side suppression remains authoritative; tracking already exists.
    }

    const domain = process.env.LVL_MAIL_SENDING_DOMAIN ?? "mail.lvltechmx.com";
    const result = await provider.send({
      from: `${app.name} <${app.senderLocalPart}@${domain}>`,
      to,
      subject: `[PRUEBA] ${rendered.subject}`.slice(0, 160),
      html: rendered.html,
      text: rendered.text,
      headers: {
        "X-LVL-Mail-App": appId,
        "X-LVL-Mail-Tracking": trackingId,
        "X-LVL-Mail-Priority": priority,
        "X-LVL-Mail-Studio-Test": "true",
        "X-LVL-Mail-Template-Source": "studio_test",
      },
      tags: [
        { name: "app", value: appId },
        { name: "tracking_id", value: trackingId },
        { name: "template", value: templateKey },
        { name: "priority", value: priority.toLowerCase() },
        { name: "studio_test", value: "true" },
        { name: "template_source", value: "studio_test" },
      ],
      idempotencyKey: `${appId}/${idempotencyKey}`,
    });

    if (!result.ok) {
      await Promise.allSettled([
        setTrackedMessageResult({ trackingId, status: "provider_rejected", failureCode: result.errorCode }),
        recordProviderOutcome(appId, false),
      ]);
      return jsonError("Provider rejected test email", 502, { trackingId, providerCode: result.errorCode });
    }

    await Promise.allSettled([
      setTrackedMessageResult({ trackingId, providerId: result.id, status: "accepted" }),
      recordProviderOutcome(appId, true),
    ]);
    return NextResponse.json({ ok: true, trackingId, providerId: result.id, provider: result.provider }, { status: 202 });
  }

  return jsonError("Unsupported action", 400);
}
