# LVL Mail

Central email gateway and control plane for LVL Tech products. The intended production domain is `mail.lvltechmx.com`; applications integrate with LVL Mail instead of configuring an email provider independently.

```text
NexMesa / FINLAB / Cody / any web
                │
                ▼
            LVL Mail
                │
      ┌─────────┼─────────┐
      │         │         │
   policy    templates  tracking
      │         │         │
      └─────────┼─────────┘
                ▼
         provider adapter
                ▼
             Resend
```

## Product principles

- Adding a web should be almost one click: paste the URL, receive an app identity and one-time gateway key.
- Every valid email belongs to exactly one application and gets a tracking ID before the provider is called.
- P0 authentication email always has reserved capacity and cannot be downgraded by a calling application.
- One misbehaving application must not damage every other LVL Tech product.
- Administrative access is invite-only and permissioned; there is no public control-plane registration.
- Provider-specific behavior stays behind LVL Mail so applications do not depend on Resend directly.

## Current platform

### Application onboarding

`/apps/new` creates:

- application ID;
- sender under `mail.lvltechmx.com`;
- independent gateway API key;
- default template catalog;
- P0/P1/P2 priority policy;
- integration example.

The key is displayed once and only its SHA-256 hash is persisted.

### Priority engine

- `verify-email` → P0
- `password-reset` → P0
- `otp` → P0
- `transactional-notice` → P1
- `notification` → P2
- marketing/P3 remains closed until dedicated consent/unsubscribe controls are added.

Applications never choose their own priority.

### Per-application protection

Each application can have:

- Live / Test / Paused mode;
- minute and daily quotas;
- P0 capacity reservation;
- circuit breaker;
- reputation guard;
- template enable/disable controls;
- independent API key rotation/revocation;
- audit history.

### Template Studio

Each application gets a structured, versioned email editor with:

- Draft / Published / Archived lifecycle;
- desktop/mobile preview;
- allowed-variable contracts;
- server-owned critical CTA/OTP structure;
- test-send;
- publish and rollback;
- exact template-version attribution on every message.

LVL Mail does not store or accept arbitrary template HTML from applications.

### Mandatory tracking

Every valid send intent creates a `mail_messages` row before provider delivery. The ledger tracks:

- app ID;
- template and exact version;
- priority;
- provider and provider ID;
- state/failure code;
- timestamps;
- replay ancestry;
- recipient SHA-256 hash rather than clear email for ordinary observability.

Signed provider webhooks reconcile events such as sent, delivered, delayed, bounced, complained, failed, opened and clicked back to the same message/application.

### Operations & Reliability

`/operations` includes:

- P0 acceptance latency P50/P95/P99;
- P0 delivery latency P50/P95/P99;
- P0 delivery rate;
- provider rejection rate;
- bounce/complaint rates;
- per-app fleet health;
- persistent warning/critical incidents;
- Open → Acknowledged → Resolved lifecycle;
- incident timeline and actor attribution;
- protected reliability sweep endpoint for a future scheduler.

### Search & Recovery

`/activity` is an operational search workbench supporting:

- tracking ID;
- provider ID;
- idempotency key;
- application;
- template and version;
- state;
- provider;
- date range;
- exact recipient lookup through server-side SHA-256 hashing.

The clear recipient address is POSTed to the server for lookup and never placed in the URL.

#### Safe Replay

Safe Replay is deliberately conservative:

- P0 / confirmation / password reset / OTP: never replayed;
- accepted/sent/delayed/delivered: never replayed;
- bounced/complained/suppressed: never replayed;
- only approved non-critical `provider_rejected` or `failed` messages are candidates;
- one source message can create at most one replay;
- replay creates a new tracking ID and keeps the original failure immutable;
- reputation, template, quota, circuit breaker and suppression rules are re-evaluated.

Approved non-critical messages may retain a short-lived AES-256-GCM recovery envelope. P0 never gets one.

### Provider abstraction

Applications call LVL Mail, not Resend. The provider layer supports a primary/secondary topology and manual failover readiness. Automatic cross-provider failover is intentionally disabled for ambiguous transport outcomes because the first provider may already have accepted the message.

## Identity & Access Management

The control plane is invite-only and designed around Supabase Auth SSR sessions.

Roles:

- **Owner** — full control, including staff and security management.
- **Admin** — application/template/key/operations administration, but no Owner management.
- **Operator** — incident handling, operational search, Safe Replay and test sends.
- **Viewer** — read-only dashboards, apps, templates, messages and reputation.

Authorization is resolved server-side from `mail_staff_members`; LVL Mail does not trust `user_metadata` or a client-supplied role. Role/status changes therefore apply on the next privileged request rather than waiting for a JWT claim to expire.

`mail_staff_app_scopes` is present for a future per-application RBAC phase, but the current Team UI creates global memberships only until every page is fully scope-filtered.

### Break-glass

The previous Basic Auth credential remains only as a temporary emergency path during IAM rollout:

