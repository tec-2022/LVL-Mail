import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseConfigured } from "@/lib/supabase-rest";

export type AppMode = "live" | "test" | "paused";
export type CircuitState = "closed" | "open" | "half_open";

export type AppPolicy = {
  app_id: string;
  mode: AppMode;
  minute_limit: number;
  daily_limit: number;
  p0_reserved_per_minute: number;
  max_consecutive_failures: number;
  circuit_state: CircuitState;
  failure_streak: number;
  circuit_opened_at: string | null;
  enabled_templates: string[];
  test_recipient_domains: string[];
  updated_at: string | null;
};

export type AppKeySummary = {
  id: string;
  app_id: string;
  key_prefix: string;
  label: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AppTemplateSetting = {
  app_id: string;
  template_key: string;
  enabled: boolean;
  locale: string;
  reply_to: string | null;
  updated_at: string;
};

export type AuditEntry = {
  id: string;
  app_id: string | null;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type BudgetDecision = {
  allowed: boolean;
  reason: string | null;
  mode: AppMode;
  circuit_state: CircuitState;
  minute_used: number;
  minute_limit: number;
  day_used: number;
  daily_limit: number;
};

const defaultTemplates = [
  "verify-email",
  "password-reset",
  "otp",
  "transactional-notice",
  "notification",
];

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Control plane persistence is not configured");
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
    throw new Error(`Control plane persistence failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

function defaultPolicy(appId: string): AppPolicy {
  return {
    app_id: appId,
    mode: "live",
    minute_limit: 60,
    daily_limit: 3000,
    p0_reserved_per_minute: 20,
    max_consecutive_failures: 5,
    circuit_state: "closed",
    failure_streak: 0,
    circuit_opened_at: null,
    enabled_templates: defaultTemplates,
    test_recipient_domains: ["resend.dev"],
    updated_at: null,
  };
}

export function controlPlaneConfigured() {
  return supabaseConfigured();
}

export async function getAppPolicy(appId: string): Promise<AppPolicy> {
  if (!controlPlaneConfigured()) return defaultPolicy(appId);
  try {
    const rows = await request<AppPolicy[]>(
      `/rest/v1/mail_app_policies?app_id=eq.${encodeURIComponent(appId)}&select=*&limit=1`,
    );
    return rows[0] ?? defaultPolicy(appId);
  } catch {
    return defaultPolicy(appId);
  }
}

export async function listAppKeys(appId: string): Promise<AppKeySummary[]> {
  if (!controlPlaneConfigured()) return [];
  try {
    return await request<AppKeySummary[]>(
      `/rest/v1/mail_app_keys?app_id=eq.${encodeURIComponent(appId)}&select=id,app_id,key_prefix,label,last_used_at,expires_at,revoked_at,created_at&order=created_at.desc`,
    );
  } catch {
    return [];
  }
}

export async function listTemplateSettings(appId: string): Promise<AppTemplateSetting[]> {
  if (!controlPlaneConfigured()) return defaultTemplates.map((template_key) => ({
    app_id: appId,
    template_key,
    enabled: true,
    locale: "es-MX",
    reply_to: null,
    updated_at: new Date(0).toISOString(),
  }));
  try {
    const rows = await request<AppTemplateSetting[]>(
      `/rest/v1/mail_app_template_settings?app_id=eq.${encodeURIComponent(appId)}&select=*&order=template_key.asc`,
    );
    if (rows.length > 0) return rows;
  } catch {
    // Return safe defaults while schema is being prepared.
  }
  return defaultTemplates.map((template_key) => ({
    app_id: appId,
    template_key,
    enabled: true,
    locale: "es-MX",
    reply_to: null,
    updated_at: new Date(0).toISOString(),
  }));
}

export async function listAuditEntries(appId: string, limit = 40): Promise<AuditEntry[]> {
  if (!controlPlaneConfigured()) return [];
  try {
    return await request<AuditEntry[]>(
      `/rest/v1/mail_audit_log?app_id=eq.${encodeURIComponent(appId)}&select=id,app_id,action,actor,details,created_at&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 100)}`,
    );
  } catch {
    return [];
  }
}

export async function updateAppPolicy(appId: string, input: Partial<Pick<AppPolicy,
  "mode" | "minute_limit" | "daily_limit" | "p0_reserved_per_minute" | "max_consecutive_failures" | "enabled_templates" | "test_recipient_domains"
>>) {
  const current = await getAppPolicy(appId);
  const next = {
    app_id: appId,
    mode: input.mode ?? current.mode,
    minute_limit: Math.min(Math.max(Number(input.minute_limit ?? current.minute_limit), 1), 10000),
    daily_limit: Math.min(Math.max(Number(input.daily_limit ?? current.daily_limit), 1), 10_000_000),
    p0_reserved_per_minute: Math.min(Math.max(Number(input.p0_reserved_per_minute ?? current.p0_reserved_per_minute), 0), 10000),
    max_consecutive_failures: Math.min(Math.max(Number(input.max_consecutive_failures ?? current.max_consecutive_failures), 1), 100),
    enabled_templates: input.enabled_templates ?? current.enabled_templates,
    test_recipient_domains: (input.test_recipient_domains ?? current.test_recipient_domains).map((value) => value.trim().toLowerCase()).filter(Boolean).slice(0, 30),
    updated_at: new Date().toISOString(),
  };
  await request("/rest/v1/mail_app_policies?on_conflict=app_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(next),
  });
  return next;
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function rotateAppKey(appId: string, label = "Production") {
  const token = randomBytes(24).toString("hex");
  const keyPrefix = `lvlm_${token.slice(0, 10)}`;
  const apiKey = `${keyPrefix}_${token.slice(10)}`;
  await request("/rest/v1/mail_app_keys", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      app_id: appId,
      key_prefix: keyPrefix,
      secret_hash: hashSecret(apiKey),
      label: label.trim().slice(0, 60) || "Production",
    }),
  });
  return { apiKey, keyPrefix };
}

export async function revokeAppKey(appId: string, keyId: string) {
  await request(`/rest/v1/mail_app_keys?id=eq.${encodeURIComponent(keyId)}&app_id=eq.${encodeURIComponent(appId)}&revoked_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
}

