import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  appBrands,
  authenticateApp,
  deliveryPolicy,
  priorityForTemplate,
  renderTemplate,
  type TemplateKey,
} from "@/lib/mail-policy";
import {
  isRecipientSuppressed,
  recordAcceptedMessage,
  supabaseConfigured,
} from "@/lib/supabase-rest";

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

  if (!appBrands[appId]) return jsonError("Unknown appId", 400);
  if (!authenticateApp(appId, request.headers.get("x-lvl-mail-key"))) return jsonError("Unauthorized application", 401);
  if (!template || !allowedTemplates.has(template)) return jsonError("Unsupported template", 400);
  if (!validEmail(to)) return jsonError("Invalid recipient", 400);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 256) return jsonError("A valid idempotencyKey is required", 400);

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return jsonError("Mail provider is not configured", 503);

  const priority = priorityForTemplate(template);
  const policy = deliveryPolicy(priority);
  let observability: "ready" | "degraded" | "not-configured" = supabaseConfigured() ? "ready" : "not-configured";

  if (supabaseConfigured()) {
    try {
      if (await isRecipientSuppressed(to)) {
        return jsonError("Recipient is suppressed", 422, { code: "recipient_suppressed" });
      }
    } catch {
      // Provider-side suppressions still protect deliverability. Do not block
      // authentication mail solely because observability storage is degraded.
      observability = "degraded";
    }
  }

  let rendered;
  try {
    rendered = renderTemplate(appBrands[appId], template, variables);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid template variables", 400);
  }

  const domain = process.env.LVL_MAIL_SENDING_DOMAIN ?? "mail.lvltechmx.com";
  const brand = appBrands[appId];
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
        "X-LVL-Mail-Priority": priority,
      },
      tags: [
        { name: "app", value: appId },
        { name: "template", value: template },
        { name: "priority", value: priority.toLowerCase() },
      ],
    },
    { idempotencyKey: `${appId}/${idempotencyKey}` },
  );

  if (error || !data?.id) {
    const providerCode = error && typeof error === "object" && "name" in error
      ? String(error.name)
      : null;
    return jsonError("Provider rejected email", 502, { providerCode });
  }

  if (supabaseConfigured()) {
    try {
      await recordAcceptedMessage({
        providerId: data.id,
        appId,
        templateKey: template,
        priority,
        recipient: to,
        idempotencyKey,
      });
    } catch {
      observability = "degraded";
    }
  }

  return NextResponse.json({
    ok: true,
    id: data.id,
    appId,
    template,
    priority,
    delivery: policy,
    observability,
  }, { status: 202 });
}
