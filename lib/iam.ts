import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { createAuthAdminClient, createAuthServerClient, supabaseAdminConfigured, supabaseAuthConfigured } from "@/lib/supabase/auth-server";

export type StaffRole = "owner" | "admin" | "operator" | "viewer";
export type Permission =
  | "platform.read"
  | "apps.read"
  | "apps.manage"
  | "templates.read"
  | "templates.edit"
  | "templates.publish"
  | "templates.test_send"
  | "keys.read"
  | "keys.rotate"
  | "incidents.read"
  | "incidents.manage"
  | "messages.read"
  | "messages.search"
  | "messages.replay"
  | "reputation.read"
  | "audit.read"
  | "team.read"
  | "team.manage"
  | "security.manage";

const rolePermissions: Record<StaffRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "platform.read", "apps.read", "apps.manage", "templates.read", "templates.edit",
    "templates.publish", "templates.test_send", "keys.read", "keys.rotate",
    "incidents.read", "incidents.manage", "messages.read", "messages.search",
    "messages.replay", "reputation.read", "audit.read", "team.read", "team.manage",
    "security.manage",
  ]),
  admin: new Set<Permission>([
    "platform.read", "apps.read", "apps.manage", "templates.read", "templates.edit",
    "templates.publish", "templates.test_send", "keys.read", "keys.rotate",
    "incidents.read", "incidents.manage", "messages.read", "messages.search",
    "messages.replay", "reputation.read", "audit.read", "team.read",
  ]),
  operator: new Set<Permission>([
    "platform.read", "apps.read", "templates.read", "templates.test_send",
    "incidents.read", "incidents.manage", "messages.read", "messages.search",
    "messages.replay", "reputation.read",
  ]),
  viewer: new Set<Permission>([
    "platform.read", "apps.read", "templates.read", "incidents.read",
    "messages.read", "messages.search", "reputation.read",
  ]),
};

export type StaffContext = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: StaffRole;
  is_enabled: boolean;
  all_apps: boolean;
  app_ids: string[];
  created_at: string;
  last_seen_at: string | null;
};

export type Principal = {
  kind: "staff" | "break_glass" | "development";
  userId: string | null;
  email: string;
  displayName: string;
  role: StaffRole;
  allApps: boolean;
  appIds: string[];
};

type StoredStaff = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: StaffRole;
  is_enabled: boolean;
  all_apps: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

function serviceConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function serviceRequest<T>(path: string, init: RequestInit = {}) {
  const current = serviceConfig();
  if (!current) throw new Error("IAM persistence is not configured");
  const response = await fetch(`${current.url}${path}`, {
    ...init,
    headers: {
      apikey: current.key,
      Authorization: `Bearer ${current.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`IAM request failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function breakGlassEnabled() {
  return process.env.LVL_MAIL_BREAK_GLASS_ENABLED !== "false" && Boolean(
    process.env.LVL_MAIL_ADMIN_USER && process.env.LVL_MAIL_ADMIN_PASSWORD,
  );
}

function breakGlassFromAuthorization(authorization: string | null): Principal | null {
  if (!breakGlassEnabled() || !authorization?.startsWith("Basic ")) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const expectedUser = process.env.LVL_MAIL_ADMIN_USER ?? "";
  const expectedPassword = process.env.LVL_MAIL_ADMIN_PASSWORD ?? "";
  if (!safeEqual(user, expectedUser) || !safeEqual(password, expectedPassword)) return null;
  return {
    kind: "break_glass",
    userId: null,
    email: user,
    displayName: "Break-glass administrator",
    role: "owner",
    allApps: true,
    appIds: [],
  };
}

export function iamConfigured() {
  return supabaseAuthConfigured() && supabaseAdminConfigured();
}

export function hasPermission(role: StaffRole, permission: Permission) {
  return rolePermissions[role].has(permission);
}

export function rolePermissionList(role: StaffRole) {
  return [...rolePermissions[role]];
}

export async function getStaffContext(userId: string): Promise<StaffContext | null> {
  if (!serviceConfig()) return null;
  try {
    const rows = await serviceRequest<StaffContext[]>("/rest/v1/rpc/mail_staff_context", {
      method: "POST",
      body: JSON.stringify({ p_user_id: userId }),
    });
    const member = rows[0];
    return member?.is_enabled ? member : null;
  } catch {
    return null;
  }
}

async function staffPrincipalFromSession(): Promise<Principal | null> {
  if (!iamConfigured()) return null;
  const supabase = await createAuthServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const member = await getStaffContext(String(data.claims.sub));
  if (!member) return null;
  void serviceRequest("/rest/v1/rpc/mail_touch_staff", {
    method: "POST",
    body: JSON.stringify({ p_user_id: member.user_id }),
  }).catch(() => undefined);
  return {
    kind: "staff",
    userId: member.user_id,
    email: member.email,
    displayName: member.display_name || member.email,
    role: member.role,
    allApps: member.all_apps,
    appIds: member.app_ids ?? [],
  };
}

export async function getPagePrincipal(): Promise<Principal | null> {
  const staff = await staffPrincipalFromSession();
  if (staff) return staff;
  const headerStore = await headers();
  const breakGlass = breakGlassFromAuthorization(headerStore.get("authorization"));
  if (breakGlass) return breakGlass;
  if (!iamConfigured() && !breakGlassEnabled() && process.env.NODE_ENV !== "production") {
    return {
      kind: "development",
      userId: null,
      email: "dev@localhost",
      displayName: "Development owner",
      role: "owner",
      allApps: true,
      appIds: [],
    };
  }
  return null;
}

export async function authorizeAdminRequest(
  request: NextRequest,
  permission: Permission,
  appId?: string | null,
): Promise<Principal | null> {
  const staff = await staffPrincipalFromSession();
  const principal = staff ?? breakGlassFromAuthorization(request.headers.get("authorization")) ?? (
    !iamConfigured() && !breakGlassEnabled() && process.env.NODE_ENV !== "production"
      ? {
          kind: "development" as const,
          userId: null,
          email: "dev@localhost",
          displayName: "Development owner",
          role: "owner" as const,
          allApps: true,
          appIds: [],
        }
      : null
  );
  if (!principal || !hasPermission(principal.role, permission)) return null;
  if (appId && !principal.allApps && !principal.appIds.includes(appId)) return null;
  return principal;
}

export async function appendAccessAudit(input: {
  principal: Principal;
  permission: Permission;
  action: string;
  appId?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}) {
  if (!serviceConfig()) return;
  await serviceRequest("/rest/v1/mail_access_audit", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      actor_user_id: input.principal.userId,
      actor_email: input.principal.email,
      actor_role: input.principal.role,
      permission: input.permission,
      app_id: input.appId ?? null,
      action: input.action.slice(0, 120),
      request_id: input.requestId ?? null,
      details: input.details ?? {},
    }),
  });
}

export async function listStaffMembers(): Promise<StoredStaff[]> {
  if (!serviceConfig()) return [];
  try {
    return await serviceRequest<StoredStaff[]>(
      "/rest/v1/mail_staff_members?select=user_id,email,display_name,role,is_enabled,all_apps,created_at,updated_at,last_seen_at&order=created_at.asc",
    );
  } catch {
    return [];
  }
}

export async function activeOwnerCount() {
  if (!serviceConfig()) return 0;
  const result = await serviceRequest<number>("/rest/v1/rpc/mail_active_owner_count", {
    method: "POST",
    body: "{}",
  });
  return Number(result ?? 0);
}

export async function inviteStaffMember(input: {
  email: string;
  role: StaffRole;
  displayName?: string | null;
  invitedBy: Principal;
}) {
  const admin = createAuthAdminClient();
  if (!admin) throw new Error("Supabase Auth admin is not configured");
  const email = input.email.trim().toLowerCase();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: input.displayName?.trim() || undefined },
  });
  if (error || !data.user?.id) throw new Error(error?.message || "Could not create staff invitation");

  const rows = await serviceRequest<StoredStaff[]>("/rest/v1/mail_staff_members", {
    method: "POST",
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
  return rows[0] ?? null;
}

export async function updateStaffMember(input: {
  targetUserId: string;
  role: StaffRole;
  enabled: boolean;
}) {
  const rows = await serviceRequest<StoredStaff[]>("/rest/v1/rpc/mail_update_staff_member", {
    method: "POST",
    body: JSON.stringify({
      p_target_user_id: input.targetUserId,
      p_role: input.role,
      p_enabled: input.enabled,
    }),
  });
  return rows[0] ?? null;
}