```env
LVL_MAIL_BREAK_GLASS_ENABLED=true
LVL_MAIL_ADMIN_USER=admin
LVL_MAIL_ADMIN_PASSWORD=use-a-long-random-password
```

After production IAM is validated, set:

```env
LVL_MAIL_BREAK_GLASS_ENABLED=false
```

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

When Supabase Auth is not configured, development can use a synthetic local Owner. Production fails closed unless IAM or the explicit break-glass path is configured.

## Environment variables

```env
LVL_MAIL_PROVIDER=resend
LVL_MAIL_PRIMARY_PROVIDER=resend
LVL_MAIL_SECONDARY_PROVIDER=
LVL_MAIL_FAILOVER_MODE=disabled

RESEND_API_KEY=re_xxxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxx
LVL_MAIL_SENDING_DOMAIN=mail.lvltechmx.com

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxx
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-me

LVL_MAIL_RECOVERY_KEY=replace-with-32-byte-base64-key
LVL_MAIL_BREAK_GLASS_ENABLED=true
LVL_MAIL_ADMIN_USER=admin
LVL_MAIL_ADMIN_PASSWORD=replace-with-a-long-random-password
LVL_MAIL_CRON_SECRET=replace-with-an-independent-long-random-secret
```

The Supabase project URL and publishable key may be public. `SUPABASE_SERVICE_ROLE_KEY`, Resend credentials, recovery key, cron secret and break-glass password must remain server-side.

## Sending API

`POST /api/v1/send`

Headers:

```text
Content-Type: application/json
x-lvl-mail-key: <application gateway key>
```

Example:

```json
{
  "appId": "my-product",
  "template": "verify-email",
  "to": "user@example.com",
  "idempotencyKey": "verify-user-0192ac",
  "variables": {
    "name": "Alex",
    "confirmationUrl": "https://myproduct.com/auth/confirm?token=...",
    "expiresMinutes": "15"
  }
}
```

## Provider webhook

Current Resend webhook endpoint:

```text
POST https://mail.lvltechmx.com/api/webhooks/resend
```

The raw body is signature-verified before processing, webhook event IDs are deduplicated, and terminal deliverability events update suppressions/reputation/reliability.

## Supabase SQL extensions

The repository currently keeps SQL reviewable and unapplied until a dedicated LVL Mail project is selected:

- `supabase/schema.sql` — core registry/tracking foundation;
- enterprise/control-plane SQL files — quotas, keys and policy state;
- `supabase/template-studio.sql` — versioned template persistence;
- `supabase/template-attribution.sql` — exact version attribution;
- `supabase/operations-reliability.sql` — SLOs/incidents;
- `supabase/search-recovery.sql` — operational search/recovery envelopes/replay audit;
- `supabase/iam.sql` — staff identities, roles and access audit.

New IAM/recovery tables use RLS, explicit `service_role` grants and `SECURITY INVOKER` RPCs. There are no anon/authenticated policies for internal control-plane data.

## Main control-plane routes

- `/` — system status and P0 priority overview.
- `/apps` — application fleet.
- `/apps/new` — URL-first onboarding.
- `/apps/[appId]` — per-app control center.
- `/templates` — Template Studio hub.
- `/activity` — Search & Recovery workbench.
- `/reputation` — per-app deliverability health.
- `/operations` — SLOs and incidents.
- `/team` — staff roles and invitation management.
- `/settings` — infrastructure/IAM/provider configuration state.

## Production checklist

Production infrastructure is intentionally not connected yet. When the platform is ready to activate:

1. Select the dedicated LVL Mail Supabase project.
2. Generate/apply clean migrations from the reviewable SQL extensions.
3. Configure Supabase Auth redirect URLs and publishable/service-role keys.
4. Bootstrap the first Owner through the temporary break-glass path.
5. Verify login, role enforcement, last-Owner protection and audit entries.
6. Disable break-glass.
7. Verify `mail.lvltechmx.com` with the provider and publish SPF/DKIM/DMARC as appropriate.
8. Configure provider webhook signing.
9. Deploy over HTTPS and attach `mail.lvltechmx.com`.
10. Configure the reliability scheduler only after persistence is live.
11. Connect one LVL Tech application first and validate P0 accepted → delivered end to end.

## Security invariants

- Provider API secrets exist only in LVL Mail.
- Application gateway keys are independent and stored only as hashes.
- Staff registration is invite-only.
- Supabase Auth verifies identity; DB membership verifies authorization.
- `service_role` never reaches browser code.
- The final active Owner cannot be demoted/disabled.
- P0 priority is server-owned.
- Critical templates cannot reuse expired security credentials via Safe Replay.
- Applications cannot inject arbitrary HTML.
- Critical CTA URLs require HTTPS.
- Valid sends require idempotency and mandatory tracking.
- Recipient addresses are hashed for ordinary tracking/search indexing.
- Recovery payloads are encrypted, short-lived and never created for P0.
- Webhook signatures are verified before event processing.
- Marketing remains closed until dedicated consent/unsubscribe controls are complete.
