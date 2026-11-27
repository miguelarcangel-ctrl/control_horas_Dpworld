-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — El supervisor también activa la tablet de marcaje (ADITIVA)
-- Con su propio usuario: marca entradas y salidas (ch_marcar, ch_marca_bodega, ch_marca_cliente) y su contraseña
-- desbloquea la tablet para salir o dar de alta (ch_check_pass). El alta de personal ya la tenía (solo personas nuevas).
-- ═══════════════════════════════════════════════════════════════
do $$
declare f text; d text;
begin
  foreach f in array array['public.ch_marcar(uuid,text,text,text,text,text)','public.ch_marca_bodega(uuid,text,bigint,text)','public.ch_marca_cliente(uuid,text,bigint,text)'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(f));
    if position('if u.rol <> ''admin'' then raise exception ''PERMISO''' in d) = 0 then raise exception '% no tiene la validación esperada', f; end if;
    execute replace(d, 'if u.rol <> ''admin'' then raise exception ''PERMISO''', 'if u.rol not in (''admin'',''supervisor'') then raise exception ''PERMISO''');
  end loop;
  d := pg_get_functiondef('public.ch_check_pass(uuid,text)'::regprocedure);
  if position('if u.rol <> ''admin'' then return false;' in d) = 0 then raise exception 'ch_check_pass no tiene la validación esperada'; end if;
  execute replace(d, 'if u.rol <> ''admin'' then return false;', 'if u.rol not in (''admin'',''supervisor'') then return false;');
end $$;
