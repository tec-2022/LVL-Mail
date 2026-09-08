-- LVL Mail Alerting & Notification Center.
-- Reviewable schema extension only. Do not apply until the dedicated LVL Mail
-- Supabase project is selected and a production migration is generated.
--
-- Design:
-- - incident events are the source of truth;
-- - alert events are immutable/deduplicated by incident_event_id;
-- - rules fan out events to channels;
-- - delivery claiming is atomic so concurrent dispatchers cannot double-send;
-- - webhook endpoints/signing secrets are stored encrypted by the application;
-- - RLS + explicit service_role grants; no anon/authenticated access.

create table if not exists public.mail_alert_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  channel_type text not null check (channel_type in ('in_app','webhook')),
  is_enabled boolean not null default true,
  endpoint_ciphertext text,
  endpoint_iv text,
  endpoint_auth_tag text,
  secret_ciphertext text,
  secret_iv text,
  secret_auth_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    channel_type = 'in_app'
    or (
      endpoint_ciphertext is not null and endpoint_iv is not null and endpoint_auth_tag is not null
      and secret_ciphertext is not null and secret_iv is not null and secret_auth_tag is not null
    )
  )
);

create unique index if not exists mail_alert_channels_name_unique
  on public.mail_alert_channels(lower(name));

create table if not exists public.mail_alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  channel_id uuid not null references public.mail_alert_channels(id) on delete cascade,
  app_id text references public.mail_apps(id) on delete cascade,
  incident_type text,
  min_severity text not null default 'warning' check (min_severity in ('warning','critical')),
  notify_open boolean not null default true,
  notify_escalation boolean not null default true,
  notify_recovery boolean not null default true,
  cooldown_seconds integer not null default 300 check (cooldown_seconds between 0 and 86400),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_alert_rules_match_idx
  on public.mail_alert_rules(is_enabled, app_id, incident_type, min_severity);

create table if not exists public.mail_alert_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mail_incidents(id) on delete cascade,
  incident_event_id uuid not null unique references public.mail_incident_events(id) on delete cascade,
  app_id text not null references public.mail_apps(id) on delete cascade,
  event_type text not null check (event_type in ('opened','escalated','recovered','resolved')),
  severity text not null check (severity in ('warning','critical')),
  title text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mail_alert_events_app_time_idx
  on public.mail_alert_events(app_id, created_at desc);
create index if not exists mail_alert_events_incident_time_idx
  on public.mail_alert_events(incident_id, created_at asc);

create table if not exists public.mail_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_event_id uuid not null references public.mail_alert_events(id) on delete cascade,
  rule_id uuid not null references public.mail_alert_rules(id) on delete cascade,
  channel_id uuid not null references public.mail_alert_channels(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','suppressed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(alert_event_id, channel_id)
);

create index if not exists mail_alert_deliveries_due_idx
  on public.mail_alert_deliveries(status, next_attempt_at)
  where status in ('pending','failed');

alter table public.mail_alert_channels enable row level security;
alter table public.mail_alert_rules enable row level security;
alter table public.mail_alert_events enable row level security;
alter table public.mail_alert_deliveries enable row level security;

revoke all on table public.mail_alert_channels from anon, authenticated, service_role;
revoke all on table public.mail_alert_rules from anon, authenticated, service_role;
revoke all on table public.mail_alert_events from anon, authenticated, service_role;
revoke all on table public.mail_alert_deliveries from anon, authenticated, service_role;

grant select, insert, update on public.mail_alert_channels to service_role;
grant select, insert, update, delete on public.mail_alert_rules to service_role;
grant select, insert on public.mail_alert_events to service_role;
grant select, insert, update on public.mail_alert_deliveries to service_role;

-- In-app is always present. External channels are optional.
insert into public.mail_alert_channels(id, name, channel_type, is_enabled)
values ('00000000-0000-0000-0000-000000000001', 'LVL Mail Inbox', 'in_app', true)
on conflict (id) do update set is_enabled = true, updated_at = now();

insert into public.mail_alert_rules(
  id, name, channel_id, app_id, incident_type, min_severity,
  notify_open, notify_escalation, notify_recovery, cooldown_seconds, is_enabled
)
values (
  '00000000-0000-0000-0000-000000000001',
  'All incidents · in-app',
  '00000000-0000-0000-0000-000000000001',
  null, null, 'warning', true, true, true, 0, true
)
on conflict (id) do update set is_enabled = true, updated_at = now();

create or replace function public.mail_emit_alert_from_incident_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_incident public.mail_incidents%rowtype;
  v_alert_type text;
  v_alert_id uuid;
  v_rule record;
  v_should_notify boolean;
  v_severity_rank integer;
  v_rule_rank integer;
