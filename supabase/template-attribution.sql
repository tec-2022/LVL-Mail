-- Template attribution for the immutable email ledger.
-- Apply after the mandatory tracking schema.

alter table public.mail_messages add column if not exists template_source text not null default 'base';
alter table public.mail_messages add column if not exists template_version integer;

create index if not exists mail_messages_template_version_idx
  on public.mail_messages(app_id, template_key, template_version, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mail_messages_template_source_check'
  ) then
    alter table public.mail_messages
      add constraint mail_messages_template_source_check
      check (template_source in ('base','published','studio_test'));
  end if;
end $$;

create or replace function public.mail_set_message_template_attribution(
  p_message_id uuid,
  p_source text,
  p_version integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_source not in ('base','published','studio_test') then
    raise exception 'invalid template source';
  end if;
  if p_source = 'published' and (p_version is null or p_version < 1) then
    raise exception 'published template requires version';
  end if;

  update public.mail_messages
  set template_source = p_source,
      template_version = case when p_source = 'published' then p_version else null end,
      updated_at = now()
  where id = p_message_id;

  if not found then raise exception 'tracked message not found'; end if;
end;
$$;

revoke execute on function public.mail_set_message_template_attribution(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.mail_set_message_template_attribution(uuid,text,integer) to service_role;
