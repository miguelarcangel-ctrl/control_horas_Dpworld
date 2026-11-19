-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Almuerzo por grupo (ADITIVA)
-- El personal ya no marca su almuerzo en la tablet: el encargado de la línea (o el supervisor) lo pone a la
-- línea completa, o el supervisor a quienes elija en el turno. Se registra como marcaje de cada persona
-- (salida y regreso de almuerzo), para que las horas pagadas, la asistencia y la planilla lo descuenten.
-- Solo administrador, supervisor y responsable de línea. A quien no le corresponde (no está trabajando,
-- o ya regresó) se le salta sin error.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_almuerzo_grupo(p_token uuid, p_key text, p_personas text[], p_tipo text,
                                                    p_ts timestamptz default null, p_motivo text default null) returns int
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); pid text; ult public.ch_marcajes; t timestamptz; n int := 0;
begin
  if u.rol not in ('admin','supervisor','responsable') then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  if p_tipo not in ('salida_almuerzo','regreso_almuerzo') then raise exception 'TIPO'; end if;
  foreach pid in array coalesce(p_personas, '{}') loop
    select * into ult from public.ch_marcajes where key = p_key and persona_id = pid and not anulado
      and ts > now() - interval '20 hours' order by ts desc limit 1;
    continue when ult.id is null;
    continue when p_tipo = 'salida_almuerzo' and ult.tipo not in ('entrada','regreso_almuerzo');
    continue when p_tipo = 'regreso_almuerzo' and ult.tipo <> 'salida_almuerzo';
    t := least(now(), greatest(coalesce(p_ts, now()), ult.ts));
    insert into public.ch_marcajes (key, persona_id, nombre, fecha, tipo, puesto, ts, por, motivo, bodega, push_enviado)
    values (p_key, pid, ult.nombre, ult.fecha, p_tipo, ult.puesto, t, u.username,
            coalesce(nullif(trim(p_motivo),''), 'Almuerzo registrado por ' || u.username), ult.bodega, true);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.ch_almuerzo_grupo(uuid,text,text[],text,timestamptz,text) to anon, authenticated;
