export type ReliabilitySnapshot = {
  app_id: string;
  p0_total_24h: number;
  p0_accepted_24h: number;
  p0_delivered_24h: number;
  p0_delivery_rate_24h: number | null;
  p0_accept_p50_ms: number | null;
  p0_accept_p95_ms: number | null;
  p0_accept_p99_ms: number | null;
  p0_delivery_p50_ms: number | null;
  p0_delivery_p95_ms: number | null;
  p0_delivery_p99_ms: number | null;
  provider_attempts_1h: number;
  provider_rejected_1h: number;
  provider_reject_rate_1h: number | null;
  bounced_24h: number;
  bounce_rate_24h: number | null;
  complained_24h: number;
  complaint_rate_24h: number | null;
};

export type FleetReliability = {
  app_id: string;
  app_name: string;
  p0_total_24h: number;
  p0_delivery_rate_24h: number | null;
  p0_accept_p95_ms: number | null;
  p0_delivery_p95_ms: number | null;
  provider_reject_rate_1h: number | null;
  bounce_rate_24h: number | null;
  complaint_rate_24h: number | null;
};

export type MailIncident = {
  id: string;
  app_id: string;
  provider_name: string | null;
  incident_type: string;
  severity: "warning" | "critical";
  status: "open" | "acknowledged" | "resolved";
  title: string;
  summary: string;
  metrics: Record<string, unknown>;
  first_detected_at: string;
  last_detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  updated_at: string;
};

export type IncidentEvent = {
  id: string;
  incident_id: string;
  event_type: "opened" | "severity_changed" | "acknowledged" | "recovered" | "resolved" | "note";
  actor: string;
  details: Record<string, unknown>;
  created_at: string;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Reliability persistence is not configured");
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
    throw new Error(`Reliability operation failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

function normalizeAllowed(appIds?: string[] | null) {
  if (appIds === null || appIds === undefined) return null;
  return [...new Set(appIds.map((value) => value.trim()).filter(Boolean))];
}

function inFilter(appIds: string[]) {
  return encodeURIComponent(`(${appIds.join(",")})`);
}

export function reliabilityConfigured() {
  return Boolean(config());
}

export async function attachProvider(messageId: string, providerName: string) {
  await request("/rest/v1/rpc/mail_set_message_provider", {
    method: "POST",
    body: JSON.stringify({ p_message_id: messageId, p_provider_name: providerName }),
  });
}

export async function evaluateReliability(appId: string) {
  if (!reliabilityConfigured()) return;
  await request("/rest/v1/rpc/mail_evaluate_reliability", {
    method: "POST",
    body: JSON.stringify({ p_app_id: appId }),
  });
}

export async function getReliabilitySnapshot(appId: string): Promise<ReliabilitySnapshot | null> {
  if (!reliabilityConfigured()) return null;
  try {
    const rows = await request<ReliabilitySnapshot[]>("/rest/v1/rpc/mail_reliability_snapshot", {
      method: "POST",
      body: JSON.stringify({ p_app_id: appId }),
    });
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getFleetReliability(appIds: string[] | null = null): Promise<FleetReliability[]> {
  if (!reliabilityConfigured()) return [];
  const allowed = normalizeAllowed(appIds);
  if (allowed && allowed.length === 0) return [];
  try {
    const rows = await request<FleetReliability[]>("/rest/v1/rpc/mail_reliability_fleet", {
      method: "POST",
      body: "{}",
    });
    if (!allowed) return rows;
    const set = new Set(allowed);
    return rows.filter((row) => set.has(row.app_id));
  } catch {
    return [];
  }
}

export async function listIncidents(limit = 100, appIds: string[] | null = null): Promise<MailIncident[]> {
  if (!reliabilityConfigured()) return [];
  const allowed = normalizeAllowed(appIds);
  if (allowed && allowed.length === 0) return [];
  try {
    const scope = allowed ? `&app_id=in.${inFilter(allowed)}` : "";
    return await request<MailIncident[]>(
      `/rest/v1/mail_incidents?select=*&order=last_detected_at.desc&limit=${Math.min(Math.max(limit,1),200)}${scope}`,
    );
  } catch {
    return [];
  }
}

export async function getIncident(incidentId: string): Promise<MailIncident | null> {
  if (!reliabilityConfigured()) return null;
  try {
    const rows = await request<MailIncident[]>(
      `/rest/v1/mail_incidents?id=eq.${encodeURIComponent(incidentId)}&select=*&limit=1`,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function listIncidentEvents(incidentId: string): Promise<IncidentEvent[]> {
  if (!reliabilityConfigured()) return [];
  try {
    return await request<IncidentEvent[]>(
      `/rest/v1/mail_incident_events?incident_id=eq.${encodeURIComponent(incidentId)}&select=*&order=created_at.asc&limit=200`,
    );
  } catch {
    return [];
  }
}

export async function changeIncidentStatus(input: {
  incidentId: string;
  status: "acknowledged" | "resolved";
  actor: string;
}) {
  const rows = await request<MailIncident[]>("/rest/v1/rpc/mail_change_incident_status", {
    method: "POST",
    body: JSON.stringify({
      p_incident_id: input.incidentId,
      p_status: input.status,
      p_actor: input.actor,
    }),
  });
  return rows[0] ?? null;
}
