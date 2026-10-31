-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Marcaje de asistencia (ADITIVA)
-- Personal con cédula cifrada (bcrypt) y marcajes con hora del servidor.
-- Nada de esto vive en kv_store: la cédula nunca viaja a la app ni a la pantalla TV.
-- key separa producción ('ctrl_horas') de la copia de ensayo ('ctrl_horas_test').
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.ch_personal (
  key         text not null default 'ctrl_horas',
  id          text not null,
  nombre      text not null,
  cedula_hash text,
  puesto_def  text check (puesto_def in ('supervisor','operador','ag','linea')),
  activo      boolean not null default true,
  creado      timestamptz not null default now(),
  creado_por  text,
  primary key (key, id)
);
create table if not exists public.ch_marcajes (
  id            bigserial primary key,
  key           text not null default 'ctrl_horas',
  persona_id    text not null,
  nombre        text not null,
  fecha         date not null,
  tipo          text not null check (tipo in ('entrada','salida_almuerzo','regreso_almuerzo','salida')),
  puesto        text check (puesto in ('supervisor','operador','ag','linea')),
  ts            timestamptz not null default now(),
  por           text,
  anulado       boolean not null default false,
  motivo        text,
  corregido_por text,
  corregido_en  timestamptz
);
create index if not exists ch_marcajes_key_fecha on public.ch_marcajes (key, fecha);
create index if not exists ch_marcajes_persona on public.ch_marcajes (key, persona_id, ts);
alter table public.ch_personal enable row level security;
alter table public.ch_marcajes enable row level security;
revoke all on table public.ch_personal, public.ch_marcajes from anon, authenticated;

create or replace function public.ch_norm_cedula(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p,''), '\s', '', 'g')) $$;

-- Lista del personal (sin cédula): cualquier usuario con sesión
create or replace function public.ch_personal_list(p_token uuid, p_key text default 'ctrl_horas') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'puesto_def', puesto_def,
                    'activo', activo, 'tiene_cedula', cedula_hash is not null) order by nombre)
                   from public.ch_personal where key = public.ch_key_ok(p_key)), '[]'::jsonb);
end $$;

-- Alta / edición de personal (solo admin). p_cedula vacía = conservar la actual.
create or replace function public.ch_personal_upsert(p_token uuid, p_key text, p_id text, p_nombre text,
                                                     p_cedula text, p_puesto text, p_activo boolean default true) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare u public.ch_usuarios := public.ch_user(p_token); ced text := public.ch_norm_cedula(p_cedula); nid text; r record;
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  if coalesce(trim(p_nombre),'') = '' then raise exception 'DATOS'; end if;
  if ced <> '' and length(ced) < 4 then raise exception 'CEDULA_CORTA'; end if;
  nid := coalesce(nullif(p_id,''), encode(gen_random_bytes(6),'hex'));
  if ced <> '' then
    for r in select id, cedula_hash from public.ch_personal where key = p_key and id <> nid and cedula_hash is not null loop
      if r.cedula_hash = crypt(ced, r.cedula_hash) then raise exception 'CEDULA_EXISTE'; end if;
    end loop;
  end if;
  insert into public.ch_personal (key, id, nombre, cedula_hash, puesto_def, activo, creado_por)
  values (p_key, nid, trim(p_nombre), case when ced <> '' then crypt(ced, gen_salt('bf')) end, p_puesto, coalesce(p_activo,true), u.username)
  on conflict (key, id) do update set nombre = excluded.nombre, puesto_def = excluded.puesto_def, activo = excluded.activo,
     cedula_hash = case when ced <> '' then excluded.cedula_hash else public.ch_personal.cedula_hash end;
  return nid;
end $$;

