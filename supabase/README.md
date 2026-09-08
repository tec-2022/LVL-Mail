# LVL Mail persistence

LVL Mail treats tracking as part of delivery, not optional observability.

## Production bootstrap model

The repository contains reviewable SQL extensions plus one historical migration. These files are **not** intended to be pasted into production ad hoc.

The canonical bootstrap review order is stored in:

```text
supabase/migration-manifest.json
```

CI runs `npm run check:migrations` and fails if a SQL file exists without an explicit position in that manifest.

Current order:

1. `schema.sql`
2. `migrations/202609080730_per_app_tracking.sql`
3. `enterprise.sql`
4. `reputation-guard.sql`
5. `template-studio.sql`
6. `template-attribution.sql`
7. `operations-reliability.sql`
8. `search-recovery.sql`
9. `iam.sql`
10. `alerting.sql`
11. `alerting-cooldown.sql`
12. `retention.sql`

Before production, this order must be applied and tested against a **clean staging Supabase project twice**, then converted into the production baseline/migration using the selected Supabase CLI/deployment process. See [`docs/PRODUCTION-READINESS.md`](../docs/PRODUCTION-READINESS.md).

Do not enable production sending until the resulting schema is fully applied. The send API intentionally returns `503 tracking_required` when mandatory tracking persistence is unavailable.

## Tracking invariant

Every valid authenticated send intent must have one `mail_messages` row before LVL Mail calls the provider.

That row always contains an `app_id`, so every email belongs to exactly one registered web/application. Provider events are reconciled back to the same message through the LVL Mail tracking UUID and/or provider email ID.

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

## Retention

`retention.sql` defines explicit defaults instead of keeping operational data forever:

| Resource | Default |
|---|---:|
| Raw provider events | 30 days |
| Terminal alert deliveries | 90 days |
| Message ledger | 365 days |
| Resolved incident history | 365 days |
| Access audit | 365 days |
| Control-plane audit | 365 days |
| Safe Replay audit | 365 days |

Recovery envelopes keep their much shorter per-message expiration. Suppressions, active configuration and template versions are **not auto-purged**.

Retention maintenance is exposed only through the protected internal endpoint:

```text
POST /api/internal/maintenance/purge
Authorization: Bearer LVL_MAIL_MAINTENANCE_SECRET
```

The scheduler is configured only after production persistence is live.

## Security

All internal persistence uses RLS plus explicit `service_role` access. Internal RPCs use `SECURITY INVOKER`; CI rejects `SECURITY DEFINER` regressions and direct anon/authenticated grants in `supabase/**/*.sql`.
