-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Líneas que se cuentan en unidades (ADITIVA)
-- Un tipo de línea puede contarse en pallets (lo normal) o en unidades (p. ej. bandejas armadas).
-- En las de unidades cada registro se guarda como [hora, cantidad] (compacto: +10, +50, +100); «−» deshace el último.
-- ch_linea_estado devuelve la unidad de la línea; ch_linea_pallet la respeta.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_linea_unidad(v jsonb, l jsonb) returns text language sql immutable as $$
  select case when coalesce(l->>'unidad', (select t->>'unidad' from jsonb_array_elements(coalesce(v->'lineasTipo','[]')) t where t->>'id' = l->>'tipoId' limit 1), 'pallet') = 'unidad' then 'unidad' else 'pallet' end
$$;

create or replace function public.ch_linea_estado(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.ch_sesiones_linea := public.ch_linea_sesion(p_token); l jsonb; v jsonb;
begin
  select k.value::jsonb into v from public.kv_store k where k.key = s.key;
  select x into l from jsonb_array_elements(coalesce(v->'lineas','[]')) x where x->>'id' = s.linea_id;
  if l is null then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object('existe', true, 'id', l->>'id', 'letra', l->>'letra', 'nombre', l->>'nombre', 'cliente', l->>'cliente', 'estado', l->>'estado',
    'meta', l->'meta', 'horas', l->'horas', 'inicio', l->'inicio', 'fin', l->'fin', 'pallets', coalesce(l->'pallets','[]'), 'unidad', public.ch_linea_unidad(v, l),
    'paro', l->'paroActivo', 'almuerzo', l->'almuerzoActivo',
    'paros', (select coalesce(jsonb_agg(jsonb_build_object('inicio', p->'inicio', 'fin', p->'fin')), '[]'::jsonb) from jsonb_array_elements(coalesce(l->'paros','[]')) p),
    'almuerzos', (select coalesce(jsonb_agg(jsonb_build_object('inicio', a->'inicio', 'fin', a->'fin')), '[]'::jsonb) from jsonb_array_elements(coalesce(l->'almuerzos','[]')) a),
    'personas', (select count(*) from jsonb_array_elements(coalesce(l->'personas','[]')) p where coalesce(p->>'hasta','') = ''), 'quien', s.nombre);
end $$;
grant execute on function public.ch_linea_estado(uuid) to anon, authenticated;

create or replace function public.ch_linea_pallet(p_token uuid, p_delta int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.ch_sesiones_linea := public.ch_linea_sesion(p_token); v jsonb; i int; l jsonb; pal jsonb; n int; nv bigint; uni boolean; lim int;
        ahora bigint := (extract(epoch from now())*1000)::bigint;
begin
  select value::jsonb, version into v, nv from public.kv_store where key = s.key for update;
  select o - 1, x into i, l from jsonb_array_elements(coalesce(v->'lineas','[]')) with ordinality t(x, o) where x->>'id' = s.linea_id;
  if l is null then raise exception 'LINEA'; end if;
  uni := public.ch_linea_unidad(v, l) = 'unidad';
  lim := case when uni then 500 else 20 end;
  if p_delta = 0 or abs(p_delta) > lim then raise exception 'DATOS'; end if;
  if l->>'estado' <> 'corriendo' then raise exception 'LINEA_NO_CORRE'; end if;
  if coalesce(jsonb_typeof(l->'almuerzoActivo'),'null') <> 'null' then raise exception 'ALMUERZO'; end if;
  pal := coalesce(l->'pallets','[]'); n := jsonb_array_length(pal);
  if uni then
    if p_delta > 0 then pal := pal || jsonb_build_array(jsonb_build_array(ahora, p_delta));
    elsif n > 0 then pal := pal - (n - 1); end if;
  elsif p_delta > 0 then
    select pal || coalesce(jsonb_agg(to_jsonb(ahora)), '[]'::jsonb) into pal from generate_series(1, p_delta);
  else
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into pal from jsonb_array_elements(pal) with ordinality t(e, o) where o <= greatest(0, n + p_delta);
  end if;
  v := jsonb_set(v, array['lineas', i::text, 'pallets'], pal);
  update public.kv_store set value = v::text, version = nv + 1, updated_at = now(), updated_by = 'linea:' || coalesce(s.nombre,'')
   where key = s.key;
  begin
    insert into public.ch_kv_historial (key, version, usuario, agente, resumen)
    values (s.key, nv + 1, 'linea:' || coalesce(s.nombre,''), left(coalesce(current_setting('request.headers', true)::json->>'user-agent',''),200), public.ch_resumen_estado(v));
  exception when others then null; end;
  return public.ch_linea_estado(p_token);
end $$;
grant execute on function public.ch_linea_pallet(uuid, int) to anon, authenticated;
