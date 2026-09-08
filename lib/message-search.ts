import { recipientHash, supabaseConfigured } from "@/lib/supabase-rest";
import type { TrackedMessage } from "@/lib/mail-tracking";

export type MessageSearchFilters = {
  query?: string;
  appId?: string;
  templateKey?: string;
  templateVersion?: number | null;
  status?: string;
  providerName?: string;
  recipient?: string;
  from?: string;
  to?: string;
  limit?: number;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Message search persistence is not configured");
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
    throw new Error(`Message search failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

function normalizedDate(value?: string, endOfDay = false) {
  if (!value) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}${suffix}` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function searchMessages(filters: MessageSearchFilters): Promise<TrackedMessage[]> {
  if (!supabaseConfigured()) return [];
  try {
    const version = Number(filters.templateVersion);
    const rows = await request<TrackedMessage[]>("/rest/v1/rpc/mail_search_messages", {
      method: "POST",
      body: JSON.stringify({
        p_query: filters.query?.trim() || null,
        p_app_id: filters.appId?.trim() || null,
        p_template_key: filters.templateKey?.trim() || null,
        p_template_version: Number.isInteger(version) && version > 0 ? version : null,
        p_status: filters.status?.trim() || null,
        p_provider_name: filters.providerName?.trim() || null,
        p_recipient_hash: filters.recipient?.trim() ? recipientHash(filters.recipient) : null,
        p_from: normalizedDate(filters.from),
        p_to: normalizedDate(filters.to, true),
        p_limit: Math.min(Math.max(filters.limit ?? 100, 1), 200),
      }),
    });
    return rows ?? [];
  } catch {
    return [];
  }
}
