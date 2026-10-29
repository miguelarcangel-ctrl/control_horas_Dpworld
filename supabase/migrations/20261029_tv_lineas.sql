-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — la pantalla TV también recibe las líneas de producción (ADITIVA)
-- Solo las de hoy (hora de Panamá) y las que siguen en marcha. La versión anterior de la app ignora el dato.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_tv_state(p_key text default 'ctrl_horas') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; hoy text := to_char(now() at time zone 'America/Panama','YYYY-MM-DD');
begin
  select value::jsonb into v from public.kv_store where key = public.ch_key_ok(p_key);
  if v is null then return null; end if;
  return jsonb_build_object(
    'turno', v->'turno', 'tareasActivas', v->'tareasActivas', 'historial', v->'historial',
    'turnosHistorial', v->'turnosHistorial', 'colaboradores', v->'colaboradores', 'config', v->'config',
    'lineas', coalesce((select jsonb_agg(l) from jsonb_array_elements(coalesce(v->'lineas','[]'::jsonb)) l
                        where l->>'estado' = 'corriendo' or l->>'fecha' = hoy), '[]'::jsonb));
end $$;
