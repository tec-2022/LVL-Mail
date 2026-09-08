# LVL Mail persistence

LVL Mail treats tracking as part of delivery, not optional observability.

When the dedicated Supabase project is selected, apply the database files in this order:

1. `schema.sql`
2. `migrations/202609080730_per_app_tracking.sql`

Do not enable production sending until both are applied. The send API intentionally returns `503 tracking_required` when tracking persistence is unavailable.

## Tracking invariant

Every valid authenticated send intent must have one `mail_messages` row before LVL Mail calls Resend.

That row always contains an `app_id`, so every email belongs to exactly one registered web/application. Provider events are then reconciled back to the same message through the LVL Mail tracking UUID and/or the Resend provider email ID.

Tracked lifecycle states include:

- `processing`
- `blocked`
- `provider_rejected`
- `accepted`
- `sent`
- `delayed`
- `delivered`
- `bounced`
- `complained`
- `failed`
- `suppressed`

The recipient address is not stored in clear text in the tracking ledger; LVL Mail persists its SHA-256 hash.
