-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Marcaje: posición «Responsable de línea» (ADITIVA)
-- El responsable de línea también marca su entrada, almuerzo y salida.
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_personal drop constraint if exists ch_personal_puesto_def_check;
alter table public.ch_personal add constraint ch_personal_puesto_def_check
  check (puesto_def in ('supervisor','operador','ag','linea','responsable'));
alter table public.ch_marcajes drop constraint if exists ch_marcajes_puesto_check;
alter table public.ch_marcajes add constraint ch_marcajes_puesto_check
  check (puesto in ('supervisor','operador','ag','linea','responsable'));

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

