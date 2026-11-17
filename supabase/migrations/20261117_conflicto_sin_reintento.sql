-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — CONFLICT sin errcode 40001 (CORRECCIÓN URGENTE)
-- PostgREST reintenta solo y sin límite las transacciones que fallan con 40001 (serialization_failure).
-- Un guardado con versión vieja quedaba en un bucle infinito dentro del servidor, ocupando una conexión
-- del pool; al acumularse varios, el API dejaba de responder (login con "Sin respuesta del servidor").
-- El cliente reconoce el conflicto por el mensaje 'CONFLICT', así que basta con usar el código por defecto.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_save_state(p_token uuid, p_value jsonb, p_version bigint, p_key text default 'ctrl_horas')
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare u public.ch_usuarios := public.ch_user(p_token); cur record; nv bigint;
begin
  select value, version into cur from public.kv_store where key = public.ch_key_ok(p_key) for update;
  if not found then
    if p_version <> 0 then raise exception 'CONFLICT' using errcode = 'P0001'; end if;
    insert into public.kv_store (key, value, version, updated_by)
    values (p_key, (p_value - 'usuarios')::text, 1, u.username);
    return 1;
  end if;
  if cur.version <> p_version then raise exception 'CONFLICT' using errcode = 'P0001'; end if;
  nv := cur.version + 1;
  update public.kv_store
     set value = ((p_value - 'usuarios')
                  || case when cur.value::jsonb ? 'usuarios'
                          then jsonb_build_object('usuarios', cur.value::jsonb->'usuarios')
                          else '{}'::jsonb end)::text,
         version = nv, updated_at = now(), updated_by = u.username
   where key = p_key;
  return nv;
end $function$;
