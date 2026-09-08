# LVL Mail

Central email gateway and control plane for LVL Tech products. The intended production domain is `mail.lvltechmx.com`; Resend stays behind LVL Mail instead of being configured separately in every application.

```text
Any web ──> LVL Mail ──> policy / templates / suppressions ──> Resend
                  │
                  └──> application registry + observability
```

## Product principle: adding a web must be easy

LVL Mail treats application onboarding as a one-field flow. In the control plane, open `/apps/new` and paste the website URL. The name is optional and branding can be customized later.

LVL Mail automatically creates:

- an application ID;
- a sender under `mail.lvltechmx.com`;
- an independent gateway API key;
- the default security/transactional template set;
- P0 behavior for confirmation, password reset and OTP;
- an integration example ready to copy.

A new application does **not** need its own Resend account, Resend API key, verified domain or DNS configuration.

The generated gateway key is shown once. Only its SHA-256 hash is stored in `mail_app_keys`, so the original secret cannot be retrieved later from the database.

## Included

- Next.js 16.3.3 responsive administrative control plane.
- Dynamic application registry instead of a hardcoded project list.
- One-field URL-first onboarding for new websites.
- Server-owned email design system: applications send variables, not arbitrary HTML.
- P0 policy for `verify-email`, `password-reset` and `otp`.
- Per-application authentication using `x-lvl-mail-key`.
- Database-backed hashed keys for newly registered applications.
- Temporary legacy environment-key compatibility for the original built-in apps.
- Mandatory idempotency forwarded to Resend.
- HTTPS-only URLs in critical security templates.
- Local suppression lookup before delivery when Supabase is available.
- Signed Resend webhook ingestion with `svix-id` deduplication.
- Persistent message/event/suppression model without storing recipient email addresses in clear text.
- Real 24-hour delivery metrics and 30-day reputation health by application.
- Production admin panel protection that fails closed when credentials are missing.
- CI workflow for lint and production build.

Marketing mail is deliberately not exposed by the sending API yet. That path should only open after opt-in/unsubscribe rules and persistent rate limits are implemented.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

In development the dashboard may be used without admin credentials. In production `LVL_MAIL_ADMIN_USER` and `LVL_MAIL_ADMIN_PASSWORD` are required or the administrative UI returns 503.

## Environment variables

```env
RESEND_API_KEY=re_xxxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxx
LVL_MAIL_APP_KEYS={"lvltech":"legacy-key","nexmesa":"legacy-key","finlab":"legacy-key","cody":"legacy-key"}
LVL_MAIL_SENDING_DOMAIN=mail.lvltechmx.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-me
LVL_MAIL_ADMIN_USER=admin
LVL_MAIL_ADMIN_PASSWORD=use-a-long-random-password
```

`LVL_MAIL_APP_KEYS` is now only a migration bridge for the original built-in applications. New applications get database-backed keys automatically and do not require a Vercel environment-variable change.

All secrets remain server-side. Do not expose them with a `NEXT_PUBLIC_` prefix.

## Application onboarding API

The administrative UI calls:

```text
POST /api/admin/apps
```

Minimal payload:

```json
{
  "websiteUrl": "https://myproduct.com"
}
```

Optional fields:

```json
{
  "websiteUrl": "https://myproduct.com",
  "name": "My Product",
  "accent": "#111827"
}
```

The endpoint is protected with the same production administrator credentials used by the control plane. Creation is atomic: the app and its first key are created together through `mail_create_app()`.

## Sending API

`POST /api/v1/send`

Headers:

```text
Content-Type: application/json
x-lvl-mail-key: <key assigned to the calling application>
```

Example confirmation email:

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

Applications cannot choose their priority. `verify-email`, `password-reset` and `otp` are always P0. `transactional-notice` is P1 and `notification` is P2.

### P0 behavior

P0 is the authentication/security lane. LVL Mail never batches these requests. A failure of the optional observability layer does not prevent a valid P0 request from reaching Resend; provider-side suppressions and the send result remain authoritative.

## Default templates

Every newly registered application automatically inherits:

- `verify-email`
- `password-reset`
- `otp`
- `transactional-notice`
- `notification`

There is no per-app setup step required to activate these templates. The application brand is applied at render time.

## Resend webhook

Configure Resend to deliver events to:

```text
https://mail.lvltechmx.com/api/webhooks/resend
```

Set the endpoint signing secret as `RESEND_WEBHOOK_SECRET`. LVL Mail verifies the raw payload before processing it, stores the event ID for idempotency, and mirrors permanent bounce/complaint/suppression signals into the local suppression table.

## Supabase

`supabase/schema.sql` creates:

- `mail_apps`
- `mail_app_keys`
- `mail_messages`
- `mail_events`
- `mail_suppressions`
- `mail_create_app()`
- `mail_dashboard_metrics()`
- `mail_app_health()`

`mail_create_app()` atomically creates the application and its first hashed gateway key. RLS is enabled and no public table policies are created. Administrative and metric RPCs are executable only by `service_role`.

The schema is intentionally committed but **not automatically applied**. Select the dedicated LVL Mail Supabase project first.

## Admin control plane

Routes:

- `/` — real 24-hour metrics and priority engine.
- `/apps` — dynamic application/sender identities.
- `/apps/new` — URL-first application onboarding.
- `/templates` — centralized templates inherited automatically by new apps.
- `/activity` — persisted Resend event stream.
- `/reputation` — per-app bounce/complaint health.
- `/settings` — deployment and secret configuration.

The dashboard is protected by Basic Auth at the server boundary in production. Administrative APIs independently verify the same credentials because `/api/*` is excluded from the UI proxy. The sending API and webhook use their own application-key/signature mechanisms.

## Production checklist

1. Select the dedicated LVL Mail Supabase project and apply `supabase/schema.sql`.
2. Verify `mail.lvltechmx.com` in Resend and publish the SPF/DKIM DNS records provided by Resend.
3. Deploy LVL Mail over HTTPS and attach `mail.lvltechmx.com`.
4. Add the server environment variables listed above.
5. Configure the signed Resend webhook endpoint.
6. Add a web through `/apps/new` and save the one-time gateway key.
7. Send one test for each critical template and verify accepted → delivered events in the dashboard.
8. Add persistent per-app rate limiting/circuit-breaker rules before enabling marketing or high-volume notification traffic.

## Security decisions

- The Resend API key exists only in LVL Mail.
- New application secrets are random, independent and stored only as hashes.
- Each application can be revoked independently once key-management controls are enabled.
- Critical priority is derived from the template key server-side.
- Applications cannot inject arbitrary email HTML.
- Security CTA URLs must use HTTPS.
- Duplicate retries require idempotency.
- Suppression state is checked before sending when local persistence is healthy.
- Recipient addresses are hashed before persistence.
- Resend webhook signatures are verified before event processing.
- The production admin UI and onboarding API fail closed without credentials.
- No public Supabase RLS policies are created.
- Marketing remains disabled until reputation protections for bulk traffic are complete.
