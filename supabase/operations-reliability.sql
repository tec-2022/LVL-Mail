-- LVL Mail Operations & Reliability.
-- Reviewable schema extension only; do not apply until the dedicated LVL Mail
-- Supabase project is selected. Uses explicit Data API grants, RLS and
-- SECURITY INVOKER functions for server-only service_role access.

alter table public.mail_messages add column if not exists provider_name text;
create index if not exists mail_messages_provider_time_idx
  on public.mail_messages(provider_name, created_at desc);

create table if not exists public.mail_reliability_policies (
  app_id text primary key references public.mail_apps(id) on delete cascade,
  min_sample integer not null default 20 check (min_sample between 1 and 10000),
  p0_delivery_warn_pct numeric(6,3) not null default 99.000 check (p0_delivery_warn_pct between 0 and 100),
  p0_delivery_critical_pct numeric(6,3) not null default 95.000 check (p0_delivery_critical_pct between 0 and 100),
  p0_accept_p95_warn_ms integer not null default 2000 check (p0_accept_p95_warn_ms > 0),
  p0_accept_p95_critical_ms integer not null default 5000 check (p0_accept_p95_critical_ms > 0),
  p0_delivery_p95_warn_ms integer not null default 60000 check (p0_delivery_p95_warn_ms > 0),
  p0_delivery_p95_critical_ms integer not null default 180000 check (p0_delivery_p95_critical_ms > 0),
  provider_reject_warn_pct numeric(6,3) not null default 2.000 check (provider_reject_warn_pct between 0 and 100),
  provider_reject_critical_pct numeric(6,3) not null default 5.000 check (provider_reject_critical_pct between 0 and 100),
  bounce_warn_pct numeric(6,3) not null default 1.000 check (bounce_warn_pct between 0 and 100),
  bounce_critical_pct numeric(6,3) not null default 3.000 check (bounce_critical_pct between 0 and 100),
  complaint_warn_pct numeric(7,4) not null default 0.0300 check (complaint_warn_pct between 0 and 100),
  complaint_critical_pct numeric(7,4) not null default 0.0600 check (complaint_critical_pct between 0 and 100),
  updated_at timestamptz not null default now()
);

insert into public.mail_reliability_policies(app_id)
select id from public.mail_apps
on conflict (app_id) do nothing;

