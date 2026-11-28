-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — T1 · Uso de la app (ADITIVA)
-- Cada guardado anota cuántos bytes pesa el estado (para ver el crecimiento) y una función solo para el administrador
-- resume espacio, adopción por usuario y marcajes por día. No agrega nada al JSON del estado.
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_kv_historial add column if not exists bytes int;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.ch_save_state(uuid,jsonb,bigint,text)'::regprocedure);
  if position('bytes' in d) > 0 then return; end if;
  if position('insert into public.ch_kv_historial (key, version, usuario, agente, resumen) values (p_key, nv, u.username, ag, public.ch_resumen_estado(p_value));' in d) = 0 then
    raise exception 'ch_save_state no tiene el insert esperado'; end if;
  execute replace(d, 'insert into public.ch_kv_historial (key, version, usuario, agente, resumen) values (p_key, nv, u.username, ag, public.ch_resumen_estado(p_value));',
                     'insert into public.ch_kv_historial (key, version, usuario, agente, resumen, bytes) values (p_key, nv, u.username, ag, public.ch_resumen_estado(p_value), octet_length(p_value::text));');
end $$;

create or replace function public.ch_uso(p_token uuid, p_key text, p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); dias int := greatest(1, least(coalesce(p_dias,30), 45));
        desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias,30), 45)));
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  return jsonb_build_object(
    'dias', dias,
    'bytes', (select octet_length(value) from public.kv_store where key = p_key),
    'version', (select version from public.kv_store where key = p_key),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'bytes', b, 'guardados', n) order by d), '[]'::jsonb)
              from (select (ts at time zone 'America/Panama')::date d, max(bytes) b, count(*) n from public.ch_kv_historial
                     where key = p_key and ts >= desde group by 1) x),
    'usuarios', (select coalesce(jsonb_agg(jsonb_build_object('usuario', us.username, 'nombre', us.nombre, 'rol', us.rol,
                   'ultimoIngreso', (select max(se.created_at) from public.ch_sesiones se where se.usuario_id = us.id),
                   'ultimoGuardado', h.ultimo, 'dias', coalesce(h.dias,0), 'g7', coalesce(h.g7,0), 'g', coalesce(h.g,0),
                   'celular', coalesce(h.celular,0), 'tablet', coalesce(h.tablet,0), 'pc', coalesce(h.pc,0)) order by h.ultimo desc nulls last), '[]'::jsonb)
                 from public.ch_usuarios us
                 left join (select usuario, max(ts) ultimo, count(distinct (ts at time zone 'America/Panama')::date) dias,
                                   count(*) filter (where ts >= now() - interval '7 days') g7, count(*) g,
                                   count(*) filter (where agente ~* '(ipad|tablet)' or (agente ~* 'android' and agente !~* 'mobile')) tablet,
                                   count(*) filter (where agente ~* 'mobi' and agente !~* '(ipad|tablet)') celular,
                                   count(*) filter (where coalesce(agente,'') !~* '(mobi|ipad|tablet|android)') pc
                              from public.ch_kv_historial where key = p_key and ts >= desde group by usuario) h on h.usuario = us.username
                 where us.activo),
    'marcajes', (select coalesce(jsonb_agg(jsonb_build_object('dia', fecha, 'n', n, 'auto', a) order by fecha), '[]'::jsonb)
                 from (select fecha, count(*) n, count(*) filter (where motivo ilike 'Salida automática%') a from public.ch_marcajes
                        where key = p_key and not anulado and fecha >= (desde at time zone 'America/Panama')::date group by fecha) m));
end $$;
grant execute on function public.ch_uso(uuid,text,int) to anon, authenticated;
