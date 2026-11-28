-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — E2 · Archivo mensual (ADITIVA, sin tablas nuevas)
-- Los turnos y líneas cerrados de meses anteriores se mueven a kv_store con llave <llave>_arch_AAAA-MM (comprimidos en el
-- equipo con gzip + base64). La llave principal queda liviana; reportes e indicadores cargan los meses que necesitan.
-- Antes del primer archivo de una llave, el servidor guarda un respaldo completo en ch_respaldos.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_key_ok(p_key text) returns text
language plpgsql immutable set search_path = public as $$
begin
  if p_key not in ('ctrl_horas','ctrl_horas_test') and p_key !~ '^ctrl_horas(_test)?_arch_[0-9]{4}-[0-9]{2}$' then raise exception 'KEY'; end if;
  return p_key;
end $$;

create or replace function public.ch_list_archivos(p_token uuid, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol not in ('admin','supervisor') then raise exception 'PERMISO' using errcode = '42501'; end if;
  if p_key not in ('ctrl_horas','ctrl_horas_test') then raise exception 'KEY'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('mes', right(key, 7), 'bytes', octet_length(value), 'version', version, 'actualizado', updated_at,
            'turnos', (value::jsonb->>'turnos')::int, 'lineas', (value::jsonb->>'lineas')::int) order by key)
     from public.kv_store where left(key, length(p_key) + 6) = p_key || '_arch_'), '[]'::jsonb);
end $$;
grant execute on function public.ch_list_archivos(uuid,text) to anon, authenticated;

create or replace function public.ch_get_archivo(p_token uuid, p_key text, p_mes text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); v text;
begin
  if u.rol not in ('admin','supervisor') then raise exception 'PERMISO' using errcode = '42501'; end if;
  if p_key not in ('ctrl_horas','ctrl_horas_test') or coalesce(p_mes,'') !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'KEY'; end if;
  select value into v from public.kv_store where key = p_key || '_arch_' || p_mes;
  return case when v is null then null else v::jsonb end;
end $$;
grant execute on function public.ch_get_archivo(uuid,text,text) to anon, authenticated;

create or replace function public.ch_save_archivo(p_token uuid, p_key text, p_mes text, p_value text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); k text; nv bigint;
begin
  if u.rol not in ('admin','supervisor') then raise exception 'PERMISO' using errcode = '42501'; end if;
  if p_key not in ('ctrl_horas','ctrl_horas_test') or coalesce(p_mes,'') !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'KEY'; end if;
  perform (p_value::jsonb)->>'fmt';   -- debe ser JSON válido
  k := p_key || '_arch_' || p_mes;
  -- Respaldo completo antes del primer archivo de esta llave
  if not exists (select 1 from public.kv_store where left(key, length(p_key) + 6) = p_key || '_arch_') then
    insert into public.ch_respaldos (key, version, value, motivo)
    select key, version, value, 'Antes del primer archivo mensual (' || p_mes || ', ' || u.username || ')' from public.kv_store where key = p_key;
  end if;
  insert into public.kv_store (key, value, version, updated_by) values (k, p_value, 1, u.username)
  on conflict (key) do update set value = excluded.value, version = public.kv_store.version + 1, updated_at = now(), updated_by = excluded.updated_by
  returning version into nv;
  return nv;
end $$;
grant execute on function public.ch_save_archivo(uuid,text,text,text) to anon, authenticated;