-- Marcar (solo con sesión de admin: la tablet en modo marcaje). Hora del servidor.
create or replace function public.ch_marcar(p_token uuid, p_key text, p_persona text, p_cedula text,
                                            p_tipo text, p_puesto text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.ch_usuarios := public.ch_user(p_token); per public.ch_personal; ult public.ch_marcajes;
        hoy date := (now() at time zone 'America/Panama')::date; f date; pu text; m public.ch_marcajes;
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  select * into per from public.ch_personal where key = p_key and id = p_persona and activo;
  if per.id is null or per.cedula_hash is null or per.cedula_hash <> crypt(public.ch_norm_cedula(p_cedula), per.cedula_hash) then
    perform pg_sleep(0.6); raise exception 'CEDULA' using errcode = '28000';
  end if;
  -- Último marcaje de las últimas 20 h (un turno que pasa la medianoche sigue en su fecha)
  select * into ult from public.ch_marcajes where key = p_key and persona_id = p_persona and not anulado
    and ts > now() - interval '20 hours' order by ts desc limit 1;
  if ult.id is not null and ult.tipo <> 'salida' then f := ult.fecha; pu := ult.puesto; else f := hoy; end if;
  if p_tipo = 'entrada' then
    if ult.id is not null and ult.tipo <> 'salida' then raise exception 'SECUENCIA'; end if;
    if p_puesto not in ('supervisor','operador','ag','linea') then raise exception 'PUESTO'; end if;
    pu := p_puesto;
  elsif p_tipo = 'salida_almuerzo' then
    if ult.id is null or ult.tipo not in ('entrada','regreso_almuerzo') then raise exception 'SECUENCIA'; end if;
  elsif p_tipo = 'regreso_almuerzo' then
    if ult.id is null or ult.tipo <> 'salida_almuerzo' then raise exception 'SECUENCIA'; end if;
  elsif p_tipo = 'salida' then
    if ult.id is null or ult.tipo = 'salida' then raise exception 'SECUENCIA'; end if;
  else raise exception 'TIPO'; end if;
  insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, por)
  values (p_key, p_persona, per.nombre, f, p_tipo, pu, u.username) returning * into m;
  return jsonb_build_object('id', m.id, 'persona_id', m.persona_id, 'nombre', m.nombre, 'fecha', m.fecha,
    'tipo', m.tipo, 'puesto', m.puesto, 'ts', m.ts);
end $$;

-- Marcajes de un rango de fechas: cualquier usuario con sesión (el tablero y los avisos los usan)
create or replace function public.ch_marcajes(p_token uuid, p_key text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if p_hasta - p_desde > 62 then raise exception 'RANGO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'persona_id', persona_id, 'nombre', nombre, 'fecha', fecha,
                    'tipo', tipo, 'puesto', puesto, 'ts', ts, 'por', por, 'anulado', anulado, 'motivo', motivo,
                    'corregido_por', corregido_por, 'corregido_en', corregido_en) order by ts)
                   from public.ch_marcajes where key = public.ch_key_ok(p_key) and fecha between p_desde and p_hasta), '[]'::jsonb);
end $$;

-- Corrección o marcaje manual (solo admin, siempre con motivo; queda quién y cuándo)
create or replace function public.ch_marcaje_admin(p_token uuid, p_key text, p_id bigint, p_persona text, p_fecha date,
                                                   p_tipo text, p_ts timestamptz, p_puesto text, p_anulado boolean, p_motivo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); per public.ch_personal; nid bigint;
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  if coalesce(trim(p_motivo),'') = '' then raise exception 'MOTIVO'; end if;
  if p_id is null then
    select * into per from public.ch_personal where key = p_key and id = p_persona;
    if per.id is null then raise exception 'PERSONA'; end if;
    insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, ts, por, motivo, corregido_por, corregido_en)
    values (p_key, p_persona, per.nombre, p_fecha, p_tipo, p_puesto, p_ts, u.username, trim(p_motivo), u.username, now()) returning id into nid;
    return nid;
  end if;
  update public.ch_marcajes set ts = coalesce(p_ts, ts), tipo = coalesce(p_tipo, tipo), puesto = coalesce(p_puesto, puesto),
         anulado = coalesce(p_anulado, anulado), motivo = trim(p_motivo), corregido_por = u.username, corregido_en = now()
   where id = p_id and key = p_key;
  return p_id;
end $$;

-- Confirma la contraseña del usuario de la sesión (salir del modo marcaje, dar de alta desde la tablet)
create or replace function public.ch_check_pass(p_token uuid, p_pass text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol <> 'admin' then return false; end if;
  if u.pass_hash = crypt(coalesce(p_pass,''), u.pass_hash) then return true; end if;
  perform pg_sleep(0.6); return false;
end $$;

revoke execute on function public.ch_norm_cedula(text) from public, anon, authenticated;
grant execute on function
  public.ch_personal_list(uuid,text), public.ch_personal_upsert(uuid,text,text,text,text,text,boolean),
  public.ch_marcar(uuid,text,text,text,text,text), public.ch_marcajes(uuid,text,date,date),
  public.ch_marcaje_admin(uuid,text,bigint,text,date,text,timestamptz,text,boolean,text), public.ch_check_pass(uuid,text)
to anon, authenticated;
