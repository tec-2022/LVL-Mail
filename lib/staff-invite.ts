import type { Principal, StaffRole } from "@/lib/iam";
import { createAuthAdminClient } from "@/lib/supabase/auth-server";

function config() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export async function inviteStaffMemberAtomic(input: {
  email: string;
  role: StaffRole;
  displayName?: string | null;
  invitedBy: Principal;
}) {
  const admin = createAuthAdminClient();
  const current = config();
  if (!admin || !current) throw new Error("Supabase Auth admin is not configured");

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
        all_apps: true,
        invited_by: input.invitedBy.userId,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Could not persist staff membership (${response.status}): ${detail.slice(0, 180)}`);
    }
    const rows = await response.json() as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  } catch (cause) {
    // Compensating action: an Auth identity without an LVL Mail membership has
    // no purpose and would make retrying the invitation harder. Best effort;
    // authorization still fails closed even if this cleanup cannot complete.
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw cause;
  }
}
