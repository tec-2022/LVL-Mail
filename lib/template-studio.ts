import type { AppBrand, TemplateKey } from "@/lib/mail-policy";
import { supabaseConfigured } from "@/lib/supabase-rest";

export type TemplateCopy = {
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
  actionLabel: string;
  footerNote: string;
};

export type TemplateVersion = {
  id: string;
  app_id: string;
  template_key: TemplateKey;
  version: number;
  status: "draft" | "published" | "archived";
  subject_template: string;
  preheader_template: string;
  eyebrow_template: string;
  title_template: string;
  body_template: string;
  action_label_template: string | null;
  footer_note_template: string;
  change_note: string | null;
  created_by: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateDefinition = {
  key: TemplateKey;
  name: string;
  description: string;
  priority: "P0" | "P1" | "P2";
  allowedTokens: string[];
  protectedStructure: string[];
  defaults: TemplateCopy;
  sampleVariables: Record<string, unknown>;
};

export const templateDefinitions: Record<TemplateKey, TemplateDefinition> = {
  "verify-email": {
    key: "verify-email",
    name: "Confirmar correo",
    description: "Activa una cuenta con CTA HTTPS obligatorio y expiración visible.",
    priority: "P0",
    allowedTokens: ["name", "brandName", "expiresMinutes"],
    protectedStructure: ["CTA de confirmación HTTPS", "expiración", "tracking P0"],
    defaults: {
      subject: "Confirma tu correo en {{brandName}}",
      preheader: "Confirma tu dirección para activar tu cuenta.",
      eyebrow: "Verificación de cuenta",
      title: "Confirma tu correo",
      body: "{{name}}, confirma esta dirección para terminar de activar tu cuenta en {{brandName}}.",
      actionLabel: "Confirmar correo",
      footerNote: "Por seguridad, este enlace vence en {{expiresMinutes}} minutos. Si no solicitaste esta cuenta, puedes ignorar el mensaje.",
    },
    sampleVariables: { name: "Alex", confirmationUrl: "https://example.com/auth/confirm?token=preview", expiresMinutes: "15" },
  },
  "password-reset": {
    key: "password-reset",
    name: "Recuperar contraseña",
    description: "Recuperación segura con CTA HTTPS que LVL Mail no permite eliminar.",
    priority: "P0",
    allowedTokens: ["name", "brandName", "expiresMinutes"],
    protectedStructure: ["CTA de recuperación HTTPS", "expiración", "tracking P0"],
    defaults: {
      subject: "Restablece tu contraseña de {{brandName}}",
      preheader: "Usa el enlace seguro para crear una nueva contraseña.",
      eyebrow: "Seguridad",
      title: "Restablece tu contraseña",
      body: "{{name}}, recibimos una solicitud para cambiar la contraseña de tu cuenta en {{brandName}}.",
      actionLabel: "Crear nueva contraseña",
      footerNote: "El enlace vence en {{expiresMinutes}} minutos. Si no hiciste esta solicitud, no necesitas realizar ninguna acción.",
    },
    sampleVariables: { name: "Alex", resetUrl: "https://example.com/auth/reset?token=preview", expiresMinutes: "15" },
  },
  otp: {
    key: "otp",
    name: "Código OTP",
    description: "Código destacado en un bloque protegido; el editor solo modifica el copy alrededor.",
    priority: "P0",
    allowedTokens: ["name", "brandName", "expiresMinutes"],
    protectedStructure: ["bloque OTP", "expiración", "tracking P0"],
    defaults: {
      subject: "Tu código de {{brandName}}",
      preheader: "Tu código de acceso de un solo uso.",
      eyebrow: "Código de acceso",
      title: "Tu código de verificación",
      body: "{{name}}, utiliza este código para continuar en {{brandName}}.",
      actionLabel: "",
      footerNote: "Vence en {{expiresMinutes}} minutos. Nunca compartas este código.",
    },
    sampleVariables: { name: "Alex", code: "482913", expiresMinutes: "15" },
  },
  "transactional-notice": {
    key: "transactional-notice",
    name: "Aviso transaccional",
    description: "Pedidos, reservas, facturas e invitaciones con CTA opcional.",
    priority: "P1",
    allowedTokens: ["name", "brandName", "title", "message", "actionLabel"],
    protectedStructure: ["tracking por aplicación", "CTA HTTPS cuando existe"],
    defaults: {
      subject: "{{brandName}}: {{title}}",
      preheader: "{{message}}",
      eyebrow: "Actualización",
      title: "{{title}}",
      body: "{{message}}",
      actionLabel: "{{actionLabel}}",
      footerNote: "",
    },
    sampleVariables: { name: "Alex", title: "Pedido confirmado", message: "Tu pedido #NM-2048 fue confirmado y ya está en preparación.", actionLabel: "Ver pedido", actionUrl: "https://example.com/orders/NM-2048" },
  },
  notification: {
    key: "notification",
    name: "Notificación",
    description: "Avisos y actualizaciones no bloqueantes con CTA opcional.",
    priority: "P2",
    allowedTokens: ["name", "brandName", "title", "message", "actionLabel"],
    protectedStructure: ["tracking por aplicación", "CTA HTTPS cuando existe"],
    defaults: {
      subject: "{{brandName}}: {{title}}",
      preheader: "{{message}}",
      eyebrow: "Notificación",
      title: "{{title}}",
      body: "{{message}}",
      actionLabel: "{{actionLabel}}",
      footerNote: "",
    },
    sampleVariables: { name: "Alex", title: "Tienes una actualización", message: "Hay novedades disponibles en tu cuenta.", actionLabel: "Ver detalle", actionUrl: "https://example.com/account" },
  },
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Template persistence is not configured");
  const response = await fetch(`${current.url}${path}`, {
    ...init,
    headers: {
      apikey: current.serviceRoleKey,
      Authorization: `Bearer ${current.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Template persistence failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function plain(value: unknown, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return fallback;
}

function tokens(value: string) {
  return [...value.matchAll(/{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g)].map((match) => match[1]);
}

export function validateTemplateCopy(templateKey: TemplateKey, copy: TemplateCopy) {
  const definition = templateDefinitions[templateKey];
  const errors: string[] = [];
  const limits: Array<[keyof TemplateCopy, number]> = [
    ["subject", 160], ["preheader", 240], ["eyebrow", 80], ["title", 140],
    ["body", 2000], ["actionLabel", 80], ["footerNote", 800],
  ];
  for (const [field, limit] of limits) {
    if (copy[field].length > limit) errors.push(`${field} supera ${limit} caracteres`);
    if (/[<>]/.test(copy[field])) errors.push(`${field} no admite HTML`);
    for (const token of tokens(copy[field])) {
      if (!definition.allowedTokens.includes(token)) errors.push(`Variable {{${token}}} no permitida en ${definition.name}`);
    }
  }
  if (!copy.subject.trim()) errors.push("El asunto es obligatorio");
  if (!copy.title.trim()) errors.push("El título es obligatorio");
  if (!copy.body.trim()) errors.push("El cuerpo es obligatorio");
  if ((templateKey === "verify-email" || templateKey === "password-reset") && !copy.actionLabel.trim()) {
    errors.push("El CTA crítico no puede quedar vacío");
  }
  if (templateKey === "otp" && copy.actionLabel.trim()) errors.push("OTP no utiliza CTA");
  return errors;
}

function interpolate(value: string, brand: AppBrand, variables: Record<string, unknown>) {
  return value.replace(/{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g, (_match, key: string) => {
    if (key === "brandName") return brand.name;
    if (key === "name") return plain(variables.name, "Hola");
    return plain(variables[key], "");
  });
}

function httpsUrl(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Missing ${field}`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${field} must use https`);
  return url.toString();
}

function emailShell(brand: AppBrand, copy: TemplateCopy, inner: string) {
  const preheader = escapeHtml(copy.preheader).replaceAll("\n", " ");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden">
<tr><td style="padding:28px 32px 18px;background:${brand.surface}"><div style="font-size:22px;font-weight:800;color:${brand.accent}">${escapeHtml(brand.name)}</div><div style="margin-top:4px;font-size:13px;color:#64748b">${escapeHtml(brand.tagline)}</div></td></tr>
<tr><td style="padding:30px 32px">${inner}</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b">Este es un correo automático enviado por ${escapeHtml(brand.name)} mediante LVL Mail.<br>Infraestructura de correo de LVL Tech · mail.lvltechmx.com</td></tr>
</table></td></tr></table></body></html>`;
}

function button(brand: AppBrand, label: string, href: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:18px;background:${brand.accent};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 20px;border-radius:10px">${escapeHtml(label)}</a>`;
}

export function renderStudioTemplate(brand: AppBrand, templateKey: TemplateKey, variables: Record<string, unknown>, copy: TemplateCopy) {
  const errors = validateTemplateCopy(templateKey, copy);
  if (errors.length) throw new Error(errors[0]);

  const resolved: TemplateCopy = {
    subject: interpolate(copy.subject, brand, variables).replace(/[\r\n]+/g, " ").slice(0, 160),
    preheader: interpolate(copy.preheader, brand, variables),
    eyebrow: interpolate(copy.eyebrow, brand, variables),
    title: interpolate(copy.title, brand, variables),
    body: interpolate(copy.body, brand, variables),
    actionLabel: interpolate(copy.actionLabel, brand, variables),
    footerNote: interpolate(copy.footerNote, brand, variables),
  };

  let protectedBlock = "";
  let action = "";
  if (templateKey === "verify-email") action = button(brand, resolved.actionLabel, httpsUrl(variables.confirmationUrl, "confirmationUrl"));
  if (templateKey === "password-reset") action = button(brand, resolved.actionLabel, httpsUrl(variables.resetUrl, "resetUrl"));
  if (templateKey === "otp") {
    const code = plain(variables.code).replace(/[^0-9A-Za-z-]/g, "").slice(0, 12);
    if (!code) throw new Error("Missing code");
    protectedBlock = `<div style="margin-top:20px;padding:18px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:12px;text-align:center;font-size:30px;font-weight:800;letter-spacing:.18em">${escapeHtml(code)}</div>`;
  }
  if (templateKey === "transactional-notice" || templateKey === "notification") {
    if (variables.actionUrl) action = button(brand, resolved.actionLabel || "Ver detalle", httpsUrl(variables.actionUrl, "actionUrl"));
  }

  const inner = `<div style="font-size:13px;font-weight:700;color:${brand.accent};text-transform:uppercase;letter-spacing:.08em">${escapeHtml(resolved.eyebrow)}</div>
<h1 style="margin:10px 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.03em">${escapeHtml(resolved.title)}</h1>
<p style="margin:0;color:#475569;font-size:15px;line-height:1.7">${escapeHtml(resolved.body).replaceAll("\n", "<br>")}</p>${protectedBlock}${action}${resolved.footerNote ? `<p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6">${escapeHtml(resolved.footerNote).replaceAll("\n", "<br>")}</p>` : ""}`;

  return {
    subject: resolved.subject,
    text: `${resolved.title}\n\n${resolved.body}${resolved.footerNote ? `\n\n${resolved.footerNote}` : ""}`,
    html: emailShell(brand, resolved, inner),
  };
}

export function versionToCopy(version: TemplateVersion): TemplateCopy {
  return {
    subject: version.subject_template,
    preheader: version.preheader_template,
    eyebrow: version.eyebrow_template,
    title: version.title_template,
    body: version.body_template,
    actionLabel: version.action_label_template ?? "",
    footerNote: version.footer_note_template,
  };
}

const versionSelect = "id,app_id,template_key,version,status,subject_template,preheader_template,eyebrow_template,title_template,body_template,action_label_template,footer_note_template,change_note,created_by,published_at,created_at,updated_at";

export async function listTemplateVersions(appId: string, templateKey: TemplateKey): Promise<TemplateVersion[]> {
  if (!supabaseConfigured()) return [];
  return await request<TemplateVersion[]>(`/rest/v1/mail_template_versions?app_id=eq.${encodeURIComponent(appId)}&template_key=eq.${encodeURIComponent(templateKey)}&select=${versionSelect}&order=version.desc`);
}

export async function getPublishedTemplateVersion(appId: string, templateKey: TemplateKey): Promise<TemplateVersion | null> {
  if (!supabaseConfigured()) return null;
  const rows = await request<TemplateVersion[]>(`/rest/v1/mail_template_versions?app_id=eq.${encodeURIComponent(appId)}&template_key=eq.${encodeURIComponent(templateKey)}&status=eq.published&select=${versionSelect}&limit=1`);
  return rows[0] ?? null;
}

export async function getEffectiveTemplateCopy(appId: string, templateKey: TemplateKey): Promise<TemplateCopy | null> {
  try {
    const published = await getPublishedTemplateVersion(appId, templateKey);
    return published ? versionToCopy(published) : null;
  } catch {
    return null;
  }
}

export async function saveTemplateDraft(input: { appId: string; templateKey: TemplateKey; copy: TemplateCopy; changeNote?: string; actor: string }) {
  const errors = validateTemplateCopy(input.templateKey, input.copy);
  if (errors.length) throw new Error(errors.join(" · "));
  const existing = await listTemplateVersions(input.appId, input.templateKey);
  const draft = existing.find((version) => version.status === "draft");
  if (draft) {
    const rows = await request<TemplateVersion[]>(`/rest/v1/mail_template_versions?id=eq.${encodeURIComponent(draft.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        subject_template: input.copy.subject,
        preheader_template: input.copy.preheader,
        eyebrow_template: input.copy.eyebrow,
        title_template: input.copy.title,
        body_template: input.copy.body,
        action_label_template: input.copy.actionLabel || null,
        footer_note_template: input.copy.footerNote,
        change_note: input.changeNote || null,
        updated_at: new Date().toISOString(),
      }),
    });
    return rows[0] ?? draft;
  }
  const rows = await request<TemplateVersion[]>("/rest/v1/rpc/mail_create_template_draft", {
    method: "POST",
    body: JSON.stringify({
      p_app_id: input.appId,
      p_template_key: input.templateKey,
      p_subject_template: input.copy.subject,
      p_preheader_template: input.copy.preheader,
      p_eyebrow_template: input.copy.eyebrow,
      p_title_template: input.copy.title,
      p_body_template: input.copy.body,
      p_action_label_template: input.copy.actionLabel,
      p_footer_note_template: input.copy.footerNote,
      p_change_note: input.changeNote ?? "",
      p_actor: input.actor,
    }),
  });
  return rows[0] ?? null;
}

export async function publishTemplateVersion(appId: string, templateKey: TemplateKey, version: number, actor: string) {
  const rows = await request<TemplateVersion[]>("/rest/v1/rpc/mail_publish_template_version", { method: "POST", body: JSON.stringify({ p_app_id: appId, p_template_key: templateKey, p_version: version, p_actor: actor }) });
  return rows[0] ?? null;
}

export async function rollbackTemplateVersion(appId: string, templateKey: TemplateKey, sourceVersion: number, actor: string) {
  const rows = await request<TemplateVersion[]>("/rest/v1/rpc/mail_rollback_template_version", { method: "POST", body: JSON.stringify({ p_app_id: appId, p_template_key: templateKey, p_source_version: sourceVersion, p_actor: actor }) });
  return rows[0] ?? null;
}
