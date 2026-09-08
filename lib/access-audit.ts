import { supabaseAdminConfigured } from "@/lib/supabase/auth-server";

export type AccessAuditEntry = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  permission: string;
  app_id: string | null;
  action: string;
  request_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

function config() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export async function listAccessAudit(limit = 80): Promise<AccessAuditEntry[]> {
  const current = config();
  if (!current || !supabaseAdminConfigured()) return [];
  try {
    const response = await fetch(`${current.url}/rest/v1/mail_access_audit?select=id,actor_user_id,actor_email,actor_role,permission,app_id,action,request_id,details,created_at&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 200)}`, {
      headers: {
        apikey: current.key,
        Authorization: `Bearer ${current.key}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return [];
    return await response.json() as AccessAuditEntry[];
  } catch {
    return [];
  }
}
