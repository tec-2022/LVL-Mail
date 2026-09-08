-- Mandatory per-application email tracking for LVL Mail.
-- Every valid authenticated send intent gets a mail_messages row before Resend is called.

alter table public.mail_messages add column if not exists failure_code text;
alter table public.mail_messages add column if not exists accepted_at timestamptz;
alter table public.mail_messages add column if not exists delivered_at timestamptz;
alter table public.mail_messages add column if not exists last_event_at timestamptz;
alter table public.mail_messages add column if not exists updated_at timestamptz not null default now();

alter table public.mail_events add column if not exists app_id text references public.mail_apps(id);

create index if not exists mail_messages_app_status_created_idx
  on public.mail_messages(app_id, status, created_at desc);
create index if not exists mail_events_app_time_idx
  on public.mail_events(app_id, occurred_at desc);

create or replace function public.mail_begin_tracked_message(
  p_id uuid,
  p_app_id text,
  p_template_key text,
  p_priority text,
  p_recipient_hash text,
  p_idempotency_key text
)
returns setof public.mail_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_priority not in ('P0','P1','P2','P3') then
    raise exception 'invalid priority';
  end if;
  if char_length(p_recipient_hash) <> 64 then
    raise exception 'invalid recipient hash';
  end if;
  if char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 256 then
    raise exception 'invalid idempotency key';
  end if;

  insert into public.mail_messages (
    id, app_id, template_key, priority, recipient_hash, idempotency_key, status, updated_at
  ) values (
    p_id, p_app_id, p_template_key, p_priority, p_recipient_hash, p_idempotency_key, 'processing', now()
  )
  on conflict (app_id, idempotency_key) do nothing;

  return query
    select m.*
    from public.mail_messages m
    where m.app_id = p_app_id and m.idempotency_key = p_idempotency_key
    limit 1;
end;
$$;

create or replace function public.mail_set_message_result(
  p_message_id uuid,
  p_provider_id text,
  p_status text,
  p_failure_code text
)
returns setof public.mail_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in (
    'processing','blocked','provider_rejected','accepted','sent','delayed',
    'delivered','bounced','complained','failed','suppressed'
  ) then
    raise exception 'invalid message status';
  end if;

  update public.mail_messages
  set
    provider_id = coalesce(p_provider_id, provider_id),
    status = p_status,
    failure_code = p_failure_code,
    accepted_at = case
      when p_status = 'accepted' then coalesce(accepted_at, now())
      else accepted_at
    end,
    delivered_at = case
      when p_status = 'delivered' then coalesce(delivered_at, now())
      else delivered_at
    end,
    updated_at = now()
  where id = p_message_id;

  return query select * from public.mail_messages where id = p_message_id;
end;
$$;

create or replace function public.mail_record_tracked_event(
  p_event_id text,
  p_provider_email_id text,
  p_tracking_id text,
  p_event_type text,
  p_payload jsonb,
  p_occurred_at timestamptz
)
returns table(message_id uuid, app_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.mail_messages%rowtype;
  v_tracking_uuid uuid;
  v_status text;
begin
  if p_tracking_id is not null and p_tracking_id <> '' then
    begin
      v_tracking_uuid := p_tracking_id::uuid;
    exception when invalid_text_representation then
      v_tracking_uuid := null;
    end;
  end if;

  if v_tracking_uuid is not null then
    select * into v_message from public.mail_messages where id = v_tracking_uuid limit 1;
  end if;

  if v_message.id is null and p_provider_email_id is not null then
    select * into v_message from public.mail_messages where provider_id = p_provider_email_id limit 1;
  end if;

  if v_message.id is null then
    return;
  end if;

  insert into public.mail_events (
    provider_event_id, provider_email_id, app_id, message_id, event_type, payload, occurred_at
  ) values (
    p_event_id,
    coalesce(p_provider_email_id, v_message.provider_id),
    v_message.app_id,
    v_message.id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  on conflict (provider_event_id) do nothing;

  v_status := case p_event_type
    when 'email.sent' then 'sent'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    when 'email.suppressed' then 'suppressed'
    else null
  end;

  update public.mail_messages
  set
    provider_id = coalesce(provider_id, p_provider_email_id),
    status = coalesce(v_status, status),
    failure_code = case
      when p_event_type in ('email.bounced','email.complained','email.failed','email.suppressed') then p_event_type
      else failure_code
    end,
    delivered_at = case
      when p_event_type = 'email.delivered' then coalesce(delivered_at, coalesce(p_occurred_at, now()))
      else delivered_at
    end,
    last_event_at = greatest(coalesce(last_event_at, '-infinity'::timestamptz), coalesce(p_occurred_at, now())),
    updated_at = now()
  where id = v_message.id;

  return query select v_message.id, v_message.app_id;
end;
$$;

create or replace function public.mail_app_tracking_summary(p_app_id text)
returns table(
  app_id text,
  total_30d bigint,
  accepted_30d bigint,
  delivered_30d bigint,
  blocked_30d bigint,
  failed_30d bigint,
  bounced_30d bigint,
  complained_30d bigint,
  p0_24h bigint,
  delivery_rate_30d numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p_app_id,
    count(*) filter (where m.created_at >= now() - interval '30 days')::bigint,
    count(*) filter (where m.created_at >= now() - interval '30 days' and m.provider_id is not null)::bigint,
    count(*) filter (where m.created_at >= now() - interval '30 days' and m.status = 'delivered')::bigint,
    count(*) filter (where m.created_at >= now() - interval '30 days' and m.status = 'blocked')::bigint,
    count(*) filter (where m.created_at >= now() - interval '30 days' and m.status in ('failed','provider_rejected','suppressed'))::bigint,
    count(*) filter (where m.created_at >= now() - interval '30 days' and m.status = 'bounced')::bigint,
    count(*) filter (where m.created_at >= now() - interval '30 days' and m.status = 'complained')::bigint,
    count(*) filter (where m.created_at >= now() - interval '24 hours' and m.priority = 'P0')::bigint,
    round(
      100.0 * count(*) filter (where m.created_at >= now() - interval '30 days' and m.status = 'delivered')
      / nullif(count(*) filter (where m.created_at >= now() - interval '30 days' and m.provider_id is not null), 0),
      2
    )::numeric
  from public.mail_messages m
  where m.app_id = p_app_id;
$$;

-- Keep the existing global dashboard semantically correct now that blocked/rejected
-- attempts are also persisted.
create or replace function public.mail_dashboard_metrics()
returns table (
  accepted bigint,
  delivered bigint,
  bounced bigint,
  complained bigint,
  suppressed bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where m.created_at >= now() - interval '24 hours' and m.provider_id is not null)::bigint,
    count(*) filter (where m.created_at >= now() - interval '24 hours' and m.status = 'delivered')::bigint,
    count(*) filter (where m.created_at >= now() - interval '24 hours' and m.status = 'bounced')::bigint,
    count(*) filter (where m.created_at >= now() - interval '24 hours' and m.status = 'complained')::bigint,
    count(*) filter (where m.created_at >= now() - interval '24 hours' and m.status = 'suppressed')::bigint
  from public.mail_messages m;
$$;

revoke all on function public.mail_begin_tracked_message(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.mail_set_message_result(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.mail_record_tracked_event(text,text,text,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.mail_app_tracking_summary(text) from public, anon, authenticated;

grant execute on function public.mail_begin_tracked_message(uuid,text,text,text,text,text) to service_role;
grant execute on function public.mail_set_message_result(uuid,text,text,text) to service_role;
grant execute on function public.mail_record_tracked_event(text,text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.mail_app_tracking_summary(text) to service_role;
