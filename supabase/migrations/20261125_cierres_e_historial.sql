-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Cierres de días anteriores e historial de guardados (ADITIVA)
-- 1) ch_salida_cierre acepta p_fecha: solo da salida si la entrada abierta de la persona es de ese día.
--    Cerrar a la mañana siguiente una línea o un turno de ayer ya no le marca salida a quien entró hoy.
-- 2) Historial de guardados: cada ch_save_state deja quién, cuándo, desde qué equipo y un resumen
--    (turno abierto y estado de las líneas recientes), para poder reconstruir qué pasó. Se guardan 45 días.
-- ═══════════════════════════════════════════════════════════════
drop function if exists public.ch_salida_cierre(uuid,text,text,timestamptz,text);
create or replace function public.ch_salida_cierre(p_token uuid, p_key text, p_persona text, p_ts timestamptz, p_motivo text default null,
                                                   p_fecha date default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); ult public.ch_marcajes; t timestamptz; nid bigint;
begin
  if u.rol not in ('admin','supervisor','responsable') then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  select * into ult from public.ch_marcajes where key = p_key and persona_id = p_persona and not anulado order by ts desc limit 1;
  if ult.id is null or ult.tipo = 'salida' then return null; end if;          -- ya marcó su salida: nada que hacer
  if p_fecha is not null and ult.fecha <> p_fecha then return null; end if;  -- su entrada abierta es de otro día (por ejemplo, ya entró hoy)
  t := least(now(), greatest(coalesce(p_ts, now()), ult.ts));
  insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, ts, por, motivo, corregido_por, corregido_en, bodega, push_enviado)
  values (p_key, p_persona, ult.nombre, ult.fecha, 'salida', ult.puesto, t, u.username,
          coalesce(nullif(trim(p_motivo),''), 'Salida por cierre de turno sin marcaje'), u.username, now(), ult.bodega, true)
  returning id into nid;
  return nid;
end $$;
grant execute on function public.ch_salida_cierre(uuid,text,text,timestamptz,text,date) to anon, authenticated;

create table if not exists public.ch_kv_historial (
  id bigserial primary key, key text not null, version bigint not null, usuario text, ts timestamptz not null default now(),
  agente text, resumen jsonb);
create index if not exists ch_kv_historial_key_ts on public.ch_kv_historial (key, ts desc);
alter table public.ch_kv_historial enable row level security;   -- sin políticas: solo lo escriben/leen las funciones

create or replace function public.ch_resumen_estado(v jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'turno', case when v->'turno' is null or jsonb_typeof(v->'turno') = 'null' then null
                  else jsonb_build_object('fecha', v->'turno'->>'fecha', 'equipo', jsonb_array_length(coalesce(v->'turno'->'equipo','[]')),
                                          'activas', jsonb_array_length(coalesce(v->'tareasActivas','[]')), 'hist', jsonb_array_length(coalesce(v->'historial','[]'))) end,
    'cerrados', (select count(*) from jsonb_array_elements(coalesce(v->'turnosHistorial','[]'))),
    'lineas', (select coalesce(jsonb_agg(jsonb_build_object('id', l->>'id', 'f', l->>'fecha', 'l', l->>'letra', 'e', l->>'estado',
                                                            'p', jsonb_array_length(coalesce(l->'pallets','[]')), 'n', jsonb_array_length(coalesce(l->'personas','[]')))), '[]'::jsonb)
               from jsonb_array_elements(coalesce(v->'lineas','[]')) l
               where l->>'estado' = 'corriendo' or (l->>'fecha')::date >= (now() at time zone 'America/Panama')::date - 2))
$$;

create or replace function public.ch_save_state(p_token uuid, p_value jsonb, p_version bigint, p_key text default 'ctrl_horas')
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare u public.ch_usuarios := public.ch_user(p_token); cur record; nv bigint; ag text;
begin
  select value, version into cur from public.kv_store where key = public.ch_key_ok(p_key) for update;
  if not found then
    if p_version <> 0 then raise exception 'CONFLICT' using errcode = 'P0001'; end if;
    insert into public.kv_store (key, value, version, updated_by)
    values (p_key, (p_value - 'usuarios')::text, 1, u.username);
    return 1;
  end if;
  if cur.version <> p_version then raise exception 'CONFLICT' using errcode = 'P0001'; end if;
  nv := cur.version + 1;
  update public.kv_store
     set value = ((p_value - 'usuarios')
                  || case when cur.value::jsonb ? 'usuarios'
                          then jsonb_build_object('usuarios', cur.value::jsonb->'usuarios')
                          else '{}'::jsonb end)::text,
         version = nv, updated_at = now(), updated_by = u.username
   where key = p_key;
  -- Historial (si algo falla aquí, el guardado sigue igual)
  begin
    ag := left(coalesce(current_setting('request.headers', true)::json->>'user-agent', ''), 200);
    insert into public.ch_kv_historial (key, version, usuario, agente, resumen) values (p_key, nv, u.username, ag, public.ch_resumen_estado(p_value));
    if random() < 0.01 then delete from public.ch_kv_historial where ts < now() - interval '45 days'; end if;
  exception when others then null;
  end;
  return nv;
end $function$;
