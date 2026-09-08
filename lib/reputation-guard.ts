import { supabaseConfigured } from "@/lib/supabase-rest";

export type ReputationState = {
  app_id: string;
  reputation_state: "healthy" | "watch" | "restricted";
  reputation_reason: string | null;
  reputation_updated_at: string | null;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Reputation persistence is not configured");
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
  if (!response.ok) throw new Error(`Reputation request failed (${response.status})`);
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

export async function getReputationState(appId: string): Promise<ReputationState> {
  if (!supabaseConfigured()) return {
    app_id: appId,
    reputation_state: "healthy",
    reputation_reason: null,
    reputation_updated_at: null,
  };
  try {
    const rows = await request<ReputationState[]>(
      `/rest/v1/mail_app_policies?app_id=eq.${encodeURIComponent(appId)}&select=app_id,reputation_state,reputation_reason,reputation_updated_at&limit=1`,
    );
    return rows[0] ?? {
      app_id: appId,
      reputation_state: "healthy",
      reputation_reason: null,
      reputation_updated_at: null,
    };
  } catch {
    return {
      app_id: appId,
      reputation_state: "healthy",
      reputation_reason: null,
      reputation_updated_at: null,
    };
  }
}

export async function evaluateReputation(appId: string) {
  if (!supabaseConfigured()) return null;
  try {
    const rows = await request<ReputationState[]>("/rest/v1/rpc/mail_evaluate_reputation", {
      method: "POST",
      body: JSON.stringify({ p_app_id: appId }),
    });
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function reputationAllows(appId: string, priority: string) {
  const state = await getReputationState(appId);
  if (state.reputation_state !== "restricted") return { allowed: true, state };
  return { allowed: priority === "P0", state };
}
