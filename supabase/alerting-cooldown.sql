-- LVL Mail alert cooldown enforcement.
-- Apply after supabase/alerting.sql when production migrations are generated.
--
-- Cooldown intentionally applies only to repeated `opened` notifications for
-- the same rule + application + incident type. Escalations and recovery/resolved
-- transitions always bypass cooldown so operationally important state changes
-- are never hidden.

create or replace function public.mail_apply_alert_cooldown()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.mail_alert_rules%rowtype;
  v_event public.mail_alert_events%rowtype;
  v_incident_type text;
  v_recent boolean := false;
begin
  select * into v_rule
  from public.mail_alert_rules
  where id = new.rule_id;

  if v_rule.id is null or v_rule.cooldown_seconds <= 0 then
    return new;
  end if;

  select * into v_event
  from public.mail_alert_events
  where id = new.alert_event_id;

  -- Escalations and recovery/resolution must never be hidden by cooldown.
  if v_event.id is null or v_event.event_type <> 'opened' then
    return new;
  end if;

  select i.incident_type into v_incident_type
  from public.mail_incidents i
  where i.id = v_event.incident_id;

  select exists (
    select 1
    from public.mail_alert_deliveries d
    join public.mail_alert_events e on e.id = d.alert_event_id
    join public.mail_incidents i on i.id = e.incident_id
    where d.rule_id = new.rule_id
      and e.event_type = 'opened'
      and e.app_id = v_event.app_id
      and i.incident_type = v_incident_type
      and d.status <> 'suppressed'
      and d.created_at >= coalesce(new.created_at, now()) - make_interval(secs => v_rule.cooldown_seconds)
  ) into v_recent;

  if v_recent then
    new.status := 'suppressed';
    new.last_error := 'cooldown_active';
    new.next_attempt_at := coalesce(new.next_attempt_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists mail_alert_delivery_cooldown_trigger on public.mail_alert_deliveries;
create trigger mail_alert_delivery_cooldown_trigger
before insert on public.mail_alert_deliveries
for each row execute function public.mail_apply_alert_cooldown();

revoke execute on function public.mail_apply_alert_cooldown() from public, anon, authenticated;
grant execute on function public.mail_apply_alert_cooldown() to service_role;
