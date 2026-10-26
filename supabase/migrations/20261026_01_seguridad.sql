-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Fase 1: seguridad e integridad (ADITIVA)
-- No rompe la app anterior: kv_store sigue abierta hasta el corte
-- (ver 20261026_02_corte.sql).
-- ═══════════════════════════════════════════════════════════════

-- 1) Versionado del estado (evita sobrescrituras silenciosas)
alter table public.kv_store add column if not exists version    bigint      not null default 1;
alter table public.kv_store add column if not exists updated_at timestamptz not null default now();
alter table public.kv_store add column if not exists updated_by text;

-- Cualquier escritura que cambie el valor sin subir versión (app antigua) la sube igual
create or replace function public.ch_kv_bump() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.value is distinct from old.value and new.version = old.version then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;
create or replace trigger ch_kv_bump before update on public.kv_store
  for each row execute function public.ch_kv_bump();

-- 2) Usuarios con contraseña cifrada (bcrypt) y sesiones
create table if not exists public.ch_usuarios (
  id         text primary key,
  username   text not null unique,
  nombre     text not null,
  rol        text not null check (rol in ('admin','supervisor')),
  pass_hash  text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.ch_sesiones (
  token      uuid primary key default extensions.gen_random_uuid(),
  usuario_id text not null references public.ch_usuarios(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table public.ch_usuarios enable row level security;   -- sin políticas: nadie entra directo
alter table public.ch_sesiones enable row level security;
revoke all on table public.ch_usuarios, public.ch_sesiones from anon, authenticated;

-- Migrar los usuarios actuales (mismas claves, ahora cifradas)
insert into public.ch_usuarios (id, username, nombre, rol, pass_hash)
select u->>'id', lower(u->>'username'), u->>'nombre', coalesce(u->>'rol','supervisor'),
       extensions.crypt(u->>'pass', extensions.gen_salt('bf'))
from public.kv_store k, jsonb_array_elements(coalesce(k.value::jsonb->'usuarios','[]'::jsonb)) u
where k.key = 'ctrl_horas' and coalesce(u->>'pass','') <> ''
on conflict (id) do nothing;

-- 3) Funciones (security definer: la única puerta de entrada)
create or replace function public.ch_user(p_token uuid) returns public.ch_usuarios
language plpgsql stable security definer set search_path = public as $$
declare u public.ch_usuarios;
begin
  select us.* into u from public.ch_sesiones s join public.ch_usuarios us on us.id = s.usuario_id
   where s.token = p_token and s.expires_at > now() and us.activo;
  if u.id is null then raise exception 'SESION' using errcode = '28000'; end if;
  return u;
end $$;

create or replace function public.ch_key_ok(p_key text) returns text
language plpgsql immutable as $$
begin
  if p_key not in ('ctrl_horas','ctrl_horas_test') then raise exception 'KEY'; end if;
  return p_key;
end $$;

create or replace function public.ch_login(p_username text, p_pass text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.ch_usuarios; t uuid;
begin
  select * into u from public.ch_usuarios where username = lower(trim(p_username)) and activo;
  if u.id is null or u.pass_hash <> crypt(coalesce(p_pass,''), u.pass_hash) then
    perform pg_sleep(0.6);
    raise exception 'CREDENCIALES' using errcode = '28000';
  end if;
  insert into public.ch_sesiones (usuario_id) values (u.id) returning token into t;
  return jsonb_build_object('token', t, 'user',
    jsonb_build_object('id', u.id, 'username', u.username, 'nombre', u.nombre, 'rol', u.rol));
end $$;

create or replace function public.ch_me(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  return jsonb_build_object('id', u.id, 'username', u.username, 'nombre', u.nombre, 'rol', u.rol);
end $$;

create or replace function public.ch_logout(p_token uuid) returns void
language sql security definer set search_path = public as $$
  update public.ch_sesiones set expires_at = now() where token = p_token;
$$;

create or replace function public.ch_get_state(p_token uuid, p_key text default 'ctrl_horas') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); r record;
begin
  select value, version into r from public.kv_store where key = public.ch_key_ok(p_key);
  if not found then return jsonb_build_object('value', null, 'version', 0); end if;
  return jsonb_build_object('value', r.value::jsonb - 'usuarios', 'version', r.version);
end $$;

create or replace function public.ch_version(p_token uuid, p_key text default 'ctrl_horas') returns bigint
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); v bigint;
begin
  select version into v from public.kv_store where key = public.ch_key_ok(p_key);
  return coalesce(v, 0);
end $$;

-- Guarda solo si nadie guardó antes (version esperada). Nunca escribe 'usuarios'.
create or replace function public.ch_save_state(p_token uuid, p_value jsonb, p_version bigint,
                                                p_key text default 'ctrl_horas') returns bigint
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); cur record; nv bigint;
begin
  select value, version into cur from public.kv_store where key = public.ch_key_ok(p_key) for update;
  if not found then
    if p_version <> 0 then raise exception 'CONFLICT' using errcode = '40001'; end if;
    insert into public.kv_store (key, value, version, updated_by)
    values (p_key, (p_value - 'usuarios')::text, 1, u.username);
    return 1;
  end if;
  if cur.version <> p_version then raise exception 'CONFLICT' using errcode = '40001'; end if;
  nv := cur.version + 1;
  update public.kv_store
     set value = ((p_value - 'usuarios')
                  || case when cur.value::jsonb ? 'usuarios'          -- se conserva hasta el corte
                          then jsonb_build_object('usuarios', cur.value::jsonb->'usuarios')
                          else '{}'::jsonb end)::text,
         version = nv, updated_at = now(), updated_by = u.username
   where key = p_key;
  return nv;
end $$;

-- Pantalla TV: solo lectura, sin usuarios ni solicitudes
create or replace function public.ch_tv_state(p_key text default 'ctrl_horas') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select value::jsonb into v from public.kv_store where key = public.ch_key_ok(p_key);
  if v is null then return null; end if;
  return jsonb_build_object(
    'turno', v->'turno', 'tareasActivas', v->'tareasActivas', 'historial', v->'historial',
    'turnosHistorial', v->'turnosHistorial', 'colaboradores', v->'colaboradores', 'config', v->'config');
end $$;

-- Gestión de usuarios (solo admin)
create or replace function public.ch_list_users(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'username', username, 'nombre', nombre, 'rol', rol)
                    order by nombre) from public.ch_usuarios where activo), '[]'::jsonb);
