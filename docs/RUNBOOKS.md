# LVL Mail Operational Runbooks

These runbooks define the first response to common production failures. They intentionally preserve LVL Mail safety invariants instead of restoring traffic by bypassing controls.

## 1. Tracking / database unavailable

### Signal

- `/api/health/ready` returns `503`;
- send API returns `tracking_required` or `tracking_unavailable`;
- Supabase operations fail;
- P0 requests cannot create their mandatory tracking row.

### Response

1. Confirm Supabase project/database status and connectivity.
2. Confirm `SUPABASE_URL` and service-role configuration were not rotated incorrectly.
3. Check structured logs by `X-Request-Id`.
4. Keep sending fail-closed while tracking is unavailable.
5. Restore persistence or roll back the deployment/configuration change that caused the outage.
6. Once healthy, send a fresh P0 canary from the origin application.

### Never

- bypass mandatory tracking;
- send P0 directly through Resend as an emergency shortcut;
- expose the service-role key to client code.

## 2. Provider degradation / outage

### Signal

- provider rejection incident;
- elevated P0 acceptance latency;
- `provider_rejected` messages;
- provider status/outage confirmed externally.

### Response

1. Identify whether failures are definitive rejects or ambiguous transport failures.
2. Pause/restrict non-critical traffic if necessary; protect P0 capacity.
3. Keep incident and alerting channels active.
4. For definitive failures on replay-eligible non-critical messages, use Safe Replay only after diagnosis.
5. Use a secondary provider only when its adapter/configuration has been validated and the original outcome is known to be safe for replay.
6. Observe recovery SLOs before restoring normal quotas.

### Never

- automatically fail over an ambiguous timeout;
- Safe Replay OTP, email verification or password-reset credentials;
- retry bounced/complained/suppressed recipients.

## 3. Provider webhook ingestion failure

### Signal

- messages remain accepted/sent without terminal events;
- provider webhook errors/signature failures;
- delivery metrics stop updating while sends continue.

### Response

1. Verify endpoint availability and provider webhook configuration.
2. Check signature configuration/secret rotation history.
3. Confirm request body is verified raw before parsing.
4. Use provider-side retry/replay capabilities where supported, preserving event IDs for deduplication.
5. Do not manufacture delivered states manually.
6. Once restored, verify event reconciliation on a test message.

## 4. Bounce / complaint spike on one application

### Signal

- application reputation state moves to watch/restricted;
- warning/critical incident;
- alert generated for bounce/complaint threshold.

### Response

1. Identify the affected application and template/version.
2. Pause P2/P3 and, if needed, P1 traffic for that application.
3. Keep P0 operational unless its own policy explicitly requires restriction.
4. Investigate list source, stale recipients, template behavior and application bug/regression.
5. Preserve suppression entries.
6. Resume conservatively after metrics recover.

### Never

- clear suppressions simply to increase delivery volume;
- disable reputation guard globally to fix one app.

## 5. Compromised application gateway key

1. Identify the affected app/key prefix from audit/control data.
2. Rotate a new key.
3. Deploy the new key to the application.
4. Revoke the compromised key.
5. Review message ledger and per-app volume for unexpected sends.
6. If abuse occurred, lower quotas/pause the app and review reputation impact.

Because keys are independent per application, other products should not require credential rotation.

## 6. Suspected staff account compromise

1. Disable the staff membership immediately.
2. Review `mail_access_audit` for privileged actions and app scope.
3. Rotate any application/provider secrets the account could have accessed operationally.
4. Restore access only through a verified identity/invitation path.
5. If the affected user is an Owner, confirm another active Owner remains before changing role/state.

Do not use break-glass as a permanent replacement account.

## 7. Alert webhook delivery failures

1. Verify the alert remains visible in the in-app inbox.
2. Inspect delivery status/attempt count without exposing encrypted endpoint/secrets.
3. Validate receiver availability and signature verification implementation.
4. Confirm the hostname still resolves only to public addresses.
5. Re-enable/fix the channel; retries use persisted delivery state and finite backoff.

Email-provider failures do not disable the in-app alert channel.

## 8. Retention maintenance failure

1. Keep the service online; retention cleanup is operational maintenance, not part of P0 send authorization.
2. Inspect `maintenance.purge.failed` logs by request ID.
3. Verify the final retention extension and service-role grants exist.
4. Correct the migration/configuration issue and rerun maintenance.
5. Review row growth if cleanup has been failing for an extended period.

Never manually delete suppressions as part of retention cleanup.

## 9. Bad application deployment

1. Stop rollout/promote previous known-good deployment.
2. Check `/api/health/live` and `/api/health/ready`.
3. If the database change was additive/backward-compatible, leave the DB forward-compatible and roll back application code only.
4. Re-run a P0 canary.
5. Record the root cause and add a regression test/gate before redeploying.

## 10. Bad database migration

1. Stop further application rollout.
2. Determine whether production writes occurred under the new schema.
3. Prefer a forward-fix for additive migrations.
4. If destructive reversal is necessary, follow the migration-specific reviewed rollback plan and restore from backup only when appropriate.
5. Validate tracking, IAM, incident/alert paths and a P0 canary after repair.

Never apply an improvised reverse migration to a live database with unknown writes.

## 11. Backup / restore drill

A restore drill should record:

- backup timestamp/source;
- restore destination;
- start/end timestamps;
- resulting data timestamp (measured RPO);
- time until service could be considered usable (measured RTO);
- verification of key tables/RPCs;
- P0 tracking/send canary in the restored environment;
- any manual steps that should be automated/documented.

Store the drill record outside the production database being tested.
