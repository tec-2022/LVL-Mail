import { timingSafeEqual } from "node:crypto";

export type MailPriority = "P0" | "P1" | "P2" | "P3";
export type TemplateKey =
  | "verify-email"
  | "password-reset"
  | "otp"
  | "transactional-notice"
  | "notification";

export type AppBrand = {
  id: string;
  name: string;
  senderLocalPart: string;
  tagline: string;
  accent: string;
  surface: string;
};

export const appBrands: Record<string, AppBrand> = {
  lvltech: {
    id: "lvltech",
    name: "LVL Tech",
    senderLocalPart: "hola",
    tagline: "Tecnología que conecta productos y personas.",
    accent: "#111827",
    surface: "#f8fafc",
  },
  nexmesa: {
    id: "nexmesa",
    name: "NexMesa",
    senderLocalPart: "nexmesa",
    tagline: "Tu restaurante, conectado.",
    accent: "#0f172a",
    surface: "#f8fafc",
  },
  finlab: {
    id: "finlab",
    name: "FINLAB",
    senderLocalPart: "finlab",
    tagline: "Aprende finanzas practicando.",
    accent: "#be185d",
    surface: "#fff7fb",
  },
  cody: {
    id: "cody",
    name: "Cody",
    senderLocalPart: "cody",
    tagline: "Aprender código, paso a paso.",
    accent: "#4338ca",
    surface: "#f5f3ff",
  },
};

const p0Templates = new Set<TemplateKey>([
  "verify-email",
  "password-reset",
  "otp",
]);
const p1Templates = new Set<TemplateKey>(["transactional-notice"]);

export function priorityForTemplate(template: TemplateKey): MailPriority {
  if (p0Templates.has(template)) return "P0";
  if (p1Templates.has(template)) return "P1";
  return "P2";
}

