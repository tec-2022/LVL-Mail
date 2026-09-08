import { timingSafeEqual } from "node:crypto";

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

export function maintenanceConfigured() {
  return Boolean(config() && process.env.LVL_MAIL_MAINTENANCE_SECRET);
}

export function validMaintenanceSecret(authorization: string | null) {
  const expected = process.env.LVL_MAIL_MAINTENANCE_SECRET;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const provided = authorization.slice(7);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function runRetentionPurge(): Promise<Record<string, number>> {
  const current = config();
  if (!current) throw new Error("Retention persistence is not configured");
  const response = await fetch(`${current.url}/rest/v1/rpc/mail_purge_retention`, {
    method: "POST",
    headers: {
      apikey: current.serviceRoleKey,
      Authorization: `Bearer ${current.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Retention purge failed (${response.status})`);
  const result = await response.json() as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  return Object.fromEntries(
    Object.entries(result as Record<string, unknown>)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)]),
  );
}