create table if not exists public.mail_incidents (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.mail_apps(id) on delete cascade,
  provider_name text,
  incident_type text not null,
  severity text not null check (severity in ('warning','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  title text not null,
  summary text not null,
  metrics jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists mail_incident_one_active_idx
  on public.mail_incidents(app_id, incident_type, coalesce(provider_name,''))
  where status in ('open','acknowledged');
create index if not exists mail_incidents_status_time_idx
  on public.mail_incidents(status, last_detected_at desc);
create index if not exists mail_incidents_app_time_idx
  on public.mail_incidents(app_id, last_detected_at desc);

create table if not exists public.mail_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mail_incidents(id) on delete cascade,
  event_type text not null check (event_type in ('opened','severity_changed','acknowledged','recovered','resolved','note')),
  actor text not null default 'system',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists mail_incident_events_incident_time_idx
  on public.mail_incident_events(incident_id, created_at asc);

alter table public.mail_reliability_policies enable row level security;
alter table public.mail_incidents enable row level security;
alter table public.mail_incident_events enable row level security;

revoke all on table public.mail_reliability_policies from anon, authenticated, service_role;
revoke all on table public.mail_incidents from anon, authenticated, service_role;
revoke all on table public.mail_incident_events from anon, authenticated, service_role;
grant select, insert, update on public.mail_reliability_policies to service_role;
grant select, insert, update on public.mail_incidents to service_role;
grant select, insert on public.mail_incident_events to service_role;
grant update on public.mail_messages to service_role;

create or replace function public.mail_set_message_provider(
  p_message_id uuid,
  p_provider_name text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_provider_name is null or char_length(trim(p_provider_name)) < 1 or char_length(p_provider_name) > 64 then
    raise exception 'invalid provider name';
  end if;
  update public.mail_messages
  set provider_name = lower(trim(p_provider_name)), updated_at = now()
  where id = p_message_id;
end;
$$;

create or replace function public.mail_reliability_snapshot(p_app_id text)
returns table(
  app_id text,
  p0_total_24h bigint,
  p0_accepted_24h bigint,
  p0_delivered_24h bigint,
  p0_delivery_rate_24h numeric,
  p0_accept_p50_ms numeric,
  p0_accept_p95_ms numeric,
  p0_accept_p99_ms numeric,
  p0_delivery_p50_ms numeric,
  p0_delivery_p95_ms numeric,
  p0_delivery_p99_ms numeric,
  provider_attempts_1h bigint,
  provider_rejected_1h bigint,
  provider_reject_rate_1h numeric,
  bounced_24h bigint,
  bounce_rate_24h numeric,
  complained_24h bigint,
  complaint_rate_24h numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with p0 as (
    select * from public.mail_messages
    where app_id = p_app_id and priority = 'P0' and created_at >= now() - interval '24 hours'
  ), accepted_latency as (
    select extract(epoch from (accepted_at - created_at)) * 1000.0 as ms
    from p0 where accepted_at is not null and accepted_at >= created_at
  ), delivery_latency as (
    select extract(epoch from (delivered_at - created_at)) * 1000.0 as ms
    from p0 where delivered_at is not null and delivered_at >= created_at
  ), provider_hour as (
    select * from public.mail_messages
    where app_id = p_app_id and created_at >= now() - interval '1 hour'
      and (provider_name is not null or status = 'provider_rejected')
  ), day_all as (
    select * from public.mail_messages
    where app_id = p_app_id and created_at >= now() - interval '24 hours'
      and provider_name is not null
  )
  select
    p_app_id,
    (select count(*) from p0)::bigint,
    (select count(*) from p0 where accepted_at is not null)::bigint,
    (select count(*) from p0 where delivered_at is not null)::bigint,
    round((100.0 * (select count(*) from p0 where delivered_at is not null) / nullif((select count(*) from p0 where accepted_at is not null),0))::numeric, 3),
    round((select percentile_cont(0.50) within group (order by ms) from accepted_latency)::numeric, 1),
    round((select percentile_cont(0.95) within group (order by ms) from accepted_latency)::numeric, 1),
    round((select percentile_cont(0.99) within group (order by ms) from accepted_latency)::numeric, 1),
    round((select percentile_cont(0.50) within group (order by ms) from delivery_latency)::numeric, 1),
    round((select percentile_cont(0.95) within group (order by ms) from delivery_latency)::numeric, 1),
    round((select percentile_cont(0.99) within group (order by ms) from delivery_latency)::numeric, 1),
    (select count(*) from provider_hour)::bigint,
    (select count(*) from provider_hour where status = 'provider_rejected')::bigint,
    round((100.0 * (select count(*) from provider_hour where status = 'provider_rejected') / nullif((select count(*) from provider_hour),0))::numeric, 3),
    (select count(*) from day_all where status = 'bounced')::bigint,
    round((100.0 * (select count(*) from day_all where status = 'bounced') / nullif((select count(*) from day_all),0))::numeric, 3),
    (select count(*) from day_all where status = 'complained')::bigint,
    round((100.0 * (select count(*) from day_all where status = 'complained') / nullif((select count(*) from day_all),0))::numeric, 4);
$$;

create or replace function public.mail_reliability_fleet()
returns table(
  app_id text,
  app_name text,
  p0_total_24h bigint,
  p0_delivery_rate_24h numeric,
  p0_accept_p95_ms numeric,
  p0_delivery_p95_ms numeric,
  provider_reject_rate_1h numeric,
  bounce_rate_24h numeric,
  complaint_rate_24h numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.name,
    s.p0_total_24h, s.p0_delivery_rate_24h,
    s.p0_accept_p95_ms, s.p0_delivery_p95_ms,
    s.provider_reject_rate_1h, s.bounce_rate_24h, s.complaint_rate_24h
  from public.mail_apps a
  cross join lateral public.mail_reliability_snapshot(a.id) s
  order by a.name;
$$;

create or replace function public.mail_set_incident_condition(
  p_app_id text,
  p_provider_name text,
  p_incident_type text,
  p_active boolean,
  p_severity text,
  p_title text,
  p_summary text,
  p_metrics jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_incident public.mail_incidents%rowtype;
  v_id uuid;
begin
  select * into v_incident
  from public.mail_incidents
  where app_id = p_app_id
    and incident_type = p_incident_type
    and coalesce(provider_name,'') = coalesce(p_provider_name,'')
    and status in ('open','acknowledged')
  order by first_detected_at desc limit 1
  for update;

  if p_active then
    if p_severity not in ('warning','critical') then raise exception 'invalid severity'; end if;
    if v_incident.id is null then
      insert into public.mail_incidents(app_id,provider_name,incident_type,severity,status,title,summary,metrics)
      values (p_app_id,nullif(p_provider_name,''),p_incident_type,p_severity,'open',p_title,p_summary,coalesce(p_metrics,'{}'::jsonb))
      returning id into v_id;
      insert into public.mail_incident_events(incident_id,event_type,actor,details)
      values (v_id,'opened','system',jsonb_build_object('severity',p_severity,'metrics',coalesce(p_metrics,'{}'::jsonb)));
    else
      v_id := v_incident.id;
      update public.mail_incidents set
        severity = p_severity,
        title = p_title,
        summary = p_summary,
        metrics = coalesce(p_metrics,'{}'::jsonb),
        last_detected_at = now(),
        updated_at = now()
      where id = v_id;
      if v_incident.severity <> p_severity then
        insert into public.mail_incident_events(incident_id,event_type,actor,details)
        values (v_id,'severity_changed','system',jsonb_build_object('from',v_incident.severity,'to',p_severity));
      end if;
    end if;
  elsif v_incident.id is not null then
    v_id := v_incident.id;
    update public.mail_incidents set status='resolved', resolved_at=now(), updated_at=now()
    where id=v_id;
    insert into public.mail_incident_events(incident_id,event_type,actor,details)
    values (v_id,'recovered','system',jsonb_build_object('previousSeverity',v_incident.severity));
  end if;
  return v_id;
end;
$$;

create or replace function public.mail_evaluate_reliability(p_app_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.mail_reliability_policies%rowtype;
  s record;
  severity text;
  provider text;
begin
  insert into public.mail_reliability_policies(app_id) values (p_app_id)
  on conflict (app_id) do nothing;
  select * into v from public.mail_reliability_policies where app_id=p_app_id;
  select * into s from public.mail_reliability_snapshot(p_app_id);
  select provider_name into provider from public.mail_messages
    where app_id=p_app_id and provider_name is not null order by created_at desc limit 1;

  if s.p0_accepted_24h >= v.min_sample and s.p0_delivery_rate_24h is not null and s.p0_delivery_rate_24h < v.p0_delivery_warn_pct then
    severity := case when s.p0_delivery_rate_24h < v.p0_delivery_critical_pct then 'critical' else 'warning' end;
    perform public.mail_set_incident_condition(p_app_id,provider,'p0_delivery_degraded',true,severity,
      'Entrega P0 degradada',
      'La tasa de entrega de correos críticos está por debajo del objetivo.',
      jsonb_build_object('deliveryRate',s.p0_delivery_rate_24h,'accepted',s.p0_accepted_24h,'delivered',s.p0_delivered_24h));
  else
    perform public.mail_set_incident_condition(p_app_id,provider,'p0_delivery_degraded',false,'warning','','','{}'::jsonb);
  end if;

  if s.p0_accepted_24h >= v.min_sample and s.p0_accept_p95_ms is not null and s.p0_accept_p95_ms > v.p0_accept_p95_warn_ms then
    severity := case when s.p0_accept_p95_ms > v.p0_accept_p95_critical_ms then 'critical' else 'warning' end;
    perform public.mail_set_incident_condition(p_app_id,provider,'p0_accept_latency',true,severity,
      'Latencia P0 elevada',
      'El tiempo P95 desde LVL Mail hasta aceptación del proveedor está por encima del objetivo.',
      jsonb_build_object('p95Ms',s.p0_accept_p95_ms,'warningMs',v.p0_accept_p95_warn_ms,'criticalMs',v.p0_accept_p95_critical_ms));
  else
    perform public.mail_set_incident_condition(p_app_id,provider,'p0_accept_latency',false,'warning','','','{}'::jsonb);
  end if;

  if s.p0_delivered_24h >= v.min_sample and s.p0_delivery_p95_ms is not null and s.p0_delivery_p95_ms > v.p0_delivery_p95_warn_ms then
    severity := case when s.p0_delivery_p95_ms > v.p0_delivery_p95_critical_ms then 'critical' else 'warning' end;
    perform public.mail_set_incident_condition(p_app_id,provider,'p0_delivery_latency',true,severity,
      'Entrega P0 lenta',
      'El tiempo P95 hasta entrega al destinatario está por encima del objetivo.',
      jsonb_build_object('p95Ms',s.p0_delivery_p95_ms,'warningMs',v.p0_delivery_p95_warn_ms,'criticalMs',v.p0_delivery_p95_critical_ms));
  else
    perform public.mail_set_incident_condition(p_app_id,provider,'p0_delivery_latency',false,'warning','','','{}'::jsonb);
  end if;

  if s.provider_attempts_1h >= v.min_sample and coalesce(s.provider_reject_rate_1h,0) >= v.provider_reject_warn_pct then
    severity := case when s.provider_reject_rate_1h >= v.provider_reject_critical_pct then 'critical' else 'warning' end;
    perform public.mail_set_incident_condition(p_app_id,provider,'provider_rejections',true,severity,
      'Rechazos del proveedor elevados',
      'El proveedor está rechazando más solicitudes de lo esperado.',
      jsonb_build_object('rejectRate',s.provider_reject_rate_1h,'attempts',s.provider_attempts_1h,'rejected',s.provider_rejected_1h));
  else
    perform public.mail_set_incident_condition(p_app_id,provider,'provider_rejections',false,'warning','','','{}'::jsonb);
  end if;

  if s.provider_attempts_1h >= v.min_sample and coalesce(s.bounce_rate_24h,0) >= v.bounce_warn_pct then
    severity := case when s.bounce_rate_24h >= v.bounce_critical_pct then 'critical' else 'warning' end;
    perform public.mail_set_incident_condition(p_app_id,provider,'bounce_spike',true,severity,
      'Bounce rate elevado',
      'La tasa de rebote de esta aplicación requiere atención.',
      jsonb_build_object('bounceRate',s.bounce_rate_24h,'bounced',s.bounced_24h));
  else
    perform public.mail_set_incident_condition(p_app_id,provider,'bounce_spike',false,'warning','','','{}'::jsonb);
  end if;

  if s.provider_attempts_1h >= v.min_sample and coalesce(s.complaint_rate_24h,0) >= v.complaint_warn_pct then
    severity := case when s.complaint_rate_24h >= v.complaint_critical_pct then 'critical' else 'warning' end;
    perform public.mail_set_incident_condition(p_app_id,provider,'complaint_spike',true,severity,
      'Complaints elevadas',
      'La tasa de quejas de spam de esta aplicación requiere atención inmediata.',
      jsonb_build_object('complaintRate',s.complaint_rate_24h,'complained',s.complained_24h));
  else
    perform public.mail_set_incident_condition(p_app_id,provider,'complaint_spike',false,'warning','','','{}'::jsonb);
  end if;
end;
$$;

create or replace function public.mail_change_incident_status(
  p_incident_id uuid,
  p_status text,
  p_actor text
)
returns setof public.mail_incidents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.mail_incidents%rowtype;
begin
  if p_status not in ('acknowledged','resolved') then raise exception 'invalid status'; end if;
  select * into v from public.mail_incidents where id=p_incident_id for update;
  if not found then raise exception 'incident not found'; end if;
  update public.mail_incidents set
    status=p_status,
    acknowledged_at=case when p_status='acknowledged' then coalesce(acknowledged_at,now()) else acknowledged_at end,
    resolved_at=case when p_status='resolved' then now() else resolved_at end,
    updated_at=now()
  where id=p_incident_id;
  insert into public.mail_incident_events(incident_id,event_type,actor,details)
  values (p_incident_id,case when p_status='acknowledged' then 'acknowledged' else 'resolved' end,coalesce(nullif(p_actor,''),'admin'),'{}'::jsonb);
  return query select * from public.mail_incidents where id=p_incident_id;
end;
$$;

revoke execute on function public.mail_set_message_provider(uuid,text) from public, anon, authenticated;
revoke execute on function public.mail_reliability_snapshot(text) from public, anon, authenticated;
revoke execute on function public.mail_reliability_fleet() from public, anon, authenticated;
revoke execute on function public.mail_set_incident_condition(text,text,text,boolean,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.mail_evaluate_reliability(text) from public, anon, authenticated;
revoke execute on function public.mail_change_incident_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.mail_set_message_provider(uuid,text) to service_role;
grant execute on function public.mail_reliability_snapshot(text) to service_role;
grant execute on function public.mail_reliability_fleet() to service_role;
grant execute on function public.mail_set_incident_condition(text,text,text,boolean,text,text,text,jsonb) to service_role;
grant execute on function public.mail_evaluate_reliability(text) to service_role;
grant execute on function public.mail_change_incident_status(uuid,text,text) to service_role;
