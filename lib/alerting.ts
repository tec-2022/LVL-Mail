import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { isForbiddenWebhookHostname, isPrivateOrReservedAddress } from "@/lib/security/webhook-target.mjs";

export type AlertChannel = {
  id: string;
  name: string;
  channel_type: "in_app" | "webhook";
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AlertRule = {
  id: string;
  name: string;
  channel_id: string;
  app_id: string | null;
  incident_type: string | null;
  min_severity: "warning" | "critical";
  notify_open: boolean;
  notify_escalation: boolean;
  notify_recovery: boolean;
  cooldown_seconds: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AlertEvent = {
  id: string;
  incident_id: string;
  incident_event_id: string;
  app_id: string;
  event_type: "opened" | "escalated" | "recovered" | "resolved";
  severity: "warning" | "critical";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AlertDelivery = {
  id: string;
  status: "pending" | "processing" | "sent" | "failed" | "suppressed";
  attempts: number;
  next_attempt_at: string;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  mail_alert_channels: { id: string; name: string; channel_type: "in_app" | "webhook" } | null;
  mail_alert_events: { id: string; app_id: string; title: string; severity: "warning" | "critical"; event_type: string } | null;
};

type ClaimedDelivery = {
  delivery_id: string;
  alert_event_id: string;
  channel_id: string;
  channel_type: "in_app" | "webhook";
  endpoint_ciphertext: string | null;
  endpoint_iv: string | null;
  endpoint_auth_tag: string | null;
  secret_ciphertext: string | null;
  secret_iv: string | null;
  secret_auth_tag: string | null;
  attempts: number;
  incident_id: string;
  app_id: string;
  event_type: string;
  severity: "warning" | "critical";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  event_created_at: string;
};

type StoredChannel = AlertChannel & {
  endpoint_ciphertext: string | null;
  endpoint_iv: string | null;
  endpoint_auth_tag: string | null;
  secret_ciphertext: string | null;
  secret_iv: string | null;
  secret_auth_tag: string | null;
};

function serviceConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

function encryptionKey() {
  const encoded = process.env.LVL_MAIL_ALERT_ENCRYPTION_KEY;
  if (!encoded) return null;
  try {
    const key = Buffer.from(encoded, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = serviceConfig();
  if (!current) throw new Error("Alerting persistence is not configured");
  const response = await fetch(`${current.url}${path}`, {
    ...init,
    headers: {
      apikey: current.serviceRoleKey,
      Authorization: `Bearer ${current.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Alerting operation failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

function encodeIn(values: string[]) {
  return encodeURIComponent(`(${values.join(",")})`);
}

function scopedFilter(appIds: string[] | null) {
  if (appIds === null) return "";
  if (appIds.length === 0) return "&app_id=eq.__none__";
  return `&app_id=in.${encodeIn([...new Set(appIds)])}`;
}

function aad(channelId: string, field: "endpoint" | "secret") {
  return Buffer.from(`lvl-mail/alert-channel/${channelId}/${field}`, "utf8");
}

function encryptValue(channelId: string, field: "endpoint" | "secret", value: string) {
  const key = encryptionKey();
  if (!key) throw new Error("LVL_MAIL_ALERT_ENCRYPTION_KEY is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(channelId, field));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(value, "utf8")), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptValue(channelId: string, field: "endpoint" | "secret", input: {
  ciphertext: string | null;
  iv: string | null;
  authTag: string | null;
}) {
  const key = encryptionKey();
  if (!key || !input.ciphertext || !input.iv || !input.authTag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.iv, "base64"));
    decipher.setAAD(aad(channelId, field));
    decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(input.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function publicChannel(row: StoredChannel): AlertChannel {
  return {
    id: row.id,
    name: row.name,
    channel_type: row.channel_type,
    is_enabled: row.is_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function assertPublicWebhookTarget(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  const developmentLocalhost = process.env.NODE_ENV !== "production" && (
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  );
  if (url.protocol !== "https:" && !developmentLocalhost) throw new Error("Webhook URL must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials in webhook URLs are not allowed");
  if (developmentLocalhost) return url;
  if (isForbiddenWebhookHostname(url.hostname)) throw new Error("Webhook target is not a public host");

  let addresses: Awaited<ReturnType<typeof lookup>>[] | Awaited<ReturnType<typeof lookup>>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Webhook hostname could not be resolved");
  }
  const resolved = Array.isArray(addresses) ? addresses : [addresses];
  if (!resolved.length || resolved.some((entry) => isPrivateOrReservedAddress(entry.address))) {
    throw new Error("Webhook target resolved to a private or reserved network");
  }
  return url;
}

export function alertingConfigured() {
  return Boolean(serviceConfig());
}

export function alertEncryptionConfigured() {
  return Boolean(encryptionKey());
}

export async function listAlertEvents(limit = 100, appIds: string[] | null = null): Promise<AlertEvent[]> {
  if (!serviceConfig()) return [];
  try {
    return await request<AlertEvent[]>(
      `/rest/v1/mail_alert_events?select=*&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 200)}${scopedFilter(appIds)}`,
    );
  } catch {
    return [];
  }
}

export async function listAlertChannels(): Promise<AlertChannel[]> {
  if (!serviceConfig()) return [];
  try {
    const rows = await request<StoredChannel[]>(
      "/rest/v1/mail_alert_channels?select=*&order=created_at.asc",
    );
    return rows.map(publicChannel);
  } catch {
    return [];
  }
}

export async function listAlertRules(): Promise<AlertRule[]> {
  if (!serviceConfig()) return [];
  try {
    return await request<AlertRule[]>(
      "/rest/v1/mail_alert_rules?select=*&order=created_at.asc",
    );
  } catch {
    return [];
  }
}

export async function listAlertDeliveries(limit = 100): Promise<AlertDelivery[]> {
  if (!serviceConfig()) return [];
  try {
    return await request<AlertDelivery[]>(
      `/rest/v1/mail_alert_deliveries?select=id,status,attempts,next_attempt_at,sent_at,last_error,created_at,mail_alert_channels(id,name,channel_type),mail_alert_events(id,app_id,title,severity,event_type)&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 200)}`,
    );
  } catch {
    return [];
  }
}

export async function createWebhookChannel(input: { name: string; endpoint: string }) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Invalid channel name");
  const url = await assertPublicWebhookTarget(input.endpoint.trim());

  const id = randomUUID();
  const signingSecret = randomBytes(32).toString("base64url");
  const endpoint = encryptValue(id, "endpoint", url.toString());
  const secret = encryptValue(id, "secret", signingSecret);

  const rows = await request<StoredChannel[]>("/rest/v1/mail_alert_channels", {
    method: "POST",
    body: JSON.stringify({
      id,
      name,
      channel_type: "webhook",
      is_enabled: true,
      endpoint_ciphertext: endpoint.ciphertext,
      endpoint_iv: endpoint.iv,
      endpoint_auth_tag: endpoint.authTag,
      secret_ciphertext: secret.ciphertext,
      secret_iv: secret.iv,
      secret_auth_tag: secret.authTag,
    }),
  });
  const row = rows[0];
  if (!row) throw new Error("Could not create webhook channel");
  return { channel: publicChannel(row), signingSecret };
}

export async function setAlertChannelEnabled(channelId: string, enabled: boolean) {
  const rows = await request<StoredChannel[]>(
    `/rest/v1/mail_alert_channels?id=eq.${encodeURIComponent(channelId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ is_enabled: enabled, updated_at: new Date().toISOString() }),
    },
  );
  return rows[0] ? publicChannel(rows[0]) : null;
}

export async function createAlertRule(input: {
  name: string;
  channelId: string;
  appId?: string | null;
  incidentType?: string | null;
  minSeverity: "warning" | "critical";
  notifyOpen: boolean;
  notifyEscalation: boolean;
  notifyRecovery: boolean;
  cooldownSeconds: number;
}) {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("Invalid rule name");
  if (!input.notifyOpen && !input.notifyEscalation && !input.notifyRecovery) {
    throw new Error("Rule must notify at least one incident transition");
  }
  const cooldown = Math.min(Math.max(Math.trunc(input.cooldownSeconds), 0), 86400);
  const rows = await request<AlertRule[]>("/rest/v1/mail_alert_rules", {
    method: "POST",
    body: JSON.stringify({
      name,
      channel_id: input.channelId,
      app_id: input.appId || null,
      incident_type: input.incidentType?.trim() || null,
      min_severity: input.minSeverity,
      notify_open: input.notifyOpen,
      notify_escalation: input.notifyEscalation,
      notify_recovery: input.notifyRecovery,
      cooldown_seconds: cooldown,
      is_enabled: true,
    }),
  });
  if (!rows[0]) throw new Error("Could not create alert rule");
  return rows[0];
}

export async function setAlertRuleEnabled(ruleId: string, enabled: boolean) {
  const rows = await request<AlertRule[]>(
    `/rest/v1/mail_alert_rules?id=eq.${encodeURIComponent(ruleId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ is_enabled: enabled, updated_at: new Date().toISOString() }),
    },
  );
  return rows[0] ?? null;
}

async function finishDelivery(deliveryId: string, success: boolean, error?: string) {
  await request("/rest/v1/rpc/mail_finish_alert_delivery", {
    method: "POST",
    body: JSON.stringify({
      p_delivery_id: deliveryId,
      p_success: success,
      p_error: error?.slice(0, 500) || null,
    }),
  });
}

function webhookBody(row: ClaimedDelivery) {
  return JSON.stringify({
    version: 1,
    id: row.alert_event_id,
    incidentId: row.incident_id,
    appId: row.app_id,
    event: row.event_type,
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    occurredAt: row.event_created_at,
    payload: row.payload,
  });
}

async function deliverClaim(row: ClaimedDelivery) {
  if (row.channel_type === "in_app") {
    await finishDelivery(row.delivery_id, true);
    return { ok: true as const, id: row.delivery_id, channel: "in_app" };
  }

  const endpoint = decryptValue(row.channel_id, "endpoint", {
    ciphertext: row.endpoint_ciphertext,
    iv: row.endpoint_iv,
    authTag: row.endpoint_auth_tag,
  });
  const secret = decryptValue(row.channel_id, "secret", {
    ciphertext: row.secret_ciphertext,
    iv: row.secret_iv,
    authTag: row.secret_auth_tag,
  });
  if (!endpoint || !secret) {
    await finishDelivery(row.delivery_id, false, "channel_decryption_failed");
    return { ok: false as const, id: row.delivery_id, error: "channel_decryption_failed" };
  }

  try {
    await assertPublicWebhookTarget(endpoint);
  } catch (cause) {
    const error = cause instanceof Error ? `unsafe_target:${cause.message}` : "unsafe_target";
    await finishDelivery(row.delivery_id, false, error);
    return { ok: false as const, id: row.delivery_id, error };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = webhookBody(row);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "LVL-Mail-Alerts/1.0",
        "X-LVL-Mail-Alert-Id": row.alert_event_id,
        "X-LVL-Mail-Timestamp": timestamp,
        "X-LVL-Mail-Signature": `sha256=${signature}`,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) {
      const error = `webhook_http_${response.status}`;
      await finishDelivery(row.delivery_id, false, error);
      return { ok: false as const, id: row.delivery_id, error };
    }
    await finishDelivery(row.delivery_id, true);
    return { ok: true as const, id: row.delivery_id, channel: "webhook" };
  } catch (cause) {
    const error = cause instanceof Error ? cause.name : "webhook_transport_failed";
    await finishDelivery(row.delivery_id, false, error);
    return { ok: false as const, id: row.delivery_id, error };
  }
}

export async function dispatchPendingAlerts(limit = 25) {
  if (!serviceConfig()) return { claimed: 0, sent: 0, failed: 0 };
  const rows = await request<ClaimedDelivery[]>("/rest/v1/rpc/mail_claim_alert_deliveries", {
    method: "POST",
    body: JSON.stringify({ p_limit: Math.min(Math.max(limit, 1), 100) }),
  });
  const results = await Promise.all((rows ?? []).map(deliverClaim));
  return {
    claimed: results.length,
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  };
}

export function validDispatchSecret(authorization: string | null) {
  const expected = process.env.LVL_MAIL_ALERT_DISPATCH_SECRET;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const provided = authorization.slice(7);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
