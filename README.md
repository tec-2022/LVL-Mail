# LVL Mail

Central email gateway and control plane for LVL Tech products. The intended production domain is `mail.lvltechmx.com` and Resend is the delivery provider behind the gateway.

## What this foundation includes

- Next.js 16.3.3 dashboard with responsive control-plane UI.
- Application identities for LVL Tech, NexMesa, FINLAB and Cody.
- Server-owned email design system: apps send variables, not arbitrary HTML.
- P0 policy for `verify-email`, `password-reset` and `otp` so authentication mail bypasses batching by definition.
- Per-application gateway authentication using `x-lvl-mail-key`.
- Mandatory idempotency key forwarded to Resend.
- HTTPS validation for security links.
- Health endpoint and production-oriented environment configuration.
- Supabase schema foundation for messages, events and suppressions. It is intentionally not applied automatically.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

```env
RESEND_API_KEY=re_xxxxxxxxx
LVL_MAIL_APP_KEYS={"lvltech":"long-random-key","nexmesa":"long-random-key","finlab":"long-random-key","cody":"long-random-key"}
LVL_MAIL_SENDING_DOMAIN=mail.lvltechmx.com
```

Keep every secret server-side. Do not rename these variables with a `NEXT_PUBLIC_` prefix.

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

The application cannot choose its own priority. `verify-email`, `password-reset`, and `otp` are always classified as P0 by LVL Mail.

## Production checklist

1. Verify `mail.lvltechmx.com` in Resend and publish the SPF/DKIM records it provides.
2. Set the three environment variables in the deployment environment.
3. Generate a different long random gateway key for each application.
4. Protect the administrative dashboard with authentication before displaying real customer/event data.
5. Select the LVL Mail Supabase project and apply `supabase/schema.sql`.
6. Add a signed Resend webhook and persist delivery/bounce/complaint events.
7. Add persistent suppression checks and DB-backed rate limiting before enabling marketing mail.

## Security decisions

- Resend credentials exist only in LVL Mail.
- Each application can be revoked independently.
- Critical priority is determined from the template key server-side.
- Security CTAs require HTTPS.
- Duplicate retries are protected by idempotency.
- No public Supabase RLS policies are created by the schema.
- Marketing is intentionally not exposed by the sending API in this foundation.
