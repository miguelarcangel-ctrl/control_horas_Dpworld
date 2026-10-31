-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Avisos a elección (ADITIVA)
-- Cada usuario elige con interruptores qué momentos le avisan; el administrador puede elegirlos por cualquier usuario.
-- Sin fila en ch_push_prefs se usan los avisos por omisión de su rol (los define la Edge Function y la app).
-- ch_push_eventos evita que el mismo aviso de producción o turno salga dos veces aunque lo detecten varios equipos.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.ch_push_prefs (
  key         text not null,
  usuario_id  text not null references public.ch_usuarios(id) on delete cascade,
  prefs       jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now(),
  por         text,
  primary key (key, usuario_id)
);
create table if not exists public.ch_push_eventos (
  key    text not null,
  ref    text not null,
  evento text not null,
  creado timestamptz not null default now(),
  primary key (key, ref)
);
alter table public.ch_push_prefs enable row level security;
alter table public.ch_push_eventos enable row level security;
revoke all on table public.ch_push_prefs, public.ch_push_eventos from anon, authenticated;

-- Leer los avisos elegidos (el propio usuario; el administrador, los de cualquiera). null = los de su rol.
create or replace function public.ch_avisos_get(p_token uuid, p_key text, p_usuario text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); uid text := coalesce(nullif(p_usuario,''), u.id);
begin
  perform public.ch_key_ok(p_key);
  if uid <> u.id and u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  return (select prefs from public.ch_push_prefs where key = p_key and usuario_id = uid);
end $$;

-- Guardar los avisos elegidos
create or replace function public.ch_avisos_set(p_token uuid, p_key text, p_usuario text, p_prefs jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); uid text := coalesce(nullif(p_usuario,''), u.id);
begin
  perform public.ch_key_ok(p_key);
  if uid <> u.id and u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  if jsonb_typeof(p_prefs) <> 'object' then raise exception 'DATOS'; end if;
  insert into public.ch_push_prefs (key, usuario_id, prefs, por) values (p_key, uid, p_prefs, u.username)
  on conflict (key, usuario_id) do update set prefs = excluded.prefs, actualizado = now(), por = excluded.por;
end $$;

-- El responsable de línea también puede registrar su celular para avisos
create or replace function public.ch_push_subscribe(p_token uuid, p_key text, p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol not in ('admin','supervisor','responsable') then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  if coalesce(p_endpoint,'') !~ '^https://' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then raise exception 'DATOS'; end if;
  insert into public.ch_push_subs (endpoint, key, usuario_id, p256dh, auth, ua)
  values (p_endpoint, p_key, u.id, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set key = excluded.key, usuario_id = excluded.usuario_id, p256dh = excluded.p256dh,
     auth = excluded.auth, ua = excluded.ua, actualizado = now();
end $$;

grant execute on function public.ch_avisos_get(uuid,text,text), public.ch_avisos_set(uuid,text,text,jsonb) to anon, authenticated;
