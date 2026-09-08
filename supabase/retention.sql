-- LVL Mail data retention and purge policy.
-- Apply last, after every other schema extension, when production migrations are generated.
--
-- Principles:
-- - suppressions are intentionally NOT auto-deleted because they protect sender reputation;
-- - template versions and current application/configuration state are retained;
-- - recovery envelopes keep their much shorter per-message expiry and are purged whenever expired;
-- - destructive cleanup is restricted to service_role and returns only aggregate counts.

create table if not exists public.mail_retention_policies (
  resource text primary key,
  retention_days integer not null check (retention_days between 1 and 3650),
  is_enabled boolean not null default true,
  description text not null,
  updated_at timestamptz not null default now()
);

insert into public.mail_retention_policies(resource, retention_days, description) values
  ('provider_events', 30, 'Raw provider webhook/event payload history.'),
  ('alert_deliveries', 90, 'Terminal alert delivery attempts and transport errors.'),
  ('message_ledger', 365, 'Hashed-recipient message ledger and final lifecycle state.'),
  ('incident_history', 365, 'Resolved incidents and their derived alert history.'),
  ('access_audit', 365, 'Staff authorization and privileged action audit.'),
  ('control_audit', 365, 'Application/template/control-plane audit history.'),
  ('replay_audit', 365, 'Safe Replay ancestry and operator reason history.')
on conflict (resource) do update set
  retention_days = excluded.retention_days,
  description = excluded.description,
  updated_at = now();

alter table public.mail_retention_policies enable row level security;
revoke all on table public.mail_retention_policies from public, anon, authenticated, service_role;
grant select, update on public.mail_retention_policies to service_role;

create or replace function public.mail_purge_retention()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_days integer;
  v_count bigint;
  v_result jsonb := '{}'::jsonb;
begin
  -- Recovery payloads are governed by their own short-lived expires_at value.
  delete from public.mail_recovery_envelopes
  where expires_at <= now();
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('recovery_envelopes', v_count);

  select retention_days into v_days from public.mail_retention_policies
    where resource = 'provider_events' and is_enabled = true;
  if v_days is not null then
    delete from public.mail_events
    where occurred_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('provider_events', v_count);
  end if;

  select retention_days into v_days from public.mail_retention_policies
    where resource = 'alert_deliveries' and is_enabled = true;
  if v_days is not null then
    delete from public.mail_alert_deliveries
    where status in ('sent','suppressed')
      and created_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('alert_deliveries', v_count);
  end if;

  -- Replay audit must be removed before old messages because it intentionally
  -- references both source and replay messages with ON DELETE RESTRICT.
  select retention_days into v_days from public.mail_retention_policies
    where resource = 'replay_audit' and is_enabled = true;
  if v_days is not null then
    delete from public.mail_replay_audit
    where created_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('replay_audit', v_count);
  end if;

  select retention_days into v_days from public.mail_retention_policies
    where resource = 'access_audit' and is_enabled = true;
  if v_days is not null then
    delete from public.mail_access_audit
    where created_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('access_audit', v_count);
  end if;

  select retention_days into v_days from public.mail_retention_policies
    where resource = 'control_audit' and is_enabled = true;
  if v_days is not null then
    delete from public.mail_audit_log
    where created_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('control_audit', v_count);
  end if;

  -- Deleting a resolved incident cascades its incident events, derived alert
  -- events and any remaining alert delivery rows tied to those events.
  select retention_days into v_days from public.mail_retention_policies
    where resource = 'incident_history' and is_enabled = true;
  if v_days is not null then
    delete from public.mail_incidents
    where status = 'resolved'
      and resolved_at is not null
      and resolved_at < now() - make_interval(days => v_days);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('incidents', v_count);
  end if;

  select retention_days into v_days from public.mail_retention_policies
    where resource = 'message_ledger' and is_enabled = true;
  if v_days is not null then
    delete from public.mail_messages m
    where m.created_at < now() - make_interval(days => v_days)
      and m.status in ('blocked','provider_rejected','delivered','bounced','complained','failed','suppressed')
      and not exists (
        select 1 from public.mail_replay_audit r
        where r.source_message_id = m.id or r.replay_message_id = m.id
      );
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('message_ledger', v_count);
  end if;

  return v_result;
end;
$$;

revoke execute on function public.mail_purge_retention() from public, anon, authenticated;
grant execute on function public.mail_purge_retention() to service_role;
