import { createHash } from "node:crypto";

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

export function supabaseConfigured() {
  return Boolean(config());
}

async function supabaseRequest<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Supabase is not configured");

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
    throw new Error(`Supabase request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return null as T;
  }

  return await response.json() as T;
}

export function recipientHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function isRecipientSuppressed(email: string) {
  if (!supabaseConfigured()) return false;
  const hash = recipientHash(email);
  const rows = await supabaseRequest<Array<{ id: string }>>(
    `/rest/v1/mail_suppressions?recipient_hash=eq.${encodeURIComponent(hash)}&select=id&limit=1`,
  );
  return rows.length > 0;
}

export async function recordAcceptedMessage(input: {
  providerId: string;
  appId: string;
  templateKey: string;
  priority: string;
  recipient: string;
  idempotencyKey: string;
}) {
  if (!supabaseConfigured()) return;
  await supabaseRequest(
    "/rest/v1/mail_messages?on_conflict=app_id,idempotency_key",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        provider_id: input.providerId,
        app_id: input.appId,
        template_key: input.templateKey,
        priority: input.priority,
        recipient_hash: recipientHash(input.recipient),
        idempotency_key: input.idempotencyKey,
        status: "accepted",
      }),
    },
  );
}

async function findMessageId(providerEmailId: string) {
  const rows = await supabaseRequest<Array<{ id: string }>>(
    `/rest/v1/mail_messages?provider_id=eq.${encodeURIComponent(providerEmailId)}&select=id&limit=1`,
  );
  return rows[0]?.id ?? null;
}

export async function recordWebhookEvent(input: {
  eventId: string;
  providerEmailId?: string | null;
  eventType: string;
  payload: unknown;
  occurredAt?: string | null;
}) {
  if (!supabaseConfigured()) return;
  const messageId = input.providerEmailId ? await findMessageId(input.providerEmailId) : null;
  await supabaseRequest(
    "/rest/v1/mail_events?on_conflict=provider_event_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        provider_event_id: input.eventId,
        provider_email_id: input.providerEmailId ?? null,
        message_id: messageId,
        event_type: input.eventType,
        payload: input.payload,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
      }),
    },
  );
}

export async function upsertSuppression(input: {
  email: string;
  reason: string;
  source: string;
}) {
  if (!supabaseConfigured()) return;
  await supabaseRequest(
    "/rest/v1/mail_suppressions?on_conflict=recipient_hash",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        recipient_hash: recipientHash(input.email),
        reason: input.reason,
        source: input.source,
      }),
    },
  );
}

export type DashboardMetrics = {
  accepted: number;
  delivered: number;
  bounced: number;
  complained: number;
  suppressed: number;
};

export async function getDashboardMetrics(): Promise<DashboardMetrics | null> {
  if (!supabaseConfigured()) return null;
  try {
    const rows = await supabaseRequest<DashboardMetrics[]>(
      "/rest/v1/rpc/mail_dashboard_metrics",
      { method: "POST", body: "{}" },
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export type RecentMailEvent = {
  provider_event_id: string;
  event_type: string;
  occurred_at: string;
  provider_email_id: string | null;
  mail_messages: { app_id: string; template_key: string } | null;
};

export async function getRecentEvents(limit = 30): Promise<RecentMailEvent[]> {
  if (!supabaseConfigured()) return [];
  try {
    return await supabaseRequest<RecentMailEvent[]>(
      `/rest/v1/mail_events?select=provider_event_id,event_type,occurred_at,provider_email_id,mail_messages(app_id,template_key)&order=occurred_at.desc&limit=${Math.min(Math.max(limit, 1), 100)}`,
    );
  } catch {
    return [];
  }
}

export type AppHealth = {
  app_id: string;
  accepted: number;
  delivered: number;
  bounced: number;
  complained: number;
  bounce_rate: number;
  complaint_rate: number;
};

export async function getAppHealth(): Promise<AppHealth[]> {
  if (!supabaseConfigured()) return [];
  try {
    return await supabaseRequest<AppHealth[]>(
      "/rest/v1/rpc/mail_app_health",
      { method: "POST", body: "{}" },
    );
  } catch {
    return [];
  }
}
