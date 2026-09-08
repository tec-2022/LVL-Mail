-- LVL Mail persistence foundation.
-- Apply only when the dedicated Supabase project for LVL Mail is selected.

create extension if not exists pgcrypto;

create table if not exists public.mail_apps (
  id text primary key,
  name text not null,
  sender_local_part text not null,
  website_url text,
  tagline text,
  accent text not null default '#111827',
  surface text not null default '#f8fafc',
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe for an earlier foundation schema that may already exist.
alter table public.mail_apps add column if not exists website_url text;
alter table public.mail_apps add column if not exists tagline text;
alter table public.mail_apps add column if not exists accent text not null default '#111827';
alter table public.mail_apps add column if not exists surface text not null default '#f8fafc';

create unique index if not exists mail_apps_sender_local_part_unique
  on public.mail_apps (lower(sender_local_part));

insert into public.mail_apps (id, name, sender_local_part, tagline, accent, surface) values
  ('lvltech', 'LVL Tech', 'hola', 'Tecnología que conecta productos y personas.', '#111827', '#f8fafc'),
  ('nexmesa', 'NexMesa', 'nexmesa', 'Tu restaurante, conectado.', '#0f172a', '#f8fafc'),
  ('finlab', 'FINLAB', 'finlab', 'Aprende finanzas practicando.', '#be185d', '#fff7fb'),
  ('cody', 'Cody', 'cody', 'Aprender código, paso a paso.', '#4338ca', '#f5f3ff')
on conflict (id) do update set
  name = excluded.name,
  sender_local_part = excluded.sender_local_part,
  tagline = excluded.tagline,
  accent = excluded.accent,
  surface = excluded.surface,
  updated_at = now();

create table if not exists public.mail_app_keys (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.mail_apps(id) on delete cascade,
  key_prefix text not null unique,
  secret_hash text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mail_app_keys_app_active_idx
  on public.mail_app_keys(app_id, created_at desc)
  where revoked_at is null;

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

-- Atomic onboarding: one RPC creates the app and its first API key together.
create or replace function public.mail_create_app(
  p_id text,
  p_name text,
  p_sender_local_part text,
  p_website_url text,
  p_tagline text,
  p_accent text,
  p_surface text,
  p_key_prefix text,
  p_secret_hash text
)
returns setof public.mail_apps
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[a-z0-9][a-z0-9-]{0,47}$' then
    raise exception 'invalid app id';
  end if;
  if p_sender_local_part !~ '^[a-z0-9][a-z0-9._-]{0,47}$' then
    raise exception 'invalid sender local part';
  end if;
  if char_length(p_name) < 1 or char_length(p_name) > 80 then
    raise exception 'invalid app name';
  end if;
  if p_accent !~ '^#[0-9A-Fa-f]{6}$' or p_surface !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid brand color';
  end if;
  if char_length(p_key_prefix) < 8 or char_length(p_secret_hash) <> 64 then
    raise exception 'invalid application key';
  end if;

  insert into public.mail_apps (
    id, name, sender_local_part, website_url, tagline, accent, surface
  ) values (
    p_id, p_name, p_sender_local_part, p_website_url, p_tagline, p_accent, p_surface
  );

  insert into public.mail_app_keys (app_id, key_prefix, secret_hash)
  values (p_id, p_key_prefix, p_secret_hash);

  return query
    select * from public.mail_apps where id = p_id;
end;
$$;

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
alter table public.mail_app_keys enable row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_events enable row level security;
alter table public.mail_suppressions enable row level security;

revoke all on table public.mail_apps from anon, authenticated;
revoke all on table public.mail_app_keys from anon, authenticated;
revoke all on table public.mail_messages from anon, authenticated;
revoke all on table public.mail_events from anon, authenticated;
revoke all on table public.mail_suppressions from anon, authenticated;
revoke all on function public.mail_create_app(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.mail_dashboard_metrics() from public, anon, authenticated;
revoke all on function public.mail_app_health() from public, anon, authenticated;
grant execute on function public.mail_create_app(text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.mail_dashboard_metrics() to service_role;
grant execute on function public.mail_app_health() to service_role;

-- No public policies by design. All persistence access is server-side through the service role.
