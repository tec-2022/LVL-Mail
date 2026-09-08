-- LVL Mail enterprise control-plane extension.
-- This is intentionally a reviewable schema patch, not an applied migration.
-- When the dedicated LVL Mail Supabase project is selected, create a real
-- migration with the Supabase CLI, copy this SQL into it, run advisors, then apply.

-- API key lifecycle metadata.
alter table public.mail_app_keys add column if not exists label text not null default 'Production';
alter table public.mail_app_keys add column if not exists expires_at timestamptz;

create table if not exists public.mail_app_policies (
  app_id text primary key references public.mail_apps(id) on delete cascade,
  mode text not null default 'live' check (mode in ('live','test','paused')),
  minute_limit integer not null default 60 check (minute_limit between 1 and 10000),
  daily_limit integer not null default 3000 check (daily_limit between 1 and 10000000),
  p0_reserved_per_minute integer not null default 20 check (p0_reserved_per_minute between 0 and 10000),
  max_consecutive_failures integer not null default 5 check (max_consecutive_failures between 1 and 100),
  circuit_state text not null default 'closed' check (circuit_state in ('closed','open','half_open')),
  failure_streak integer not null default 0 check (failure_streak >= 0),
  circuit_opened_at timestamptz,
  enabled_templates text[] not null default array['verify-email','password-reset','otp','transactional-notice','notification']::text[],
  test_recipient_domains text[] not null default array['resend.dev']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mail_app_template_settings (
  app_id text not null references public.mail_apps(id) on delete cascade,
  template_key text not null,
  enabled boolean not null default true,
  locale text not null default 'es-MX',
  reply_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_id, template_key)
);

