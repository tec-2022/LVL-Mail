# LVL Mail Alerting

LVL Mail turns persistent incident lifecycle events into alert events and routes them through independent notification channels.

## Design goals

- **In-app is always the baseline channel.** Alert visibility does not depend on the email provider being monitored.
- **Incident history is authoritative.** Alerts are derived from persisted incident events, not process memory.
- **One incident event, one alert event.** `incident_event_id` is unique and prevents duplicate fan-out.
- **Concurrent dispatch is safe.** Pending deliveries are claimed with `FOR UPDATE SKIP LOCKED` before delivery.
- **External endpoints are encrypted at rest.** Webhook URL and signing secret use AES-256-GCM with `LVL_MAIL_ALERT_ENCRYPTION_KEY`.
- **External deliveries are signed.** Receivers can authenticate every request with a per-channel HMAC secret.
- **Email is not the on-call transport.** A Resend/provider outage must not prevent LVL Mail from surfacing the incident.

## Incident transitions

Alert events can be generated for:

- `opened`
- `escalated`
- `recovered`
- `resolved`

Acknowledgement and operator notes remain part of the incident timeline but do not create external alert noise by default.

## Webhook request

LVL Mail sends a `POST` request with JSON content.

Headers:

```text
Content-Type: application/json
User-Agent: LVL-Mail-Alerts/1.0
X-LVL-Mail-Alert-Id: <alert-event-uuid>
X-LVL-Mail-Timestamp: <unix-seconds>
X-LVL-Mail-Signature: sha256=<hex-hmac>
```

Payload:

```json
{
  "version": 1,
  "id": "alert-event-uuid",
  "incidentId": "incident-uuid",
  "appId": "nexmesa",
  "event": "opened",
  "severity": "critical",
  "title": "Entrega P0 degradada",
  "summary": "La tasa de entrega de correos críticos está por debajo del objetivo.",
  "occurredAt": "2026-09-08T18:00:00.000Z",
  "payload": {
    "incidentType": "p0_delivery_degraded",
    "provider": "resend",
    "metrics": {}
  }
}
```

## Signature verification

The per-channel signing secret is displayed only once when a webhook channel is created.

The signature input is:

```text
<timestamp>.<raw-request-body>
```

The receiver computes:

```text
HMAC-SHA256(signing_secret, timestamp + "." + raw_body)
```

and compares the hexadecimal result with the value after `sha256=` in `X-LVL-Mail-Signature` using a constant-time comparison.

Receivers should also reject timestamps outside a small tolerance window (for example five minutes) and deduplicate by `X-LVL-Mail-Alert-Id`.

## Retry behavior

External deliveries are persisted before dispatch. A failed delivery uses exponential backoff and is retried up to eight attempts. After the retry budget is exhausted, the delivery is marked `suppressed` and remains visible in the control plane for investigation.

A successful response is any HTTP 2xx response. Redirects are rejected.

## Network safety

Webhook configuration requires HTTPS in production. LVL Mail rejects credentials embedded in webhook URLs and blocks local/private/reserved targets. DNS is checked again before dispatch to reduce SSRF risk.

Development may use localhost for local testing only.

## Internal dispatcher

Pending deliveries are processed through:

```text
POST /api/internal/alerts/dispatch
Authorization: Bearer <LVL_MAIL_ALERT_DISPATCH_SECRET>
```

This endpoint is intended for a scheduler only after production persistence is connected. The dispatch secret is independent from `LVL_MAIL_CRON_SECRET` so the two internal capabilities can be rotated or revoked separately.

## Production state

The alerting schema and dispatcher are reviewable code only until the dedicated LVL Mail Supabase project and production deployment are selected. No scheduler or external webhook is configured by this repository phase.
