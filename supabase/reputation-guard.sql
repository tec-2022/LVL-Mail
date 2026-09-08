-- LVL Mail automatic reputation guard.
-- Reviewable schema patch. Convert to a real Supabase CLI migration before apply.

alter table public.mail_app_policies add column if not exists reputation_state text not null default 'healthy' check (reputation_state in ('healthy','watch','restricted'));
alter table public.mail_app_policies add column if not exists reputation_reason text;
alter table public.mail_app_policies add column if not exists reputation_updated_at timestamptz;

create or replace function public.mail_evaluate_reputation(p_app_id text)
returns table (
  app_id text,
  reputation_state text,
  reputation_reason text,
  reputation_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_accepted bigint := 0;
  v_bounced bigint := 0;
  v_complained bigint := 0;
  v_bounce_rate numeric := 0;
  v_complaint_rate numeric := 0;
  v_state text := 'healthy';
  v_reason text := null;
begin
  select count(*) into v_accepted
  from public.mail_messages m
  where m.app_id = p_app_id
    and m.provider_id is not null
    and m.created_at >= now() - interval '24 hours';

  select
    count(distinct e.provider_email_id) filter (where e.event_type = 'email.bounced'),
    count(distinct e.provider_email_id) filter (where e.event_type = 'email.complained')
  into v_bounced, v_complained
  from public.mail_events e
  join public.mail_messages m on m.id = e.message_id
  where m.app_id = p_app_id
    and e.occurred_at >= now() - interval '24 hours';

  if v_accepted > 0 then
    v_bounce_rate := (100.0 * v_bounced / v_accepted)::numeric;
    v_complaint_rate := (100.0 * v_complained / v_accepted)::numeric;
  end if;

  if (v_accepted >= 100 and v_complaint_rate >= 0.05)
     or (v_accepted >= 100 and v_bounce_rate >= 3.0)
     or (v_accepted < 100 and v_complained >= 2) then
    v_state := 'restricted';
    v_reason := case
      when v_complained >= 2 or v_complaint_rate >= 0.05 then 'complaint_rate'
      else 'bounce_rate'
    end;
  elsif (v_accepted >= 50 and v_complaint_rate >= 0.03)
     or (v_accepted >= 50 and v_bounce_rate >= 2.0)
     or (v_complained >= 1)
     or (v_bounced >= 3) then
    v_state := 'watch';
    v_reason := case
      when v_complained >= 1 or v_complaint_rate >= 0.03 then 'complaint_rate'
      else 'bounce_rate'
    end;
  end if;

  update public.mail_app_policies
  set reputation_state = v_state,
      reputation_reason = v_reason,
      reputation_updated_at = now(),
      updated_at = now()
  where mail_app_policies.app_id = p_app_id;

  return query
  select p.app_id, p.reputation_state, p.reputation_reason, p.reputation_updated_at
  from public.mail_app_policies p
  where p.app_id = p_app_id;
end;
$$;

revoke execute on function public.mail_evaluate_reputation(text) from public, anon, authenticated;
grant execute on function public.mail_evaluate_reputation(text) to service_role;
