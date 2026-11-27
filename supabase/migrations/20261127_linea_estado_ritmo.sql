-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Tarjeta de la línea: datos para el semáforo de productividad (ADITIVA)
-- ch_linea_estado devuelve también las horas planificadas, los paros y los almuerzos de la línea, para comparar
-- los pallets con lo esperado a esta hora (verde, amarillo o rojo).
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_linea_estado(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.ch_sesiones_linea := public.ch_linea_sesion(p_token); l jsonb;
begin
  select x into l from public.kv_store k, jsonb_array_elements(coalesce(k.value::jsonb->'lineas','[]')) x where k.key = s.key and x->>'id' = s.linea_id;
  if l is null then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object('existe', true, 'id', l->>'id', 'letra', l->>'letra', 'nombre', l->>'nombre', 'cliente', l->>'cliente', 'estado', l->>'estado',
    'meta', l->'meta', 'horas', l->'horas', 'inicio', l->'inicio', 'fin', l->'fin', 'pallets', coalesce(l->'pallets','[]'),
    'paro', l->'paroActivo', 'almuerzo', l->'almuerzoActivo',
    'paros', (select coalesce(jsonb_agg(jsonb_build_object('inicio', p->'inicio', 'fin', p->'fin')), '[]'::jsonb) from jsonb_array_elements(coalesce(l->'paros','[]')) p),
    'almuerzos', (select coalesce(jsonb_agg(jsonb_build_object('inicio', a->'inicio', 'fin', a->'fin')), '[]'::jsonb) from jsonb_array_elements(coalesce(l->'almuerzos','[]')) a),
    'personas', (select count(*) from jsonb_array_elements(coalesce(l->'personas','[]')) p where coalesce(p->>'hasta','') = ''), 'quien', s.nombre);
end $$;
grant execute on function public.ch_linea_estado(uuid) to anon, authenticated;
