-- LVL Mail internal Identity & Access Management.
-- Reviewable schema extension only. Do not apply until the dedicated LVL Mail
-- Supabase project is selected and the migration is generated through the CLI.
--
-- Identity is verified by Supabase Auth. Authorization is resolved server-side
-- from these tables on every privileged request; roles are not trusted from
-- user_metadata or client-supplied claims.

create table if not exists public.mail_staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null check (role in ('owner','admin','operator','viewer')),
  is_enabled boolean not null default true,
  all_apps boolean not null default true,
  invited_by uuid references public.mail_staff_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create unique index if not exists mail_staff_members_email_unique
  on public.mail_staff_members(lower(email));
create index if not exists mail_staff_members_role_enabled_idx
  on public.mail_staff_members(role, is_enabled);

-- Prepared for a later app-scoped RBAC phase. The current UI only creates
-- global memberships (all_apps=true) until every view is scope-filtered.
create table if not exists public.mail_staff_app_scopes (
  user_id uuid not null references public.mail_staff_members(user_id) on delete cascade,
  app_id text not null references public.mail_apps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, app_id)
);

create table if not exists public.mail_access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  actor_role text,
  permission text not null,
  app_id text references public.mail_apps(id) on delete set null,
  action text not null,
  request_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mail_access_audit_created_idx
  on public.mail_access_audit(created_at desc);
create index if not exists mail_access_audit_actor_idx
  on public.mail_access_audit(actor_user_id, created_at desc);
create index if not exists mail_access_audit_action_idx
  on public.mail_access_audit(action, created_at desc);

alter table public.mail_staff_members enable row level security;
alter table public.mail_staff_app_scopes enable row level security;
alter table public.mail_access_audit enable row level security;

revoke all on table public.mail_staff_members from anon, authenticated;
revoke all on table public.mail_staff_app_scopes from anon, authenticated;
revoke all on table public.mail_access_audit from anon, authenticated;

grant select, insert, update on public.mail_staff_members to service_role;
grant select, insert, delete on public.mail_staff_app_scopes to service_role;
grant select, insert on public.mail_access_audit to service_role;

create or replace function public.mail_staff_context(p_user_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  is_enabled boolean,
  all_apps boolean,
  app_ids text[],
  created_at timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.user_id,
    s.email,
    s.display_name,
    s.role,
    s.is_enabled,
    s.all_apps,
    coalesce(array_agg(sc.app_id order by sc.app_id) filter (where sc.app_id is not null), '{}'::text[]) as app_ids,
    s.created_at,
    s.last_seen_at
  from public.mail_staff_members s
  left join public.mail_staff_app_scopes sc on sc.user_id = s.user_id
  where s.user_id = p_user_id
  group by s.user_id, s.email, s.display_name, s.role, s.is_enabled, s.all_apps, s.created_at, s.last_seen_at;
$$;

create or replace function public.mail_active_owner_count()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::bigint
  from public.mail_staff_members
  where role = 'owner' and is_enabled = true;
$$;

-- Atomic role/status update with last-owner protection. The caller still needs
-- server-side permission checks; this function adds a database invariant.
create or replace function public.mail_update_staff_member(
  p_target_user_id uuid,
  p_role text,
  p_enabled boolean
)
returns setof public.mail_staff_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.mail_staff_members%rowtype;
  v_owner_count bigint;
begin
  if p_role not in ('owner','admin','operator','viewer') then
    raise exception 'invalid staff role';
  end if;

  select * into v_current
  from public.mail_staff_members
  where user_id = p_target_user_id
  for update;

  if v_current.user_id is null then
    raise exception 'staff member not found';
  end if;

  if v_current.role = 'owner' and v_current.is_enabled = true
     and (p_role <> 'owner' or p_enabled = false) then
    select count(*) into v_owner_count
    from public.mail_staff_members
    where role = 'owner' and is_enabled = true;
    if v_owner_count <= 1 then
      raise exception 'cannot remove the last active owner';
    end if;
  end if;

  update public.mail_staff_members
  set role = p_role,
      is_enabled = p_enabled,
      updated_at = now()
  where user_id = p_target_user_id;

  return query select * from public.mail_staff_members where user_id = p_target_user_id;
end;
$$;

create or replace function public.mail_touch_staff(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.mail_staff_members
  set last_seen_at = now()
  where user_id = p_user_id and is_enabled = true;
$$;

revoke execute on function public.mail_staff_context(uuid) from public, anon, authenticated;
revoke execute on function public.mail_active_owner_count() from public, anon, authenticated;
revoke execute on function public.mail_update_staff_member(uuid,text,boolean) from public, anon, authenticated;
revoke execute on function public.mail_touch_staff(uuid) from public, anon, authenticated;

grant execute on function public.mail_staff_context(uuid) to service_role;
grant execute on function public.mail_active_owner_count() to service_role;
grant execute on function public.mail_update_staff_member(uuid,text,boolean) to service_role;
grant execute on function public.mail_touch_staff(uuid) to service_role;

-- No anon/authenticated policies by design. Staff authorization is performed
-- server-side after Supabase Auth identity verification.