begin
  if new.event_type not in ('opened','severity_changed','recovered','resolved') then
    return new;
  end if;

  select * into v_incident from public.mail_incidents where id = new.incident_id;
  if v_incident.id is null then return new; end if;

  v_alert_type := case new.event_type
    when 'opened' then 'opened'
    when 'severity_changed' then 'escalated'
    when 'recovered' then 'recovered'
    when 'resolved' then 'resolved'
  end;

  insert into public.mail_alert_events(
    incident_id, incident_event_id, app_id, event_type, severity, title, summary, payload, created_at
  ) values (
    v_incident.id,
    new.id,
    v_incident.app_id,
    v_alert_type,
    v_incident.severity,
    v_incident.title,
    v_incident.summary,
    jsonb_build_object(
      'incidentType', v_incident.incident_type,
      'provider', v_incident.provider_name,
      'incidentEvent', new.event_type,
      'eventDetails', coalesce(new.details, '{}'::jsonb),
      'metrics', coalesce(v_incident.metrics, '{}'::jsonb)
    ),
    new.created_at
  )
  on conflict (incident_event_id) do nothing
  returning id into v_alert_id;

  if v_alert_id is null then return new; end if;

  v_severity_rank := case v_incident.severity when 'critical' then 2 else 1 end;

  for v_rule in
    select r.*
    from public.mail_alert_rules r
    join public.mail_alert_channels c on c.id = r.channel_id
    where r.is_enabled = true and c.is_enabled = true
      and (r.app_id is null or r.app_id = v_incident.app_id)
      and (r.incident_type is null or r.incident_type = v_incident.incident_type)
  loop
    v_rule_rank := case v_rule.min_severity when 'critical' then 2 else 1 end;
    v_should_notify := v_severity_rank >= v_rule_rank and (
      (v_alert_type = 'opened' and v_rule.notify_open)
      or (v_alert_type = 'escalated' and v_rule.notify_escalation)
      or (v_alert_type in ('recovered','resolved') and v_rule.notify_recovery)
    );

    if v_should_notify then
      insert into public.mail_alert_deliveries(alert_event_id, rule_id, channel_id)
      values (v_alert_id, v_rule.id, v_rule.channel_id)
      on conflict (alert_event_id, channel_id) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

-- The trigger is intentionally created by this unapplied extension. Incident
-- history remains authoritative; alert events are a fan-out/read model.
drop trigger if exists mail_incident_event_alert_trigger on public.mail_incident_events;
create trigger mail_incident_event_alert_trigger
after insert on public.mail_incident_events
for each row execute function public.mail_emit_alert_from_incident_event();

create or replace function public.mail_claim_alert_deliveries(p_limit integer)
returns table(
  delivery_id uuid,
  alert_event_id uuid,
  channel_id uuid,
  channel_type text,
  endpoint_ciphertext text,
  endpoint_iv text,
  endpoint_auth_tag text,
  secret_ciphertext text,
  secret_iv text,
  secret_auth_tag text,
  attempts integer,
  incident_id uuid,
  app_id text,
  event_type text,
  severity text,
  title text,
  summary text,
  payload jsonb,
  event_created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select d.id
    from public.mail_alert_deliveries d
    join public.mail_alert_channels c on c.id = d.channel_id
    where d.status in ('pending','failed')
      and d.next_attempt_at <= now()
      and d.attempts < 8
      and c.is_enabled = true
    order by d.next_attempt_at asc, d.created_at asc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update of d skip locked
  ), claimed as (
    update public.mail_alert_deliveries d
    set status = 'processing',
        attempts = d.attempts + 1,
        claimed_at = now(),
        updated_at = now()
    from candidates c
    where d.id = c.id
    returning d.*
  )
  select
    d.id,
    d.alert_event_id,
    d.channel_id,
    c.channel_type,
    c.endpoint_ciphertext,
    c.endpoint_iv,
    c.endpoint_auth_tag,
    c.secret_ciphertext,
    c.secret_iv,
    c.secret_auth_tag,
    d.attempts,
    e.incident_id,
    e.app_id,
    e.event_type,
    e.severity,
    e.title,
    e.summary,
    e.payload,
    e.created_at
  from claimed d
  join public.mail_alert_channels c on c.id = d.channel_id
  join public.mail_alert_events e on e.id = d.alert_event_id;
end;
$$;

create or replace function public.mail_finish_alert_delivery(
  p_delivery_id uuid,
  p_success boolean,
  p_error text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
  v_delay_seconds integer;
begin
  select attempts into v_attempts
  from public.mail_alert_deliveries
  where id = p_delivery_id
  for update;

  if v_attempts is null then raise exception 'delivery not found'; end if;

  if p_success then
    update public.mail_alert_deliveries
    set status = 'sent', sent_at = now(), last_error = null, updated_at = now()
    where id = p_delivery_id;
  else
    v_delay_seconds := least(3600, (power(2, least(v_attempts, 10)) * 30)::integer);
    update public.mail_alert_deliveries
    set status = case when v_attempts >= 8 then 'suppressed' else 'failed' end,
        next_attempt_at = now() + make_interval(secs => v_delay_seconds),
        last_error = left(coalesce(p_error, 'delivery failed'), 500),
        updated_at = now()
    where id = p_delivery_id;
  end if;
end;
$$;

revoke execute on function public.mail_emit_alert_from_incident_event() from public, anon, authenticated;
revoke execute on function public.mail_claim_alert_deliveries(integer) from public, anon, authenticated;
revoke execute on function public.mail_finish_alert_delivery(uuid,boolean,text) from public, anon, authenticated;

grant execute on function public.mail_emit_alert_from_incident_event() to service_role;
grant execute on function public.mail_claim_alert_deliveries(integer) to service_role;
grant execute on function public.mail_finish_alert_delivery(uuid,boolean,text) to service_role;
