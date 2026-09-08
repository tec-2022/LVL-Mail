# LVL Mail · Search & Recovery

Search & Recovery is an operational recovery layer, not a resend button.

## Search

Operators can search the mail ledger by:

- tracking ID
- provider message ID
- idempotency key
- application
- template
- status
- provider
- date range
- exact recipient

Exact recipient search never stores or places the clear address in a URL. The admin POST endpoint hashes the normalized address with SHA-256 and queries the existing `recipient_hash`.

## Deterministic diagnosis

The message detail page derives a diagnosis from the tracked state and webhook timeline. It does not invent provider state and it does not use AI to decide whether a replay is safe.

Examples:

- `delivered`: no recovery required
- `delayed`: wait for a final provider event; replay is blocked
- `bounced`: validate the address; replay is blocked
- `complained`: keep the recipient suppressed; replay is blocked
- `suppressed`: resolve the suppression first; replay is blocked
- `provider_rejected`: inspect the provider failure code
- `failed`: inspect the final failure event
- policy blocks: fix the owning app's policy/reputation/quota state instead of bypassing it

## Safe Replay policy

Safe Replay is intentionally narrow.

### Never replay

The following are never replayable:

- `verify-email`
- `password-reset`
- `otp`
- any P0 mail
- delivered mail
- accepted/sent mail without a final failure
- delayed mail
- bounced mail
- complained mail
- suppressed mail
- a message that is already a replay
- a source message that already generated one replay
- ambiguous provider transport outcomes (`provider_transport_unknown`)

Security mail must be reissued by the source application so it receives a fresh OTP/token/link.

### Eligible

Only `transactional-notice` and `notification` can become replayable, and only after a definitive `provider_rejected` or `failed` state.

A replay additionally requires:

1. an unexpired encrypted recovery envelope;
2. matching app/template/template version attribution;
3. the owning app to remain enabled;
4. the template to remain enabled;
5. reputation guard approval;
6. suppression check approval;
7. quota and circuit-breaker approval;
8. an atomic replay claim to prevent double-click/concurrent duplication.

Every replay creates a new `mail_messages` row and a new tracking ID. The original row is never mutated into a successful delivery.

## Recovery envelope

LVL Mail keeps the main ledger pseudonymized with `recipient_hash`. For replayable templates only, the server may keep a short-lived encrypted payload in `mail_recovery_envelopes`.

Encryption:

- AES-256-GCM
- random 96-bit IV per message
- authenticated additional data bound to the message tracking ID
- server-only `LVL_MAIL_RECOVERY_KEY`
- key must decode to exactly 32 random bytes

Retention defaults:

- `transactional-notice`: 24 hours
- `notification`: 72 hours
- P0: no recovery envelope

Recovery envelopes are removed immediately on `delivered`, `bounced`, `complained`, or `suppressed`, and expired rows are purged during the reliability fleet sweep.

## Provider failover

LVL Mail exposes primary/secondary provider slots, but automatic cross-provider failover is deliberately disabled.

A transport exception can be ambiguous: the primary provider may have accepted a message before the connection was lost. Sending immediately through a secondary provider could create a duplicate and provider idempotency keys are not portable across providers.

Therefore:

- default failover mode: `disabled`
- optional mode: `manual`
- secondary replay is available only after a definitive replay-safe failure and only when the secondary adapter is genuinely configured
- ambiguous provider outcomes are never replayable

This preserves the core invariant: recovery must never be more dangerous than the failure it is trying to repair.