end $$;

create or replace function public.ch_upsert_user(p_token uuid, p_id text, p_nombre text, p_username text,
                                                 p_rol text, p_pass text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  if coalesce(trim(p_nombre),'') = '' or coalesce(trim(p_username),'') = '' then raise exception 'DATOS'; end if;
  if p_pass is not null and p_pass <> '' and length(p_pass) < 6 then raise exception 'CLAVE_CORTA'; end if;
  if exists (select 1 from public.ch_usuarios where username = lower(trim(p_username)) and activo and id <> coalesce(p_id,'')) then
    raise exception 'USUARIO_EXISTE';
  end if;
  if p_id is null or not exists (select 1 from public.ch_usuarios where id = p_id) then
    if coalesce(p_pass,'') = '' then raise exception 'CLAVE_CORTA'; end if;
    update public.ch_usuarios set username = username || '#' || id where username = lower(trim(p_username)) and not activo;
    insert into public.ch_usuarios (id, username, nombre, rol, pass_hash)
    values (coalesce(p_id, encode(gen_random_bytes(6),'hex')), lower(trim(p_username)), trim(p_nombre), p_rol,
            crypt(p_pass, gen_salt('bf')));
  else
    if p_id = u.id and p_rol <> 'admin' then raise exception 'ULTIMO_ADMIN'; end if;
    update public.ch_usuarios
       set nombre = trim(p_nombre), username = lower(trim(p_username)), rol = p_rol, activo = true,
           pass_hash = case when coalesce(p_pass,'') <> '' then crypt(p_pass, gen_salt('bf')) else pass_hash end
     where id = p_id;
    if coalesce(p_pass,'') <> '' then
      update public.ch_sesiones set expires_at = now() where usuario_id = p_id and usuario_id <> u.id;
    end if;
  end if;
end $$;

-- Desactivar (no borra: conserva trazabilidad)
create or replace function public.ch_disable_user(p_token uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  if p_id = u.id then raise exception 'ULTIMO_ADMIN'; end if;
  update public.ch_usuarios set activo = false where id = p_id;
  update public.ch_sesiones set expires_at = now() where usuario_id = p_id;
end $$;

-- Permisos: solo estas funciones son públicas
revoke execute on function public.ch_user(uuid), public.ch_key_ok(text), public.ch_kv_bump() from public, anon, authenticated;
grant execute on function
  public.ch_login(text,text), public.ch_me(uuid), public.ch_logout(uuid),
  public.ch_get_state(uuid,text), public.ch_version(uuid,text), public.ch_save_state(uuid,jsonb,bigint,text),
  public.ch_tv_state(text), public.ch_list_users(uuid),
  public.ch_upsert_user(uuid,text,text,text,text,text), public.ch_disable_user(uuid,text)
to anon, authenticated;

-- Copia de datos para probar sin tocar la operación (app con ?datos=prueba)
insert into public.kv_store(key,value) select 'ctrl_horas_test', (value::jsonb - 'usuarios')::text
from public.kv_store where key='ctrl_horas' on conflict (key) do nothing;
