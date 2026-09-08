-- LVL Mail Search & Recovery.
-- Reviewable schema extension only. Do not apply until the dedicated LVL Mail
-- Supabase project is selected and the migration is generated through the CLI.
--
-- Security model:
-- - RLS enabled on every new table in public.
-- - No anon/authenticated access.
-- - Explicit service_role grants for Data API access.
-- - RPCs use SECURITY INVOKER and are granted only to service_role.

alter table public.mail_messages
  add column if not exists replay_of_message_id uuid references public.mail_messages(id);

create index if not exists mail_messages_replay_parent_idx
  on public.mail_messages(replay_of_message_id)
  where replay_of_message_id is not null;

create table if not exists public.mail_recovery_envelopes (
  message_id uuid primary key references public.mail_messages(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_recovery_envelopes_expiry_idx
  on public.mail_recovery_envelopes(expires_at);

create table if not exists public.mail_replay_audit (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid not null references public.mail_messages(id) on delete restrict,
  replay_message_id uuid not null unique references public.mail_messages(id) on delete restrict,
  actor text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique(source_message_id)
);

create index if not exists mail_replay_audit_created_idx
  on public.mail_replay_audit(created_at desc);

alter table public.mail_recovery_envelopes enable row level security;
alter table public.mail_replay_audit enable row level security;

revoke all on table public.mail_recovery_envelopes from anon, authenticated;
revoke all on table public.mail_replay_audit from anon, authenticated;
grant select, insert, update, delete on public.mail_recovery_envelopes to service_role;
grant select, insert on public.mail_replay_audit to service_role;

-- Exact-match operational search. Recipient lookup uses a SHA-256 hash generated
-- on the server, so the ledger never needs the recipient address in clear text.
create or replace function public.mail_search_messages(
  p_query text,
  p_app_id text,
  p_template_key text,
  p_template_version integer,
  p_status text,
  p_provider_name text,
  p_recipient_hash text,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
returns table (
  id uuid,
  provider_id text,
  provider_name text,
  app_id text,
  template_key text,
  template_source text,
  template_version integer,
  priority text,
  recipient_hash text,
  idempotency_key text,
  status text,
  failure_code text,
  replay_of_message_id uuid,
  created_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  last_event_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id,
    m.provider_id,
    m.provider_name,
    m.app_id,
    m.template_key,
    m.template_source,
    m.template_version,
    m.priority,
    m.recipient_hash,
    m.idempotency_key,
    m.status,
    m.failure_code,
    m.replay_of_message_id,
    m.created_at,
    m.accepted_at,
    m.delivered_at,
    m.last_event_at,
    m.updated_at
  from public.mail_messages m
  where
    (nullif(trim(p_query), '') is null
      or m.id::text = trim(p_query)
      or m.provider_id = trim(p_query)
      or m.idempotency_key = trim(p_query))
    and (nullif(trim(p_app_id), '') is null or m.app_id = trim(p_app_id))
    and (nullif(trim(p_template_key), '') is null or m.template_key = trim(p_template_key))
    and (p_template_version is null or m.template_version = p_template_version)
    and (nullif(trim(p_status), '') is null or m.status = trim(p_status))
    and (nullif(trim(p_provider_name), '') is null or m.provider_name = trim(p_provider_name))
    and (nullif(trim(p_recipient_hash), '') is null or m.recipient_hash = trim(p_recipient_hash))
    and (p_from is null or m.created_at >= p_from)
    and (p_to is null or m.created_at <= p_to)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- Atomically claims a source message for one replay. The unique constraint on
-- source_message_id prevents double clicks or concurrent operators from replaying
-- the same failed email twice.
create or replace function public.mail_claim_replay(
  p_source_message_id uuid,
  p_replay_message_id uuid,
  p_actor text,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.mail_replay_audit (
    source_message_id,
    replay_message_id,
    actor,
    reason
  ) values (
    p_source_message_id,
    p_replay_message_id,
    coalesce(nullif(trim(p_actor), ''), 'lvl-mail-admin'),
    nullif(left(trim(p_reason), 500), '')
  );

  update public.mail_messages
  set replay_of_message_id = p_source_message_id,
      updated_at = now()
  where id = p_replay_message_id;

  return true;
exception
  when unique_violation then
    return false;
end;
$$;

create or replace function public.mail_purge_expired_recovery_envelopes()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count bigint;
begin
  delete from public.mail_recovery_envelopes
  where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mail_search_messages(text,text,text,integer,text,text,text,timestamptz,timestamptz,integer) from public, anon, authenticated;
revoke execute on function public.mail_claim_replay(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.mail_purge_expired_recovery_envelopes() from public, anon, authenticated;

grant execute on function public.mail_search_messages(text,text,text,integer,text,text,text,timestamptz,timestamptz,integer) to service_role;
grant execute on function public.mail_claim_replay(uuid,uuid,text,text) to service_role;
grant execute on function public.mail_purge_expired_recovery_envelopes() to service_role;
