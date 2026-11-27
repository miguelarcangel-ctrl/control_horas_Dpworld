-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Jornada de días sin turno: la hace el servidor solo (ADITIVA)
-- pg_cron corre todos los días a las 17:35 de Panamá (para ese día) y a las 05:05 (para el día anterior, por si
-- algo quedó). La app sigue pidiéndolo también; el resultado es el mismo y no se repite (solo toca a quien no tiene salida).
-- ═══════════════════════════════════════════════════════════════
create extension if not exists pg_cron;

create or replace function public.ch_jornada_sin_turno_srv(p_key text, p_fecha date) returns int
language plpgsql security definer set search_path = public as $$
declare v jsonb; cfg jsonb; hi time; hf time; hs numeric; dow int;
        r record; n int := 0; tini timestamptz; tfin timestamptz; con_alm boolean;
begin
  perform public.ch_key_ok(p_key);
  if p_fecha >= (now() at time zone 'America/Panama')::date and (now() at time zone 'America/Panama')::time < time '17:30' then return 0; end if;
  select value::jsonb into v from public.kv_store where key = p_key;
  -- ¿Hubo turno ese día? Entonces no se toca nada
  if v->'turno'->>'fecha' = p_fecha::text
     or exists (select 1 from jsonb_array_elements(coalesce(v->'turnosHistorial','[]')) t where t->>'fecha' = p_fecha::text) then return 0; end if;
  cfg := coalesce(v->'config','{}');
  hi := coalesce(nullif(cfg->>'horaInicio',''),'08:00')::time; hf := coalesce(nullif(cfg->>'horaFin',''),'17:00')::time;
  dow := extract(dow from p_fecha);
  con_alm := true;
  if dow = 0 then
    if coalesce((cfg->>'horasDomingo')::numeric, 0) <= 0 then return 0; end if;
    hf := hi + make_interval(mins => (coalesce((cfg->>'horasDomingo')::numeric,0)*60)::int); con_alm := false;
  elsif dow = 6 then
    hs := coalesce((cfg->>'horasSabado')::numeric, 4); if hs <= 0 then return 0; end if;
    hf := hi + make_interval(mins => (hs*60)::int); con_alm := false;
  end if;
  tini := (p_fecha + hi) at time zone 'America/Panama'; tfin := (p_fecha + hf) at time zone 'America/Panama';
  for r in
    select distinct on (e.persona_id) e.* from public.ch_marcajes e
     where e.key = p_key and e.fecha = p_fecha and e.tipo = 'entrada' and not e.anulado and e.puesto in ('supervisor','ag','operador')
       and not exists (select 1 from public.ch_marcajes s where s.key = e.key and s.persona_id = e.persona_id and s.fecha = e.fecha and s.tipo = 'salida' and not s.anulado)
     order by e.persona_id, e.ts
  loop
    if r.ts > tini and r.ts < tfin then
      update public.ch_marcajes set ts = tini, corregido_por = 'sistema', corregido_en = now(),
             motivo = coalesce(motivo||' · ','')||'Entrada ajustada a '||to_char(hi,'HH24:MI')||': día sin turno abierto (jornada automática)'
       where id = r.id;
    end if;
    if con_alm and not exists (select 1 from public.ch_marcajes x where x.key = r.key and x.persona_id = r.persona_id and x.fecha = r.fecha and x.tipo like '%almuerzo' and not x.anulado) then
      insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, ts, por, motivo, corregido_por, corregido_en, push_enviado, bodega)
      values (r.key, r.persona_id, r.nombre, r.fecha, 'salida_almuerzo', r.puesto, (p_fecha + time '12:00') at time zone 'America/Panama', 'sistema', 'Almuerzo 12:00–13:00: día sin turno abierto (jornada automática)', 'sistema', now(), true, r.bodega),
             (r.key, r.persona_id, r.nombre, r.fecha, 'regreso_almuerzo', r.puesto, (p_fecha + time '13:00') at time zone 'America/Panama', 'sistema', 'Almuerzo 12:00–13:00: día sin turno abierto (jornada automática)', 'sistema', now(), true, r.bodega);
    end if;
    insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, ts, por, motivo, corregido_por, corregido_en, push_enviado, bodega)
    values (r.key, r.persona_id, r.nombre, r.fecha, 'salida', r.puesto, greatest(tfin, r.ts), 'sistema',
            'Salida '||to_char(hf,'HH24:MI')||': día sin turno abierto (jornada automática)', 'sistema', now(), true, r.bodega);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ch_jornada_sin_turno_srv(text,date) from public, anon, authenticated;

-- La versión con sesión (la que llama la app) usa la misma lógica
create or replace function public.ch_jornada_sin_turno(p_token uuid, p_key text, p_fecha date) returns int
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol not in ('admin','supervisor') then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  return public.ch_jornada_sin_turno_srv(p_key, p_fecha);
end $$;
grant execute on function public.ch_jornada_sin_turno(uuid,text,date) to anon, authenticated;

-- Tareas programadas (hora del servidor en UTC; Panamá = UTC-5, sin horario de verano)
select cron.unschedule(jobid) from cron.job where jobname in ('ch_jornada_sin_turno_hoy','ch_jornada_sin_turno_ayer');
select cron.schedule('ch_jornada_sin_turno_hoy',  '35 22 * * *', $$select public.ch_jornada_sin_turno_srv('ctrl_horas', (now() at time zone 'America/Panama')::date)$$);
select cron.schedule('ch_jornada_sin_turno_ayer', '5 10 * * *',  $$select public.ch_jornada_sin_turno_srv('ctrl_horas', (now() at time zone 'America/Panama')::date - 1)$$);
