# LVL Mail Production Readiness

This document is the go-live gate for `mail.lvltechmx.com`. Passing CI is necessary but not sufficient to enable production traffic.

## Non-negotiable invariants

- Tracking persistence is mandatory. Do not bypass `tracking_required` to restore sending.
- P0 priority remains server-owned.
- Production staff access is invite-only; break-glass is temporary emergency access only.
- `SUPABASE_SERVICE_ROLE_KEY`, provider keys and encryption/scheduler secrets are server-only.
- Production SQL is applied from a tested migration/baseline, never by pasting unordered extension files ad hoc.
- Ambiguous provider transport failures are not automatically failed over or replayed.
- Marketing/P3 stays disabled until consent/unsubscribe controls exist.

## 1. Database staging gate

The reviewable SQL files are ordered by `supabase/migration-manifest.json`.

Before any production project is touched:

1. Create/select a disposable or dedicated staging Supabase project.
2. Apply every file in manifest order to an empty database.
3. Run the SQL privilege/security checks.
4. Exercise onboarding, tracking, templates, incident creation, alert fan-out, replay and IAM against staging.
5. Run retention purge once with synthetic old data and verify only eligible rows are removed.
6. Recreate staging from empty a second time to prove the bootstrap is deterministic.
7. Generate the actual production baseline/migration through the Supabase CLI/process selected for deployment.
8. Review the generated diff before applying it to production.

A new SQL extension that is not in the manifest fails CI.

## 2. Backup and restore gate

Before go-live, record the backup capability of the selected Supabase plan and define an explicit RPO/RTO for LVL Mail.

Minimum operating procedure:

- confirm automated database backups are enabled for the selected plan;
- prefer point-in-time recovery when available and justified by plan/cost;
- take/confirm a recoverable backup before any destructive migration;
- document the exact restore procedure and who can execute it;
- perform a restore drill into a non-production project before live traffic;
- repeat restore drills after major schema changes and on a recurring operational cadence.

A backup that has never been restored successfully is not considered a validated recovery plan.

## 3. Secrets and identity gate

Create independent production secrets for each capability:

- provider API key;
- provider webhook signing secret;
- Supabase service-role key;
- recovery encryption key;
- alert-channel encryption key;
- reliability scheduler secret;
- alert dispatcher secret;
- retention maintenance secret;
- break-glass password.

Do not reuse one scheduler/maintenance secret across endpoints.

Then:

1. Configure Supabase Auth redirect URLs.
2. Enable temporary break-glass.
3. Bootstrap/invite the first Owner.
4. Verify Owner login, last-Owner protection and audit entries.
5. Add a second authorized Owner before disabling break-glass.
6. Set `LVL_MAIL_BREAK_GLASS_ENABLED=false`.
7. Verify an unauthorized/disabled staff session fails closed.

## 4. Domain and provider gate

- Verify `mail.lvltechmx.com` using the exact provider-generated DNS records.
- Configure SPF/DKIM and DMARC appropriate to the final sending topology.
- Configure the signed provider webhook endpoint.
- Verify webhook signature rejection with an invalid signature.
- Confirm the active sending identity matches the verified domain.
- Keep P3/marketing disabled.

Never guess or hard-code provider DNS records from documentation examples.

## 5. Deployment gate

Before attaching public traffic:

- deploy the exact commit that passed CI;
- configure production environment variables in the deployment platform;
- verify `/api/health/live` returns `200`;
- verify `/api/health/ready` returns `200` only after core dependencies are present;
- verify `X-Request-Id` is returned and propagated through internal API calls;
- verify security headers/CSP/HSTS on the production hostname;
- verify staff pages require IAM and app-scoped roles cannot infer other-app data.

Do not use readiness as a secret-debug endpoint. It intentionally returns only ready/not-ready.

## 6. Scheduler gate

Schedulers are activated only after persistence and production secrets are live.

Recommended jobs:

- reliability sweep → `POST /api/internal/reliability/sweep`;
- alert delivery → `POST /api/internal/alerts/dispatch`;
- retention maintenance → `POST /api/internal/maintenance/purge`.

Each endpoint uses an independent Bearer secret. Confirm unauthorized calls return `401` before enabling the scheduler.

## 7. First-application canary

Connect exactly one LVL Tech application first.

Validate at least:

- `verify-email` → P0;
- `password-reset` → P0;
- OTP → P0;
- one P1 transactional message;
- one P2 notification;
- idempotent duplicate request;
- disabled template;
- suppressed recipient;
- invalid application key;
- provider webhook reconciliation;
- incident → alert inbox → optional external webhook;
- scoped Operator/Viewer access.

For a P0 canary, verify the complete chain:

```text
app request
→ mandatory tracking row
→ template/version attribution
→ policy + suppression checks
→ provider acceptance
→ signed webhook
→ delivered state
→ SLO/reputation metrics
```

## 8. Gradual traffic rollout

Do not migrate every application simultaneously.

1. One canary application.
2. Observe provider rejects, P0 latency, bounces and complaints.
3. Add the next application only after the current one is stable.
4. Keep per-app quotas conservative during early rollout.
5. Rotate/revoke legacy environment-backed app keys after DB-backed keys are proven.

## 9. Rollback policy

### Application deployment rollback

If a new web deployment is unhealthy and the database migration is backward-compatible, roll back the application deployment to the previous known-good commit and keep the database forward-compatible.

### Database rollback

Prefer **forward-fix** for additive migrations. Do not automatically reverse a migration that has already accepted production writes.

A migration that removes/renames data or changes semantics requires its own reviewed rollback/data-migration plan before deployment.

### Provider outage

Do not enable automatic cross-provider failover for an ambiguous transport result. The first provider may already have accepted the message. Follow the provider-outage runbook in `docs/RUNBOOKS.md`.

## 10. Go / no-go checklist

Production traffic is **NO-GO** until all items are true:

- [ ] clean staging bootstrap from migration manifest succeeds twice;
- [ ] production migration/baseline reviewed;
- [ ] backup/restore drill completed;
- [ ] IAM bootstrap and second Owner verified;
- [ ] break-glass disabled after validation;
- [ ] domain/provider authentication verified;
- [ ] provider webhook signature path verified;
- [ ] liveness/readiness healthy;
- [ ] all CI quality gates green on deployment commit;
- [ ] scheduler secrets independent and unauthorized calls rejected;
- [ ] retention purge validated with synthetic data;
- [ ] first-app P0 canary delivered end-to-end;
- [ ] alert path tested independently from email delivery;
- [ ] rollback owner/procedure documented.
