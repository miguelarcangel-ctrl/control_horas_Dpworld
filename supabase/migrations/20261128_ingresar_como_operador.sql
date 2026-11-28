-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — «Ingresar como operador» (ADITIVA)
-- Desde el login, sin usuario: el operador o ayudante elige su nombre (de quienes están en el turno abierto),
-- confirma con su cédula y queda en una pantalla que solo muestra SU tarea en curso (la que le asignó el supervisor)
-- y le deja sumar la cantidad de sus movimientos. No ve ni cambia nada más.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.ch_sesiones_operador (
  token uuid primary key default gen_random_uuid(), key text not null, persona_id text not null,
  nombre text, creada timestamptz not null default now(), expira timestamptz not null);
alter table public.ch_sesiones_operador enable row level security;   -- sin políticas: solo las funciones

-- Operadores y ayudantes del turno abierto: lo único que se ve antes de confirmar la cédula
create or replace function public.ch_operador_publica(p_key text default 'ctrl_horas') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c->>'id', 'nombre', c->>'nombre', 'cargo', c->>'cargo') order by c->>'nombre'), '[]'::jsonb)
  from public.kv_store k, jsonb_array_elements(coalesce(k.value::jsonb->'turno'->'equipo','[]')) c
  where k.key = public.ch_key_ok(p_key) and c->>'cargo' in ('operador','ag')
$$;
grant execute on function public.ch_operador_publica(text) to anon, authenticated;

create or replace function public.ch_operador_login(p_key text, p_persona text, p_cedula text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare per public.ch_personal; ok boolean; t uuid;
begin
  perform public.ch_key_ok(p_key);
  select exists (select 1 from public.kv_store k, jsonb_array_elements(coalesce(k.value::jsonb->'turno'->'equipo','[]')) c
                  where k.key = p_key and c->>'id' = p_persona) into ok;
  select * into per from public.ch_personal where key = p_key and id = p_persona and activo;
  if not ok or per.id is null or per.cedula_hash is null or per.cedula_hash <> crypt(public.ch_norm_cedula(p_cedula), per.cedula_hash) then
    perform pg_sleep(0.6); raise exception 'CEDULA' using errcode = '28000';
  end if;
  delete from public.ch_sesiones_operador where expira < now();
  insert into public.ch_sesiones_operador (key, persona_id, nombre, expira)
  values (p_key, p_persona, per.nombre, ((now() at time zone 'America/Panama')::date + 1 + time '05:00') at time zone 'America/Panama')
  returning token into t;
  return jsonb_build_object('token', t, 'nombre', per.nombre, 'persona', p_persona);
end $$;
grant execute on function public.ch_operador_login(text,text,text) to anon, authenticated;

create or replace function public.ch_operador_sesion(p_token uuid) returns public.ch_sesiones_operador
language plpgsql stable security definer set search_path = public as $$
declare s public.ch_sesiones_operador;
begin
  select * into s from public.ch_sesiones_operador where token = p_token and expira > now();
  if s.token is null then raise exception 'SESION' using errcode = '28000'; end if;
  return s;
end $$;
revoke all on function public.ch_operador_sesion(uuid) from public, anon, authenticated;

-- Su tarea en curso (si la tiene) con lo que lleva contado
create or replace function public.ch_operador_estado(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.ch_sesiones_operador := public.ch_operador_sesion(p_token); v jsonb; a jsonb; tc jsonb;
begin
  select k.value::jsonb into v from public.kv_store k where k.key = s.key;
  if coalesce(jsonb_typeof(v->'turno'),'null') = 'null' then return jsonb_build_object('turno', false, 'quien', s.nombre); end if;
  select x into a from jsonb_array_elements(coalesce(v->'tareasActivas','[]')) x
   where exists (select 1 from jsonb_array_elements(coalesce(x->'colaboradores','[]')) c where c->>'id' = s.persona_id) limit 1;
  if a is not null then select t into tc from jsonb_array_elements(coalesce(v->'tareasCat','[]')) t where t->>'id' = a->>'tareaId' limit 1; end if;
  return jsonb_build_object('turno', true, 'quien', s.nombre,
    'enTurno', exists (select 1 from jsonb_array_elements(coalesce(v->'turno'->'equipo','[]')) c where c->>'id' = s.persona_id),
    'tarea', case when a is null then null else jsonb_build_object('id', a->>'id', 'tarea', a->>'tarea', 'cliente', a->>'cliente', 'unidad', a->>'unidad',
      'inicio', a->'inicio', 'cant', coalesce(a->'cantAcum','0'::jsonb), 'cantTs', a->'cantTs', 'especial', coalesce(a->'isEspecial','false'::jsonb),
      'causa', a->>'causa', 'sinProd', coalesce(a->'sinProd','false'::jsonb), 'personas', jsonb_array_length(coalesce(a->'colaboradores','[]')),
      'prod', coalesce(tc->'prod', a->'prod'), 'efic', tc->'efic') end);
end $$;
grant execute on function public.ch_operador_estado(uuid) to anon, authenticated;

-- Suma o resta a la cantidad de su tarea en curso (en el estado compartido, con versión nueva)
create or replace function public.ch_operador_cant(p_token uuid, p_delta int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ch_sesiones_operador := public.ch_operador_sesion(p_token); v jsonb; i int; a jsonb; nv bigint;
begin
  if p_delta = 0 or abs(p_delta) > 50 then raise exception 'DATOS'; end if;
  select value::jsonb, version into v, nv from public.kv_store where key = s.key for update;
  select o - 1, x into i, a from jsonb_array_elements(coalesce(v->'tareasActivas','[]')) with ordinality t(x, o)
   where exists (select 1 from jsonb_array_elements(coalesce(x->'colaboradores','[]')) c where c->>'id' = s.persona_id) limit 1;
  if a is null then raise exception 'SIN_TAREA'; end if;
  if coalesce((a->>'isEspecial')::boolean, false) then raise exception 'PAUSA'; end if;
  v := jsonb_set(v, array['tareasActivas', i::text, 'cantAcum'], to_jsonb(greatest(0, coalesce((a->>'cantAcum')::numeric, 0) + p_delta)));
  v := jsonb_set(v, array['tareasActivas', i::text, 'cantTs'], to_jsonb((extract(epoch from now())*1000)::bigint));
  update public.kv_store set value = v::text, version = nv + 1, updated_at = now(), updated_by = 'operador:' || coalesce(s.nombre,'') where key = s.key;
  begin
    insert into public.ch_kv_historial (key, version, usuario, agente, resumen)
    values (s.key, nv + 1, 'operador:' || coalesce(s.nombre,''), left(coalesce(current_setting('request.headers', true)::json->>'user-agent',''),200), public.ch_resumen_estado(v));
  exception when others then null; end;
  return public.ch_operador_estado(p_token);
end $$;
grant execute on function public.ch_operador_cant(uuid,int) to anon, authenticated;

create or replace function public.ch_operador_salir(p_token uuid) returns void
language sql security definer set search_path = public as $$ delete from public.ch_sesiones_operador where token = p_token $$;
grant execute on function public.ch_operador_salir(uuid) to anon, authenticated;
