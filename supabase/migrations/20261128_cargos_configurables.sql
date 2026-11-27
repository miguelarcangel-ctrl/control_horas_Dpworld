-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Cargos configurables (ADITIVA)
-- El administrador crea cargos en Configuración → Cargos (se guardan en el estado de la app con su costo por día).
-- El servidor deja de exigir la lista fija de puestos: acepta cualquier clave de cargo (minúsculas, números y _).
-- La jornada automática de días sin turno aplica a todos los cargos menos el personal de línea y el responsable de línea.
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_personal drop constraint if exists ch_personal_puesto_def_check;
alter table public.ch_personal add constraint ch_personal_puesto_def_check check (puesto_def ~ '^[a-z][a-z0-9_]{0,29}$');
alter table public.ch_marcajes drop constraint if exists ch_marcajes_puesto_check;
alter table public.ch_marcajes add constraint ch_marcajes_puesto_check check (puesto ~ '^[a-z][a-z0-9_]{0,29}$');

do $$
declare d text;
begin
  d := pg_get_functiondef('public.ch_marcar(uuid,text,text,text,text,text)'::regprocedure);
  if position('p_puesto not in (''supervisor'',''operador'',''ag'',''linea'',''responsable'')' in d) = 0 then raise exception 'ch_marcar no tiene la validación esperada'; end if;
  execute replace(d, 'p_puesto not in (''supervisor'',''operador'',''ag'',''linea'',''responsable'')', 'coalesce(p_puesto,'''') !~ ''^[a-z][a-z0-9_]{0,29}$''');
  d := pg_get_functiondef('public.ch_jornada_sin_turno_srv(text,date)'::regprocedure);
  if position('e.puesto in (''supervisor'',''ag'',''operador'')' in d) = 0 then raise exception 'ch_jornada_sin_turno_srv no tiene el filtro esperado'; end if;
  execute replace(d, 'e.puesto in (''supervisor'',''ag'',''operador'')', 'e.puesto not in (''linea'',''responsable'')');
end $$;
