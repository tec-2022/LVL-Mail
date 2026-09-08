-- LVL Mail Template Studio.
-- Reviewable schema extension only; do not apply until the dedicated LVL Mail
-- Supabase project is selected. Create the real migration with Supabase CLI.

create table if not exists public.mail_template_versions (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.mail_apps(id) on delete cascade,
  template_key text not null check (template_key in ('verify-email','password-reset','otp','transactional-notice','notification')),
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  subject_template text not null,
  preheader_template text not null default '',
  eyebrow_template text not null default '',
  title_template text not null,
  body_template text not null,
  action_label_template text,
  footer_note_template text not null default '',
  change_note text,
  created_by text not null default 'admin',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, template_key, version)
);

create unique index if not exists mail_template_one_published_idx
  on public.mail_template_versions(app_id, template_key)
  where status = 'published';

create index if not exists mail_template_versions_app_key_idx
  on public.mail_template_versions(app_id, template_key, version desc);

alter table public.mail_template_versions enable row level security;
revoke all on table public.mail_template_versions from anon, authenticated;
grant select, insert, update on public.mail_template_versions to service_role;

-- Creating drafts is serialized per app/template to avoid duplicate version numbers.
create or replace function public.mail_create_template_draft(
  p_app_id text,
  p_template_key text,
  p_subject_template text,
  p_preheader_template text,
  p_eyebrow_template text,
  p_title_template text,
  p_body_template text,
  p_action_label_template text,
  p_footer_note_template text,
  p_change_note text,
  p_actor text
)
returns setof public.mail_template_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
  v_row public.mail_template_versions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_app_id || ':' || p_template_key));

  select coalesce(max(version), 0) + 1 into v_version
  from public.mail_template_versions
  where app_id = p_app_id and template_key = p_template_key;

  insert into public.mail_template_versions (
    app_id, template_key, version, status,
    subject_template, preheader_template, eyebrow_template,
    title_template, body_template, action_label_template, footer_note_template,
    change_note, created_by
  ) values (
    p_app_id, p_template_key, v_version, 'draft',
    p_subject_template, coalesce(p_preheader_template,''), coalesce(p_eyebrow_template,''),
    p_title_template, p_body_template, nullif(p_action_label_template,''), coalesce(p_footer_note_template,''),
    nullif(p_change_note,''), coalesce(nullif(p_actor,''),'admin')
  ) returning * into v_row;

  insert into public.mail_audit_log(app_id, action, actor, details)
  values (p_app_id, 'template.draft_created', coalesce(nullif(p_actor,''),'admin'),
    jsonb_build_object('templateKey', p_template_key, 'version', v_version));

  return next v_row;
end;
$$;

create or replace function public.mail_publish_template_version(
  p_app_id text,
  p_template_key text,
  p_version integer,
  p_actor text
)
returns setof public.mail_template_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.mail_template_versions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_app_id || ':' || p_template_key));

  select * into v_row
  from public.mail_template_versions
  where app_id = p_app_id and template_key = p_template_key and version = p_version
  for update;
  if not found then raise exception 'template version not found'; end if;

  update public.mail_template_versions
  set status = 'archived', updated_at = now()
  where app_id = p_app_id and template_key = p_template_key and status = 'published';

  update public.mail_template_versions
  set status = 'published', published_at = now(), updated_at = now()
  where id = v_row.id
  returning * into v_row;

  insert into public.mail_audit_log(app_id, action, actor, details)
  values (p_app_id, 'template.published', coalesce(nullif(p_actor,''),'admin'),
    jsonb_build_object('templateKey', p_template_key, 'version', p_version));

  return next v_row;
end;
$$;

-- Rollback never mutates history backwards: it creates a new published version
-- copied from the selected historical version.
create or replace function public.mail_rollback_template_version(
  p_app_id text,
  p_template_key text,
  p_source_version integer,
  p_actor text
)
returns setof public.mail_template_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.mail_template_versions%rowtype;
  v_new public.mail_template_versions%rowtype;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_app_id || ':' || p_template_key));

  select * into v_source from public.mail_template_versions
  where app_id = p_app_id and template_key = p_template_key and version = p_source_version;
  if not found then raise exception 'source template version not found'; end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.mail_template_versions
  where app_id = p_app_id and template_key = p_template_key;

  update public.mail_template_versions
  set status = 'archived', updated_at = now()
  where app_id = p_app_id and template_key = p_template_key and status = 'published';

  insert into public.mail_template_versions (
    app_id, template_key, version, status,
    subject_template, preheader_template, eyebrow_template,
    title_template, body_template, action_label_template, footer_note_template,
    change_note, created_by, published_at
  ) values (
    p_app_id, p_template_key, v_version, 'published',
    v_source.subject_template, v_source.preheader_template, v_source.eyebrow_template,
    v_source.title_template, v_source.body_template, v_source.action_label_template, v_source.footer_note_template,
    'Rollback desde v' || p_source_version, coalesce(nullif(p_actor,''),'admin'), now()
  ) returning * into v_new;

  insert into public.mail_audit_log(app_id, action, actor, details)
  values (p_app_id, 'template.rollback', coalesce(nullif(p_actor,''),'admin'),
    jsonb_build_object('templateKey', p_template_key, 'sourceVersion', p_source_version, 'newVersion', v_version));

  return next v_new;
end;
$$;

revoke execute on function public.mail_create_template_draft(text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.mail_publish_template_version(text,text,integer,text) from public, anon, authenticated;
revoke execute on function public.mail_rollback_template_version(text,text,integer,text) from public, anon, authenticated;
grant execute on function public.mail_create_template_draft(text,text,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.mail_publish_template_version(text,text,integer,text) to service_role;
grant execute on function public.mail_rollback_template_version(text,text,integer,text) to service_role;

-- Versions and audit entries are append-oriented. We allow status transitions but
-- never delete version rows from application code.
revoke delete on public.mail_template_versions from service_role;
