-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — El primer marcaje de un día nuevo es siempre entrada (ADITIVA)
-- Antes, una entrada de ayer sin salida seguía "abierta" hasta 20 h después: quien entró tarde ayer (p. ej. 18:00)
-- llegaba hoy a la tablet y solo podía marcar salida, que quedaba como salida de ayer a las 8 de hoy.
-- Ahora, desde las 5:00 de un día nuevo, la entrada abierta de un día anterior se cierra sola (salida a la hora de
-- salida de ese día, o a la hora de su último marcaje si fue después) y la persona marca su entrada de hoy.
-- Antes de las 5:00 sigue valiendo la regla anterior (un turno que pasa la medianoche sigue en su fecha).
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_marcar(p_token uuid, p_key text, p_persona text, p_cedula text,
                                            p_tipo text, p_puesto text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u public.ch_usuarios := public.ch_user(p_token); per public.ch_personal; ult public.ch_marcajes;
        ahora timestamp := now() at time zone 'America/Panama'; hoy date := (now() at time zone 'America/Panama')::date;
        f date; pu text; m public.ch_marcajes; hfin text; tcierre timestamptz;
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  select * into per from public.ch_personal where key = p_key and id = p_persona and activo;
  if per.id is null or per.cedula_hash is null or per.cedula_hash <> crypt(public.ch_norm_cedula(p_cedula), per.cedula_hash) then
    perform pg_sleep(0.6); raise exception 'CEDULA' using errcode = '28000';
  end if;
  select * into ult from public.ch_marcajes where key = p_key and persona_id = p_persona and not anulado
    and ts > now() - interval '20 hours' order by ts desc limit 1;
  -- Día nuevo (desde las 5:00) con la entrada de un día anterior abierta: se cierra sola y hoy empieza con entrada
  if ult.id is not null and ult.tipo <> 'salida' and ult.fecha < hoy and ahora::time >= time '05:00' then
    if p_tipo <> 'entrada' then raise exception 'SECUENCIA'; end if;
    select coalesce(nullif(value::jsonb->'config'->>'horaFin',''),'17:00') into hfin from public.kv_store where key = p_key;
    tcierre := least(now(), greatest((ult.fecha + coalesce(hfin,'17:00')::time) at time zone 'America/Panama', ult.ts));
    insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, ts, por, motivo, corregido_por, corregido_en, bodega, push_enviado)
    values (p_key, p_persona, per.nombre, ult.fecha, 'salida', ult.puesto, tcierre, u.username,
            'Salida automática: no marcó salida; se cerró al marcar la entrada del día siguiente', u.username, now(), ult.bodega, true);
    ult := null;
  end if;
  if ult.id is not null and ult.tipo <> 'salida' then f := ult.fecha; pu := ult.puesto; else f := hoy; end if;
  if p_tipo = 'entrada' then
    if ult.id is not null and ult.tipo <> 'salida' then raise exception 'SECUENCIA'; end if;
    if p_puesto not in ('supervisor','operador','ag','linea','responsable') then raise exception 'PUESTO'; end if;
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
