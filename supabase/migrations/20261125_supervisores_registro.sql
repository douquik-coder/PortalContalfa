-- Portal Contalfa: rol supervisor, registro con código y límite de intentos.
-- Solo agrega cosas; no borra datos. Pegar completo en Supabase > SQL Editor > Run.
alter table public.profiles add column if not exists supervisor_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists departamento text not null default '';
alter table public.profiles add column if not exists origen text not null default 'admin';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array['admin','supervisor','analista']));
create index if not exists profiles_supervisor_idx on public.profiles(supervisor_id);

create or replace function public.manages(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles me join public.profiles t on t.supervisor_id = me.id
    where me.id = auth.uid() and me.role = 'supervisor' and me.active and t.id = uid);
$$;
create or replace function public.self_service() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.origen = 'registro');
$$;
revoke all on function public.manages(uuid) from public, anon;
revoke all on function public.self_service() from public, anon;
grant execute on function public.manages(uuid) to authenticated;
grant execute on function public.self_service() to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()) or public.manages(id));

drop policy if exists access_read on public.tool_access;
create policy access_read on public.tool_access for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()) or public.manages(user_id));
drop policy if exists access_admin_ins on public.tool_access;
create policy access_admin_ins on public.tool_access for insert to authenticated
  with check ((select public.is_admin())
    or (public.manages(user_id) and public.has_tool(tool_slug))
    or (user_id = (select auth.uid()) and (select public.self_service())));
drop policy if exists access_admin_del on public.tool_access;
create policy access_admin_del on public.tool_access for delete to authenticated
  using ((select public.is_admin())
    or (public.manages(user_id) and public.has_tool(tool_slug))
    or (user_id = (select auth.uid()) and (select public.self_service())));

create table if not exists public.signup_attempts (id bigserial primary key, ip text not null, ok boolean not null default false, at timestamptz not null default now());
alter table public.signup_attempts enable row level security;
create index if not exists signup_attempts_ip_at on public.signup_attempts(ip, at);

insert into public.app_secrets(key, value) values ('signup_code', 'CONTALFA2026'), ('signup_enabled', 'true')
on conflict (key) do nothing;
