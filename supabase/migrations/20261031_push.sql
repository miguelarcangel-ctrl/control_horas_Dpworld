-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — notificaciones push de llegada (ADITIVA)
-- ch_push_config: claves VAPID; las genera y las lee solo la Edge Function push-marcaje (service role).
-- ch_push_subs: un registro por celular/navegador que activó los avisos (admin y supervisor).
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.ch_push_config (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  creado      timestamptz not null default now()
);
create table if not exists public.ch_push_subs (
  endpoint    text primary key,
  key         text not null default 'ctrl_horas',
  usuario_id  text not null references public.ch_usuarios(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  ua          text,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
alter table public.ch_push_config enable row level security;
alter table public.ch_push_subs enable row level security;
revoke all on table public.ch_push_config, public.ch_push_subs from anon, authenticated;
alter table public.ch_marcajes add column if not exists push_enviado boolean not null default false;

-- Registrar el celular de quien activa los avisos (solo admin y supervisor)
create or replace function public.ch_push_subscribe(p_token uuid, p_key text, p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol not in ('admin','supervisor') then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  if coalesce(p_endpoint,'') !~ '^https://' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then raise exception 'DATOS'; end if;
  insert into public.ch_push_subs (endpoint, key, usuario_id, p256dh, auth, ua)
  values (p_endpoint, p_key, u.id, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set key = excluded.key, usuario_id = excluded.usuario_id, p256dh = excluded.p256dh,
     auth = excluded.auth, ua = excluded.ua, actualizado = now();
end $$;

-- Dejar de recibir en este celular (al salir de la sesión)
create or replace function public.ch_push_unsubscribe(p_token uuid, p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  delete from public.ch_push_subs where endpoint = p_endpoint and usuario_id = u.id;
end $$;

grant execute on function public.ch_push_subscribe(uuid,text,text,text,text,text), public.ch_push_unsubscribe(uuid,text) to anon, authenticated;
