-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — La pantalla TV (?tv=1, sin usuario) no recibe costos
-- Se quitan las tarifas de la configuración y el histórico de turnos (solo lo usaba Analytics,
-- que ya no se muestra en la TV). Lo demás queda igual: turno en vivo, tareas y líneas de hoy.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_tv_state(p_key text default 'ctrl_horas') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; hoy text := to_char(now() at time zone 'America/Panama','YYYY-MM-DD');
begin
  select value::jsonb into v from public.kv_store where key = public.ch_key_ok(p_key);
  if v is null then return null; end if;
  return jsonb_build_object(
    'turno', v->'turno', 'tareasActivas', v->'tareasActivas', 'historial', v->'historial',
    'turnosHistorial', '[]'::jsonb,
    'colaboradores', coalesce((select jsonb_agg(jsonb_build_object('id', c->'id', 'nombre', c->'nombre', 'cargo', c->'cargo'))
                               from jsonb_array_elements(coalesce(v->'colaboradores','[]'::jsonb)) c), '[]'::jsonb),
    'config', coalesce(v->'config','{}'::jsonb) - 'tarifaOperador' - 'tarifaAG' - 'tarifaSupervisor' - 'factorCarga',
    'lineas', coalesce((select jsonb_agg(l) from jsonb_array_elements(coalesce(v->'lineas','[]'::jsonb)) l
                        where l->>'estado' = 'corriendo' or l->>'fecha' = hoy), '[]'::jsonb));
end $$;
