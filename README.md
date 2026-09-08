# LVL Mail

Central email gateway and control plane for LVL Tech products. The intended production domain is `mail.lvltechmx.com`; Resend is the delivery provider behind LVL Mail rather than a credential copied into every application.

```text
NexMesa ─┐
FINLAB ──┼──> LVL Mail ──> policy / templates / suppressions ──> Resend
Cody ────┤        │
Others ──┘        └──> Supabase observability
```

## Included in this foundation

- Next.js 16.3.3 responsive administrative control plane.
- Application identities for LVL Tech, NexMesa, FINLAB and Cody.
- Server-owned email design system: applications send variables, not arbitrary HTML.
- P0 policy for `verify-email`, `password-reset` and `otp`.
- Per-application authentication using `x-lvl-mail-key`.
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
LVL_MAIL_APP_KEYS={"lvltech":"long-random-key","nexmesa":"long-random-key","finlab":"long-random-key","cody":"long-random-key"}
LVL_MAIL_SENDING_DOMAIN=mail.lvltechmx.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-me
LVL_MAIL_ADMIN_USER=admin
LVL_MAIL_ADMIN_PASSWORD=use-a-long-random-password
```

All of these are server secrets. Do not expose them with a `NEXT_PUBLIC_` prefix.

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
  "appId": "nexmesa",
  "template": "verify-email",
  "to": "user@example.com",
  "idempotencyKey": "verify-user-0192ac",
  "variables": {
    "name": "Alex",
    "confirmationUrl": "https://example.com/auth/confirm?token=...",
    "expiresMinutes": "15"
  }
}
```

Applications cannot choose their priority. `verify-email`, `password-reset` and `otp` are always P0. `transactional-notice` is P1 and `notification` is P2.

### P0 behavior

P0 is the authentication/security lane. LVL Mail never batches these requests. A failure of the optional Supabase observability layer does not prevent a valid P0 request from reaching Resend; provider-side suppressions and the send result remain authoritative.

## Resend webhook

Configure Resend to deliver events to:

```text
https://mail.lvltechmx.com/api/webhooks/resend
```

Set the endpoint signing secret as `RESEND_WEBHOOK_SECRET`. LVL Mail verifies the raw payload before processing it, stores the event ID for idempotency, and mirrors permanent bounce/complaint/suppression signals into the local suppression table.

## Supabase

`supabase/schema.sql` creates:

- `mail_apps`
- `mail_messages`
- `mail_events`
- `mail_suppressions`
- `mail_dashboard_metrics()`
- `mail_app_health()`

RLS is enabled and no public table policies are created. Metric RPCs are executable only by `service_role`.

The schema is intentionally committed but **not automatically applied**. Select the dedicated LVL Mail Supabase project first.

## Admin control plane

Routes:

- `/` — real 24-hour metrics and priority engine.
- `/apps` — application/sender identities.
- `/templates` — centralized template catalog.
- `/activity` — persisted Resend event stream.
- `/reputation` — per-app bounce/complaint health.
- `/settings` — deployment and secret configuration.

The dashboard is protected by Basic Auth at the server boundary in production. The sending API and webhook are not placed behind that UI authentication because they use their own authentication/signature mechanisms.

## Production checklist

1. Verify `mail.lvltechmx.com` in Resend and publish the SPF/DKIM DNS records provided by Resend.
2. Deploy LVL Mail over HTTPS and attach `mail.lvltechmx.com`.
3. Add every server environment variable listed above.
4. Generate a different long random gateway key for every calling application.
5. Select the dedicated LVL Mail Supabase project and apply `supabase/schema.sql`.
6. Configure the signed Resend webhook endpoint.
7. Send one test for each critical template and verify accepted → delivered events in the dashboard.
8. Add persistent per-app rate limiting/circuit-breaker rules before enabling marketing or high-volume notification traffic.

## Security decisions

- The Resend API key exists only in LVL Mail.
- Each application can be revoked independently.
- Critical priority is derived from the template key server-side.
- Applications cannot inject arbitrary email HTML.
- Security CTA URLs must use HTTPS.
- Duplicate retries require idempotency.
- Suppression state is checked before sending when local persistence is healthy.
- Recipient addresses are hashed before persistence.
- Resend webhook signatures are verified before event processing.
- The production admin UI fails closed without credentials.
- No public Supabase RLS policies are created.
- Marketing remains disabled until reputation protections for bulk traffic are complete.
