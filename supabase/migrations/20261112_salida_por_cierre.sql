-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Salida por cierre de turno (o de línea) sin marcaje (ADITIVA)
-- Nadie puede quedar «trabajando» si no hay turno: al cerrar el turno o la línea, quien no marcó su salida
-- recibe una salida a la hora del cierre, con el motivo a la vista en la asistencia y la planilla.
-- La pueden registrar administrador, supervisor y responsable de línea (quienes cierran turno o línea).
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_salida_cierre(p_token uuid, p_key text, p_persona text, p_ts timestamptz, p_motivo text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); ult public.ch_marcajes; t timestamptz; nid bigint;
begin
  if u.rol not in ('admin','supervisor','responsable') then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  select * into ult from public.ch_marcajes where key = p_key and persona_id = p_persona and not anulado order by ts desc limit 1;
  if ult.id is null or ult.tipo = 'salida' then return null; end if;          -- ya marcó su salida: nada que hacer
  t := least(now(), greatest(coalesce(p_ts, now()), ult.ts));
  insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, ts, por, motivo, corregido_por, corregido_en, bodega, push_enviado)
  values (p_key, p_persona, ult.nombre, ult.fecha, 'salida', ult.puesto, t, u.username,
          coalesce(nullif(trim(p_motivo),''), 'Salida por cierre de turno sin marcaje'), u.username, now(), ult.bodega, true)
  returning id into nid;
  return nid;
end $$;
grant execute on function public.ch_salida_cierre(uuid,text,text,timestamptz,text) to anon, authenticated;
