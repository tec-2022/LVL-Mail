-- LVL Mail persistence foundation.
-- Apply only when the Supabase project for LVL Mail is selected.

create extension if not exists pgcrypto;

create table if not exists public.mail_apps (
  id text primary key,
  name text not null,
  sender_local_part text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.mail_apps (id, name, sender_local_part) values
  ('lvltech', 'LVL Tech', 'hola'),
  ('nexmesa', 'NexMesa', 'nexmesa'),
  ('finlab', 'FINLAB', 'finlab'),
  ('cody', 'Cody', 'cody')
on conflict (id) do update set
  name = excluded.name,
  sender_local_part = excluded.sender_local_part,
  updated_at = now();

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  provider_id text unique,
  app_id text not null references public.mail_apps(id),
  template_key text not null,
  priority text not null check (priority in ('P0','P1','P2','P3')),
  recipient_hash text not null,
  idempotency_key text not null,
  status text not null default 'accepted',
  created_at timestamptz not null default now(),
  unique(app_id, idempotency_key)
);

create table if not exists public.mail_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text unique not null,
  provider_email_id text,
  message_id uuid references public.mail_messages(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.mail_suppressions (
  id uuid primary key default gen_random_uuid(),
  recipient_hash text not null unique,
  reason text not null,
  source text not null default 'provider',
  created_at timestamptz not null default now()
);

create index if not exists mail_messages_app_created_idx on public.mail_messages(app_id, created_at desc);
create index if not exists mail_messages_provider_idx on public.mail_messages(provider_id);
create index if not exists mail_events_message_idx on public.mail_events(message_id, occurred_at desc);
create index if not exists mail_events_provider_email_idx on public.mail_events(provider_email_id, occurred_at desc);
create index if not exists mail_events_type_time_idx on public.mail_events(event_type, occurred_at desc);

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
    (select count(*) from public.mail_messages m where m.created_at >= now() - interval '24 hours') as accepted,
    count(*) filter (where e.event_type = 'email.delivered') as delivered,
    count(*) filter (where e.event_type = 'email.bounced') as bounced,
    count(*) filter (where e.event_type = 'email.complained') as complained,
    count(*) filter (where e.event_type in ('email.suppressed', 'suppression.added')) as suppressed
  from public.mail_events e
  where e.occurred_at >= now() - interval '24 hours';
$$;

create or replace function public.mail_app_health()
returns table (
  app_id text,
  accepted bigint,
  delivered bigint,
  bounced bigint,
  complained bigint,
  bounce_rate numeric,
  complaint_rate numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with message_totals as (
    select m.app_id, count(*)::bigint as accepted
    from public.mail_messages m
    where m.created_at >= now() - interval '30 days'
    group by m.app_id
  ), event_totals as (
    select
      m.app_id,
      count(distinct e.provider_email_id) filter (where e.event_type = 'email.delivered')::bigint as delivered,
      count(distinct e.provider_email_id) filter (where e.event_type = 'email.bounced')::bigint as bounced,
      count(distinct e.provider_email_id) filter (where e.event_type = 'email.complained')::bigint as complained
    from public.mail_events e
    join public.mail_messages m on m.provider_id = e.provider_email_id
    where e.occurred_at >= now() - interval '30 days'
    group by m.app_id
  )
  select
    a.id as app_id,
    coalesce(mt.accepted, 0)::bigint as accepted,
    coalesce(et.delivered, 0)::bigint as delivered,
    coalesce(et.bounced, 0)::bigint as bounced,
    coalesce(et.complained, 0)::bigint as complained,
    round((100.0 * coalesce(et.bounced, 0) / nullif(coalesce(mt.accepted, 0), 0))::numeric, 3) as bounce_rate,
    round((100.0 * coalesce(et.complained, 0) / nullif(coalesce(mt.accepted, 0), 0))::numeric, 3) as complaint_rate
  from public.mail_apps a
  left join message_totals mt on mt.app_id = a.id
  left join event_totals et on et.app_id = a.id
  order by a.id;
$$;

alter table public.mail_apps enable row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_events enable row level security;
alter table public.mail_suppressions enable row level security;

revoke all on table public.mail_apps from anon, authenticated;
revoke all on table public.mail_messages from anon, authenticated;
revoke all on table public.mail_events from anon, authenticated;
revoke all on table public.mail_suppressions from anon, authenticated;
revoke all on function public.mail_dashboard_metrics() from public, anon, authenticated;
revoke all on function public.mail_app_health() from public, anon, authenticated;
grant execute on function public.mail_dashboard_metrics() to service_role;
grant execute on function public.mail_app_health() to service_role;

-- No public policies by design. All persistence access is server-side through the service role.
