# LVL Mail Identity & Access Management

This document defines the internal staff access model for the LVL Mail control plane.

## Principles

- Invite-only. There is no public staff sign-up path.
- Supabase Auth verifies identity; LVL Mail authorization is resolved server-side from `mail_staff_members` and app scopes on every sensitive request.
- Authorization never trusts `user_metadata` or a client-supplied role.
- Role changes take effect on the next request because permissions are read from persistence, not cached only in JWT claims.
- The legacy Basic Auth credential remains a temporary break-glass path until production IAM is proven, then should be disabled.
- All privileged actions emit an immutable audit record with actor, role, permission, app scope and action details.

## Roles

### Owner
Full control of LVL Mail, including team membership and role assignment. Only Owner can grant or revoke Owner.

### Admin
Can manage applications, templates, API keys, incidents, search/recovery and platform configuration, but cannot promote users to Owner or remove the last Owner.

### Operator
Operational role. Can investigate messages, acknowledge/resolve incidents, run safe replay when policy allows, and send template tests. Cannot rotate application credentials, publish templates or manage staff.

### Viewer
Read-only access to dashboards, applications, templates, activity, reputation, operations and search.

## Permissions

- `platform.read`
- `apps.read`
- `apps.manage`
- `templates.read`
- `templates.edit`
- `templates.publish`
- `templates.test_send`
- `keys.read`
- `keys.rotate`
- `incidents.read`
- `incidents.manage`
- `messages.read`
- `messages.search`
- `messages.replay`
- `reputation.read`
- `audit.read`
- `team.read`
- `team.manage`
- `security.manage`

## App scopes

A staff member can be global (`all_apps=true`) or limited to explicit applications. Owner and Admin are expected to be global. Operator and Viewer may be restricted to selected app IDs.

## Authentication

Production staff authentication uses Supabase Auth with SSR cookies. Server code verifies identity with `auth.getClaims()` and then resolves the current staff membership from the database. `getSession()` is not used as an authorization primitive.

## Break-glass

`LVL_MAIL_ADMIN_USER` / `LVL_MAIL_ADMIN_PASSWORD` are retained temporarily as emergency access. Break-glass access is treated as Owner-level only for recovery and should be independently logged. Set `LVL_MAIL_BREAK_GLASS_ENABLED=false` once IAM has been validated in production.

## Safety invariants

- No public staff registration.
- Disabled staff cannot authorize any request even with a still-valid Auth session.
- The last Owner cannot be demoted or disabled.
- Admin cannot create, promote, demote or delete Owner accounts.
- App-scoped staff cannot operate on other apps.
- `service_role` never reaches browser code.
- Staff membership tables use RLS and no anon/authenticated Data API grants; server authorization uses service-role access only.
