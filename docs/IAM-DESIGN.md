# LVL Mail Identity & Access Management

This document defines the internal staff access model for the LVL Mail control plane.

## Principles

- Invite-only. There is no public staff sign-up path.
- Supabase Auth verifies identity; LVL Mail authorization is resolved server-side from `mail_staff_members` and app scopes on every sensitive request.
- Authorization never trusts `user_metadata` or a client-supplied role.
- Role, status and application-scope changes take effect on the next privileged request because authorization is read from persistence instead of trusting cached JWT role claims.
- The legacy Basic Auth credential remains a temporary break-glass path until production IAM is proven, then should be disabled.
- All privileged actions emit an append-only audit record with actor, role, permission, app and safe action details.
- Scope is enforced before loading sensitive app data, not only when rendering navigation or buttons.

## Roles

### Owner
Full global control of LVL Mail, including staff membership, security configuration and role/scope assignment. Owner is always global.

### Admin
Global application administrator. Can manage applications, templates, API keys, incidents and Search & Recovery. Can view the team but cannot manage membership or infrastructure/security settings.

### Operator
Operational role. Can investigate messages, acknowledge/resolve incidents, run Safe Replay when policy allows, and send template tests. It can be global or limited to selected applications.

### Viewer
Read-only access to dashboards, applications, templates, activity, reputation, operations and search. It can be global or limited to selected applications.

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

`security.manage` is Owner-only and gates infrastructure settings. `team.manage` is also Owner-only.

## App scopes

A staff member is either global (`all_apps=true`) or limited to explicit rows in `mail_staff_app_scopes`.

- Owner: always global.
- Admin: always global.
- Operator: global or scoped.
- Viewer: global or scoped.
- A scoped Operator/Viewer must have at least one application.
- Scope updates are atomic with role/status changes through `mail_update_staff_access()`.

The allow-list is enforced across:

- dashboard metrics and visible app counts;
- application fleet and control pages;
- Template Studio app/version pages;
- message search and Search & Recovery results;
- message detail/timeline/recovery loading;
- reputation metrics;
- SLO fleet and incident lists/details;
- app-specific administrative APIs.

A scoped user cannot infer whole-fleet aggregate metrics simply because a dashboard is global in layout.

## Database boundary

Internal persistence remains service-role only. Foundation and IAM RPCs use `SECURITY INVOKER`, explicit `service_role` grants and qualified object names with a controlled `search_path`.

Scoped analytics/search RPCs accept an application allow-list. `NULL` means a global principal; a non-empty array means only those application IDs may contribute rows or metrics. An empty application scope returns no data at the server layer.

## Authentication

Production staff authentication uses Supabase Auth with SSR cookies. Server code verifies identity with `auth.getClaims()` and then resolves the current staff membership from the database. `getSession()` is not used as an authorization primitive.

## Break-glass

`LVL_MAIL_ADMIN_USER` / `LVL_MAIL_ADMIN_PASSWORD` are retained temporarily as emergency access. Break-glass access is treated as Owner-level only for recovery and should be independently logged. Set `LVL_MAIL_BREAK_GLASS_ENABLED=false` once IAM has been validated in production.

## Safety invariants

- No public staff registration.
- Disabled staff cannot authorize any request even with a still-valid Auth session.
- The last active Owner cannot be demoted or disabled.
- Owner/Admin scopes cannot be narrowed accidentally; both are global by invariant.
- Scoped Operator/Viewer accounts require at least one application.
- App-scoped staff cannot read, search, infer aggregate metrics for, or operate on other apps.
- Sensitive app data is not loaded before the scope check.
- `service_role` never reaches browser code.
- Staff membership/scope/audit tables use RLS and no anon/authenticated Data API grants.