export async function updateTemplateSetting(appId: string, templateKey: string, input: { enabled?: boolean; locale?: string; replyTo?: string | null }) {
  const payload = {
    app_id: appId,
    template_key: templateKey,
    enabled: input.enabled ?? true,
    locale: (input.locale ?? "es-MX").slice(0, 16),
    reply_to: input.replyTo?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  await request("/rest/v1/mail_app_template_settings?on_conflict=app_id,template_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
  return payload;
}

export async function appendAudit(input: { appId: string | null; action: string; actor: string; details?: Record<string, unknown> }) {
  if (!controlPlaneConfigured()) return;
  await request("/rest/v1/mail_audit_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      app_id: input.appId,
      action: input.action.slice(0, 120),
      actor: input.actor.slice(0, 120),
      details: input.details ?? {},
    }),
  });
}

export async function reserveSendBudget(input: { appId: string; priority: string; trackingId: string; recipientDomain: string }): Promise<BudgetDecision> {
  if (!controlPlaneConfigured()) {
    return { allowed: true, reason: null, mode: "live", circuit_state: "closed", minute_used: 0, minute_limit: 60, day_used: 0, daily_limit: 3000 };
  }
  try {
    const rows = await request<BudgetDecision[]>("/rest/v1/rpc/mail_reserve_send_budget", {
      method: "POST",
      body: JSON.stringify({
        p_app_id: input.appId,
        p_priority: input.priority,
        p_tracking_id: input.trackingId,
        p_recipient_domain: input.recipientDomain.toLowerCase(),
      }),
    });
    return rows[0] ?? { allowed: false, reason: "policy_unavailable", mode: "paused", circuit_state: "open", minute_used: 0, minute_limit: 0, day_used: 0, daily_limit: 0 };
  } catch {
    return { allowed: false, reason: "policy_unavailable", mode: "paused", circuit_state: "open", minute_used: 0, minute_limit: 0, day_used: 0, daily_limit: 0 };
  }
}

export async function recordProviderOutcome(appId: string, success: boolean) {
  if (!controlPlaneConfigured()) return;
  try {
    await request("/rest/v1/rpc/mail_record_provider_outcome", {
      method: "POST",
      body: JSON.stringify({ p_app_id: appId, p_success: success }),
    });
  } catch {
    // Delivery tracking remains authoritative even if breaker bookkeeping fails.
  }
}

export function safeSecretEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
