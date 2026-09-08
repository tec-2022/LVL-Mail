import type { Principal, StaffMember, StaffRole } from "@/lib/iam";
import { createAuthAdminClient } from "@/lib/supabase/auth-server";

function config() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function normalizeScope(role: StaffRole, allApps: boolean, appIds: string[]) {
  if (role === "owner" || role === "admin") return { allApps: true, appIds: [] as string[] };
  const normalized = [...new Set(appIds.map((value) => value.trim()).filter(Boolean))].sort();
  if (!allApps && normalized.length === 0) throw new Error("Selecciona al menos una aplicación");
  return { allApps, appIds: allApps ? [] : normalized };
}

export async function inviteStaffMemberAtomic(input: {
  email: string;
  role: StaffRole;
  displayName?: string | null;
  allApps?: boolean;
  appIds?: string[];
  invitedBy: Principal;
}): Promise<StaffMember | null> {
  const admin = createAuthAdminClient();
  const current = config();
  if (!admin || !current) throw new Error("Supabase Auth admin is not configured");

  const scope = normalizeScope(input.role, input.allApps ?? true, input.appIds ?? []);
  const email = input.email.trim().toLowerCase();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: input.displayName?.trim() || undefined },
  });
  if (error || !data.user?.id) throw new Error(error?.message || "Could not create staff invitation");

  try {
    const response = await fetch(`${current.url}/rest/v1/mail_staff_members`, {
      method: "POST",
      headers: {
        apikey: current.key,
        Authorization: `Bearer ${current.key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        user_id: data.user.id,
        email,
        display_name: input.displayName?.trim() || null,
        role: input.role,
        is_enabled: true,
        all_apps: scope.allApps,
        invited_by: input.invitedBy.userId,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Could not persist staff membership (${response.status}): ${detail.slice(0, 180)}`);
    }
    const rows = await response.json() as Array<Omit<StaffMember, "app_ids">>;

    if (!scope.allApps && scope.appIds.length) {
      const scopeResponse = await fetch(`${current.url}/rest/v1/mail_staff_app_scopes`, {
        method: "POST",
        headers: {
          apikey: current.key,
          Authorization: `Bearer ${current.key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(scope.appIds.map((appId) => ({ user_id: data.user.id, app_id: appId }))),
      });
      if (!scopeResponse.ok) {
        const detail = await scopeResponse.text().catch(() => "");
        throw new Error(`Could not persist staff scope (${scopeResponse.status}): ${detail.slice(0, 180)}`);
      }
    }

    return rows[0] ? { ...rows[0], app_ids: scope.appIds } : null;
  } catch (cause) {
    // Compensating action: deleting the Auth identity cascades membership/scopes.
    // Authorization remains fail-closed even if cleanup itself cannot complete.
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw cause;
  }
}
