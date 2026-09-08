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
  provider_event_id text unique,
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
create index if not exists mail_events_message_idx on public.mail_events(message_id, occurred_at desc);

alter table public.mail_apps enable row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_events enable row level security;
alter table public.mail_suppressions enable row level security;

-- No public policies by design. Access should be service-side only until admin auth/RBAC is wired.
