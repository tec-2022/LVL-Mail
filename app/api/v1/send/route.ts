import { NextRequest, NextResponse } from "next/server";
import {
  appBrands,
  authenticateApp,
  deliveryPolicy,
  priorityForTemplate,
  renderTemplate,
  type TemplateKey,
} from "@/lib/mail-policy";

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

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
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

  let rendered;
  try {
    rendered = renderTemplate(appBrands[appId], template, variables);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid template variables", 400);
  }

  const priority = priorityForTemplate(template);
  const policy = deliveryPolicy(priority);
  const domain = process.env.LVL_MAIL_SENDING_DOMAIN ?? "mail.lvltechmx.com";
  const brand = appBrands[appId];

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${appId}/${idempotencyKey}`,
    },
    body: JSON.stringify({
      from: `${brand.name} <${brand.senderLocalPart}@${domain}>`,
      to: [to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "X-LVL-Mail-App": appId,
        "X-LVL-Mail-Priority": priority,
      },
    }),
    cache: "no-store",
  });

  const providerBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ ok: false, error: "Provider rejected email", provider: providerBody }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    id: (providerBody as { id?: string }).id ?? null,
    appId,
    template,
    priority,
    delivery: policy,
  }, { status: 202 });
}
