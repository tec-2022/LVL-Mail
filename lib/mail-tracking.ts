import { supabaseConfigured, recipientHash } from "@/lib/supabase-rest";

export type TrackingStatus =
  | "processing"
  | "blocked"
  | "provider_rejected"
  | "accepted"
  | "sent"
  | "delayed"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "suppressed";

export type TrackedMessage = {
  id: string;
  provider_id: string | null;
  provider_name: string | null;
  app_id: string;
  template_key: string;
  template_source: "base" | "published" | "studio_test";
  template_version: number | null;
  priority: string;
  recipient_hash: string;
  idempotency_key: string;
  status: TrackingStatus;
  failure_code: string | null;
  replay_of_message_id: string | null;
  created_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
  last_event_at: string | null;
  updated_at: string;
};

export type TrackedEvent = {
  provider_event_id: string;
  provider_email_id: string | null;
  app_id: string | null;
  message_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
};

export type AppTrackingSummary = {
  app_id: string;
  total_30d: number;
  accepted_30d: number;
  delivered_30d: number;
  blocked_30d: number;
  failed_30d: number;
  bounced_30d: number;
  complained_30d: number;
  p0_24h: number;
  delivery_rate_30d: number | null;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Tracking persistence is not configured");

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
    throw new Error(`Tracking persistence failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

export function trackingConfigured() {
  return supabaseConfigured();
}

export async function beginTrackedMessage(input: {
  trackingId: string;
  appId: string;
  templateKey: string;
  priority: string;
  recipient: string;
  idempotencyKey: string;
}) {
  const rows = await request<TrackedMessage[]>("/rest/v1/rpc/mail_begin_tracked_message", {
    method: "POST",
    body: JSON.stringify({
      p_id: input.trackingId,
      p_app_id: input.appId,
      p_template_key: input.templateKey,
      p_priority: input.priority,
      p_recipient_hash: recipientHash(input.recipient),
      p_idempotency_key: input.idempotencyKey,
    }),
  });
  const message = rows[0];
  if (!message) throw new Error("Tracking record was not created");
  return message;
}

export async function setTrackedMessageResult(input: {
  trackingId: string;
  providerId?: string | null;
  status: TrackingStatus;
  failureCode?: string | null;
}) {
  const rows = await request<TrackedMessage[]>("/rest/v1/rpc/mail_set_message_result", {
    method: "POST",
    body: JSON.stringify({
      p_message_id: input.trackingId,
      p_provider_id: input.providerId ?? null,
      p_status: input.status,
      p_failure_code: input.failureCode ?? null,
    }),
  });
  return rows[0] ?? null;
}

export async function recordTrackedEvent(input: {
  eventId: string;
  providerEmailId?: string | null;
  trackingId?: string | null;
  eventType: string;
  payload: unknown;
  occurredAt?: string | null;
}) {
  const rows = await request<Array<{ message_id: string; app_id: string }>>(
    "/rest/v1/rpc/mail_record_tracked_event",
    {
      method: "POST",
      body: JSON.stringify({
        p_event_id: input.eventId,
        p_provider_email_id: input.providerEmailId ?? null,
        p_tracking_id: input.trackingId ?? null,
        p_event_type: input.eventType,
        p_payload: input.payload,
        p_occurred_at: input.occurredAt ?? new Date().toISOString(),
      }),
    },
  );
  return rows[0] ?? null;
}

const messageSelect = "id,provider_id,provider_name,app_id,template_key,template_source,template_version,priority,recipient_hash,idempotency_key,status,failure_code,replay_of_message_id,created_at,accepted_at,delivered_at,last_event_at,updated_at";

export async function getRecentTrackedMessages(limit = 80): Promise<TrackedMessage[]> {
  if (!trackingConfigured()) return [];
  try {
    return await request<TrackedMessage[]>(
      `/rest/v1/mail_messages?select=${messageSelect}&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 200)}`,
    );
  } catch {
    return [];
  }
}

export async function getAppTrackedMessages(appId: string, limit = 100): Promise<TrackedMessage[]> {
  if (!trackingConfigured()) return [];
  try {
    return await request<TrackedMessage[]>(
      `/rest/v1/mail_messages?app_id=eq.${encodeURIComponent(appId)}&select=${messageSelect}&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 200)}`,
    );
  } catch {
    return [];
  }
}

export async function getTrackedMessage(messageId: string): Promise<TrackedMessage | null> {
  if (!trackingConfigured()) return null;
  try {
    const rows = await request<TrackedMessage[]>(
      `/rest/v1/mail_messages?id=eq.${encodeURIComponent(messageId)}&select=${messageSelect}&limit=1`,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getTrackedMessageEvents(messageId: string): Promise<TrackedEvent[]> {
  if (!trackingConfigured()) return [];
  try {
    return await request<TrackedEvent[]>(
      `/rest/v1/mail_events?message_id=eq.${encodeURIComponent(messageId)}&select=provider_event_id,provider_email_id,app_id,message_id,event_type,payload,occurred_at&order=occurred_at.asc&limit=100`,
    );
  } catch {
    return [];
  }
}

export async function getAppTrackingSummary(appId: string): Promise<AppTrackingSummary | null> {
  if (!trackingConfigured()) return null;
  try {
    const rows = await request<AppTrackingSummary[]>("/rest/v1/rpc/mail_app_tracking_summary", {
      method: "POST",
      body: JSON.stringify({ p_app_id: appId }),
    });
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
