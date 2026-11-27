-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — «Ingresar como línea» (ADITIVA)
-- Desde el login, sin usuario: la persona elige su línea y su nombre, confirma con su cédula (la misma del
-- marcaje) y queda en una pantalla que solo cuenta los pallets de esa línea. La sesión de línea no puede ver ni
-- cambiar nada más. Reemplaza al perfil «Líder de línea», que se quita.
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_usuarios drop constraint if exists ch_usuarios_rol_check;
alter table public.ch_usuarios add constraint ch_usuarios_rol_check check (rol in ('admin','supervisor','responsable'));

create table if not exists public.ch_sesiones_linea (
  token uuid primary key default gen_random_uuid(), key text not null, linea_id text not null, persona_id text not null,
  nombre text, creada timestamptz not null default now(), expira timestamptz not null);
alter table public.ch_sesiones_linea enable row level security;   -- sin políticas: solo las funciones

-- Líneas de hoy (o en marcha) con su cuadrilla activa: lo único que se ve antes de confirmar la cédula
create or replace function public.ch_linea_publica(p_key text default 'ctrl_horas') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l->>'id', 'letra', l->>'letra', 'nombre', l->>'nombre', 'estado', l->>'estado',
           'personas', (select coalesce(jsonb_agg(jsonb_build_object('id', p->>'personaId', 'nombre', p->>'nombre') order by p->>'nombre'), '[]'::jsonb)
                        from jsonb_array_elements(coalesce(l->'personas','[]')) p where coalesce(p->>'hasta','') = '' and coalesce(p->>'personaId','') <> ''))
         order by l->>'letra'), '[]'::jsonb)
  from public.kv_store k, jsonb_array_elements(coalesce(k.value::jsonb->'lineas','[]')) l
  where k.key = public.ch_key_ok(p_key) and l->>'estado' <> 'cerrada'
    and (l->>'fecha' = ((now() at time zone 'America/Panama')::date)::text or l->>'estado' = 'corriendo')
$$;
grant execute on function public.ch_linea_publica(text) to anon, authenticated;

create or replace function public.ch_linea_login(p_key text, p_linea text, p_persona text, p_cedula text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare per public.ch_personal; ok boolean; t uuid;
begin
  perform public.ch_key_ok(p_key);
  select exists (select 1 from public.kv_store k, jsonb_array_elements(coalesce(k.value::jsonb->'lineas','[]')) l, jsonb_array_elements(coalesce(l->'personas','[]')) p
                  where k.key = p_key and l->>'id' = p_linea and l->>'estado' <> 'cerrada' and p->>'personaId' = p_persona and coalesce(p->>'hasta','') = '') into ok;
  select * into per from public.ch_personal where key = p_key and id = p_persona and activo;
  if not ok or per.id is null or per.cedula_hash is null or per.cedula_hash <> crypt(public.ch_norm_cedula(p_cedula), per.cedula_hash) then
    perform pg_sleep(0.6); raise exception 'CEDULA' using errcode = '28000';
  end if;
  delete from public.ch_sesiones_linea where expira < now();
  insert into public.ch_sesiones_linea (key, linea_id, persona_id, nombre, expira)
  values (p_key, p_linea, p_persona, per.nombre, ((now() at time zone 'America/Panama')::date + 1 + time '05:00') at time zone 'America/Panama')
  returning token into t;
  return jsonb_build_object('token', t, 'nombre', per.nombre, 'linea', p_linea);
end $$;
grant execute on function public.ch_linea_login(text,text,text,text) to anon, authenticated;

create or replace function public.ch_linea_sesion(p_token uuid) returns public.ch_sesiones_linea
language plpgsql stable security definer set search_path = public as $$
declare s public.ch_sesiones_linea;
begin
  select * into s from public.ch_sesiones_linea where token = p_token and expira > now();
  if s.token is null then raise exception 'SESION' using errcode = '28000'; end if;
  return s;
end $$;
revoke all on function public.ch_linea_sesion(uuid) from public, anon, authenticated;

create or replace function public.ch_linea_estado(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.ch_sesiones_linea := public.ch_linea_sesion(p_token); l jsonb;
begin
  select x into l from public.kv_store k, jsonb_array_elements(coalesce(k.value::jsonb->'lineas','[]')) x where k.key = s.key and x->>'id' = s.linea_id;
  if l is null then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object('existe', true, 'id', l->>'id', 'letra', l->>'letra', 'nombre', l->>'nombre', 'cliente', l->>'cliente', 'estado', l->>'estado',
    'meta', l->'meta', 'inicio', l->'inicio', 'fin', l->'fin', 'pallets', coalesce(l->'pallets','[]'), 'paro', l->'paroActivo', 'almuerzo', l->'almuerzoActivo',
    'personas', (select count(*) from jsonb_array_elements(coalesce(l->'personas','[]')) p where coalesce(p->>'hasta','') = ''), 'quien', s.nombre);
end $$;
grant execute on function public.ch_linea_estado(uuid) to anon, authenticated;

-- Suma o resta pallets a la línea de la sesión (en el estado compartido, con versión nueva)
create or replace function public.ch_linea_pallet(p_token uuid, p_delta int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ch_sesiones_linea := public.ch_linea_sesion(p_token); v jsonb; i int; l jsonb; pal jsonb; n int; nv bigint;
        ahora bigint := (extract(epoch from now())*1000)::bigint;
begin
  if p_delta = 0 or abs(p_delta) > 20 then raise exception 'DATOS'; end if;
  select value::jsonb, version into v, nv from public.kv_store where key = s.key for update;
  select o - 1, x into i, l from jsonb_array_elements(coalesce(v->'lineas','[]')) with ordinality t(x, o) where x->>'id' = s.linea_id;
  if l is null then raise exception 'LINEA'; end if;
  if l->>'estado' <> 'corriendo' then raise exception 'LINEA_NO_CORRE'; end if;
  if coalesce(jsonb_typeof(l->'almuerzoActivo'),'null') <> 'null' then raise exception 'ALMUERZO'; end if;
  pal := coalesce(l->'pallets','[]'); n := jsonb_array_length(pal);
  if p_delta > 0 then
    select pal || coalesce(jsonb_agg(to_jsonb(ahora)), '[]'::jsonb) into pal from generate_series(1, p_delta);
  else
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into pal from jsonb_array_elements(pal) with ordinality t(e, o) where o <= greatest(0, n + p_delta);
  end if;
  v := jsonb_set(v, array['lineas', i::text, 'pallets'], pal);
  update public.kv_store set value = v::text, version = nv + 1, updated_at = now(), updated_by = 'linea:' || coalesce(s.nombre,'')
   where key = s.key;
  begin
    insert into public.ch_kv_historial (key, version, usuario, agente, resumen)
    values (s.key, nv + 1, 'linea:' || coalesce(s.nombre,''), left(coalesce(current_setting('request.headers', true)::json->>'user-agent',''),200), public.ch_resumen_estado(v));
  exception when others then null; end;
  return public.ch_linea_estado(p_token);
end $$;
grant execute on function public.ch_linea_pallet(uuid,int) to anon, authenticated;

create or replace function public.ch_linea_salir(p_token uuid) returns void
language sql security definer set search_path = public as $$ delete from public.ch_sesiones_linea where token = p_token $$;
grant execute on function public.ch_linea_salir(uuid) to anon, authenticated;