export function deliveryPolicy(priority: MailPriority) {
  return {
    priority,
    bypassBatching: priority === "P0",
    reservedCapacity: priority === "P0",
    purpose:
      priority === "P0"
        ? "security"
        : priority === "P1"
          ? "transactional"
          : priority === "P2"
            ? "notification"
            : "marketing",
  } as const;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authenticateApp(appId: string, presentedKey: string | null) {
  if (!presentedKey) return false;

  let keys: Record<string, string> = {};
  try {
    keys = JSON.parse(process.env.LVL_MAIL_APP_KEYS ?? "{}") as Record<string, string>;
  } catch {
    return false;
  }

  const expected = keys[appId];
  if (!expected || expected === "replace-me") return false;
  return safeEqual(expected, presentedKey);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function requireHttpsUrl(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Missing ${field}`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${field} must use https`);
  return url.toString();
}

function shell(brand: AppBrand, content: string) {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Inter,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.06)">
        <tr><td style="padding:28px 32px 18px;background:${brand.surface}">
          <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;color:${brand.accent}">${escapeHtml(brand.name)}</div>
          <div style="margin-top:4px;font-size:13px;color:#64748b">${escapeHtml(brand.tagline)}</div>
        </td></tr>
        <tr><td style="padding:30px 32px">${content}</td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b">
          Este es un correo automático enviado por ${escapeHtml(brand.name)} mediante LVL Mail.<br>
          Infraestructura de correo de LVL Tech · mail.lvltechmx.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(brand: AppBrand, label: string, href: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:18px;background:${brand.accent};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 20px;border-radius:10px">${escapeHtml(label)}</a>`;
}

export function renderTemplate(
  brand: AppBrand,
  template: TemplateKey,
  variables: Record<string, unknown>,
) {
  const name = escapeHtml(text(variables.name, "Hola"));
  const expires = escapeHtml(text(variables.expiresMinutes, "15"));

  if (template === "verify-email") {
    const url = requireHttpsUrl(variables.confirmationUrl, "confirmationUrl");
    const subject = `Confirma tu correo en ${brand.name}`;
    return {
      subject,
      text: `${text(variables.name, "Hola")}, confirma tu correo en ${brand.name}: ${url}. El enlace vence en ${expires} minutos.`,
      html: shell(
        brand,
        `<div style="font-size:13px;font-weight:700;color:${brand.accent};text-transform:uppercase;letter-spacing:.08em">Verificación de cuenta</div>
         <h1 style="margin:10px 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.03em">Confirma tu correo</h1>
         <p style="margin:0;color:#475569;font-size:15px;line-height:1.7">${name}, confirma esta dirección para terminar de activar tu cuenta en ${escapeHtml(brand.name)}.</p>
         ${button(brand, "Confirmar correo", url)}
         <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6">Por seguridad, este enlace vence en ${expires} minutos. Si no solicitaste esta cuenta, puedes ignorar el mensaje.</p>`,
      ),
    };
  }

  if (template === "password-reset") {
    const url = requireHttpsUrl(variables.resetUrl, "resetUrl");
    const subject = `Restablece tu contraseña de ${brand.name}`;
    return {
      subject,
      text: `${text(variables.name, "Hola")}, restablece tu contraseña de ${brand.name}: ${url}. El enlace vence en ${expires} minutos.`,
      html: shell(
        brand,
        `<div style="font-size:13px;font-weight:700;color:${brand.accent};text-transform:uppercase;letter-spacing:.08em">Seguridad</div>
         <h1 style="margin:10px 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.03em">Restablece tu contraseña</h1>
         <p style="margin:0;color:#475569;font-size:15px;line-height:1.7">${name}, recibimos una solicitud para cambiar la contraseña de tu cuenta.</p>
         ${button(brand, "Crear nueva contraseña", url)}
         <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6">El enlace vence en ${expires} minutos. Si no hiciste esta solicitud, no necesitas realizar ninguna acción.</p>`,
      ),
    };
  }

  if (template === "otp") {
    const code = text(variables.code).replace(/[^0-9A-Za-z-]/g, "").slice(0, 12);
    if (!code) throw new Error("Missing code");
    const subject = `Tu código de ${brand.name}`;
    return {
      subject,
      text: `${text(variables.name, "Hola")}, tu código de ${brand.name} es ${code}. Vence en ${expires} minutos.`,
      html: shell(
        brand,
        `<div style="font-size:13px;font-weight:700;color:${brand.accent};text-transform:uppercase;letter-spacing:.08em">Código de acceso</div>
         <h1 style="margin:10px 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.03em">Tu código de verificación</h1>
         <p style="margin:0;color:#475569;font-size:15px;line-height:1.7">${name}, utiliza este código para continuar en ${escapeHtml(brand.name)}.</p>
         <div style="margin-top:20px;padding:18px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:12px;text-align:center;font-size:30px;font-weight:800;letter-spacing:.18em">${escapeHtml(code)}</div>
         <p style="margin:18px 0 0;color:#94a3b8;font-size:12px;line-height:1.6">Vence en ${expires} minutos. Nunca compartas este código.</p>`,
      ),
    };
  }

  if (template === "transactional-notice" || template === "notification") {
    const title = escapeHtml(text(variables.title, "Tienes una actualización"));
    const message = escapeHtml(text(variables.message, "Hay una nueva actualización disponible.")).replaceAll("\n", "<br>");
    const actionUrl = variables.actionUrl ? requireHttpsUrl(variables.actionUrl, "actionUrl") : null;
    const actionLabel = escapeHtml(text(variables.actionLabel, "Ver detalle"));
    return {
      subject: text(variables.subject, `${brand.name}: ${text(variables.title, "Nueva actualización")}`).slice(0, 160),
      text: `${text(variables.title, "Actualización")}\n\n${text(variables.message)}${actionUrl ? `\n\n${actionUrl}` : ""}`,
      html: shell(
        brand,
        `<div style="font-size:13px;font-weight:700;color:${brand.accent};text-transform:uppercase;letter-spacing:.08em">Notificación</div>
         <h1 style="margin:10px 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.03em">${title}</h1>
         <p style="margin:0;color:#475569;font-size:15px;line-height:1.7">${message}</p>
         ${actionUrl ? button(brand, actionLabel, actionUrl) : ""}`,
      ),
    };
  }

  throw new Error("Unsupported template");
}