create table if not exists public.mail_rate_counters (
  app_id text not null references public.mail_apps(id) on delete cascade,
  window_kind text not null check (window_kind in ('minute','day')),
  window_start timestamptz not null,
  total_count integer not null default 0 check (total_count >= 0),
  p0_count integer not null default 0 check (p0_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (app_id, window_kind, window_start)
);

create table if not exists public.mail_audit_log (
  id uuid primary key default gen_random_uuid(),
  app_id text references public.mail_apps(id) on delete set null,
  action text not null,
  actor text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mail_audit_log_app_time_idx on public.mail_audit_log(app_id, created_at desc);
create index if not exists mail_rate_counters_cleanup_idx on public.mail_rate_counters(window_start);
create index if not exists mail_app_keys_app_revoked_idx on public.mail_app_keys(app_id, revoked_at, created_at desc);

insert into public.mail_app_policies (app_id)
select a.id from public.mail_apps a
on conflict (app_id) do nothing;

insert into public.mail_app_template_settings (app_id, template_key)
select a.id, t.template_key
from public.mail_apps a
cross join (values
  ('verify-email'),
  ('password-reset'),
  ('otp'),
  ('transactional-notice'),
  ('notification')
) as t(template_key)
on conflict (app_id, template_key) do nothing;

-- Atomic persistent rate-limit + mode + circuit-breaker reservation.
-- SECURITY INVOKER is deliberate: the server uses service_role and this function
-- does not need creator privileges. search_path is empty and names are qualified.
create or replace function public.mail_reserve_send_budget(
  p_app_id text,
  p_priority text,
  p_tracking_id uuid,
  p_recipient_domain text
)
returns table (
  allowed boolean,
  reason text,
  mode text,
  circuit_state text,
  minute_used integer,
  minute_limit integer,
  day_used integer,
  daily_limit integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_policy public.mail_app_policies%rowtype;
  v_minute_start timestamptz := date_trunc('minute', now());
  v_day_start timestamptz := date_trunc('day', now());
  v_minute public.mail_rate_counters%rowtype;
  v_day public.mail_rate_counters%rowtype;
  v_noncritical_ceiling integer;
  v_is_p0 boolean := p_priority = 'P0';
begin
  insert into public.mail_app_policies(app_id)
  values (p_app_id)
  on conflict (app_id) do nothing;

  select * into v_policy
  from public.mail_app_policies
  where app_id = p_app_id
  for update;

  if v_policy.mode = 'paused' then
    return query select false, 'app_paused'::text, v_policy.mode, v_policy.circuit_state, 0, v_policy.minute_limit, 0, v_policy.daily_limit;
    return;
  end if;

  if not (p_priority = any(array['P0','P1','P2','P3']::text[])) then
    return query select false, 'invalid_priority'::text, v_policy.mode, v_policy.circuit_state, 0, v_policy.minute_limit, 0, v_policy.daily_limit;
    return;
  end if;

  if v_policy.circuit_state = 'open' then
    if v_policy.circuit_opened_at is null or v_policy.circuit_opened_at > now() - interval '2 minutes' then
      return query select false, 'circuit_open'::text, v_policy.mode, v_policy.circuit_state, 0, v_policy.minute_limit, 0, v_policy.daily_limit;
      return;
    end if;
    update public.mail_app_policies
      set circuit_state = 'half_open', updated_at = now()
      where app_id = p_app_id;
    v_policy.circuit_state := 'half_open';
  end if;

  if v_policy.circuit_state = 'half_open' and not v_is_p0 then
    return query select false, 'circuit_probe_p0_only'::text, v_policy.mode, v_policy.circuit_state, 0, v_policy.minute_limit, 0, v_policy.daily_limit;
    return;
  end if;

  if v_policy.mode = 'test' and not (lower(p_recipient_domain) = any(v_policy.test_recipient_domains)) then
    return query select false, 'test_recipient_not_allowed'::text, v_policy.mode, v_policy.circuit_state, 0, v_policy.minute_limit, 0, v_policy.daily_limit;
    return;
  end if;

  insert into public.mail_rate_counters(app_id, window_kind, window_start)
  values (p_app_id, 'minute', v_minute_start)
  on conflict (app_id, window_kind, window_start) do nothing;

  insert into public.mail_rate_counters(app_id, window_kind, window_start)
  values (p_app_id, 'day', v_day_start)
  on conflict (app_id, window_kind, window_start) do nothing;

  select * into v_minute from public.mail_rate_counters
   where app_id = p_app_id and window_kind = 'minute' and window_start = v_minute_start
   for update;
  select * into v_day from public.mail_rate_counters
   where app_id = p_app_id and window_kind = 'day' and window_start = v_day_start
   for update;

  if v_day.total_count >= v_policy.daily_limit then
    return query select false, 'daily_limit'::text, v_policy.mode, v_policy.circuit_state, v_minute.total_count, v_policy.minute_limit, v_day.total_count, v_policy.daily_limit;
    return;
  end if;

  v_noncritical_ceiling := greatest(v_policy.minute_limit - v_policy.p0_reserved_per_minute, 0);
  if v_is_p0 then
    if v_minute.total_count >= v_policy.minute_limit then
      return query select false, 'minute_limit'::text, v_policy.mode, v_policy.circuit_state, v_minute.total_count, v_policy.minute_limit, v_day.total_count, v_policy.daily_limit;
      return;
    end if;
  elsif v_minute.total_count >= v_noncritical_ceiling then
    return query select false, 'p0_capacity_reserved'::text, v_policy.mode, v_policy.circuit_state, v_minute.total_count, v_policy.minute_limit, v_day.total_count, v_policy.daily_limit;
    return;
  end if;

  update public.mail_rate_counters
    set total_count = total_count + 1,
        p0_count = p0_count + case when v_is_p0 then 1 else 0 end,
        updated_at = now()
    where app_id = p_app_id and window_kind = 'minute' and window_start = v_minute_start
    returning * into v_minute;

  update public.mail_rate_counters
    set total_count = total_count + 1,
        p0_count = p0_count + case when v_is_p0 then 1 else 0 end,
        updated_at = now()
    where app_id = p_app_id and window_kind = 'day' and window_start = v_day_start
    returning * into v_day;

  return query select true, null::text, v_policy.mode, v_policy.circuit_state, v_minute.total_count, v_policy.minute_limit, v_day.total_count, v_policy.daily_limit;
end;
$$;

create or replace function public.mail_record_provider_outcome(
  p_app_id text,
  p_success boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_policy public.mail_app_policies%rowtype;
begin
  select * into v_policy from public.mail_app_policies where app_id = p_app_id for update;
  if not found then return; end if;

  if p_success then
    update public.mail_app_policies
      set failure_streak = 0,
          circuit_state = 'closed',
          circuit_opened_at = null,
          updated_at = now()
      where app_id = p_app_id;
  else
    update public.mail_app_policies
      set failure_streak = failure_streak + 1,
          circuit_state = case when failure_streak + 1 >= max_consecutive_failures then 'open' else circuit_state end,
          circuit_opened_at = case when failure_streak + 1 >= max_consecutive_failures then now() else circuit_opened_at end,
          updated_at = now()
      where app_id = p_app_id;
  end if;
end;
$$;

-- RLS + least privilege. The app server uses service_role only.
alter table public.mail_app_policies enable row level security;
alter table public.mail_app_template_settings enable row level security;
alter table public.mail_rate_counters enable row level security;
alter table public.mail_audit_log enable row level security;

revoke all on table public.mail_app_policies from anon, authenticated;
revoke all on table public.mail_app_template_settings from anon, authenticated;
revoke all on table public.mail_rate_counters from anon, authenticated;
revoke all on table public.mail_audit_log from anon, authenticated;

revoke execute on function public.mail_reserve_send_budget(text,text,uuid,text) from public, anon, authenticated;
revoke execute on function public.mail_record_provider_outcome(text,boolean) from public, anon, authenticated;

grant select, insert, update on public.mail_app_policies to service_role;
grant select, insert, update on public.mail_app_template_settings to service_role;
grant select, insert, update on public.mail_rate_counters to service_role;
grant select, insert on public.mail_audit_log to service_role;
grant select, insert, update on public.mail_app_keys to service_role;
grant execute on function public.mail_reserve_send_budget(text,text,uuid,text) to service_role;
grant execute on function public.mail_record_provider_outcome(text,boolean) to service_role;

-- Audit log is append-only even for the Data API service role.
revoke update, delete on public.mail_audit_log from service_role;
