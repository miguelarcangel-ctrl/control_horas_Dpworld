-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Fase 1: CORTE (ejecutar DESPUÉS de publicar la nueva app)
-- Cierra el acceso directo a kv_store: desde aquí solo se entra por las funciones ch_*.
-- Las pantallas que aún tengan abierta la versión anterior dejan de guardar:
-- basta recargar la página.
-- Reversible: ver bloque "REVERTIR" al final.
-- ═══════════════════════════════════════════════════════════════

-- 1) Nadie lee ni escribe kv_store directamente con la llave pública
alter policy "allow all" on public.kv_store using (false) with check (false);
revoke all on table public.kv_store from anon, authenticated;

-- 2) Quitar las contraseñas en texto plano del JSON (ya viven cifradas en ch_usuarios)
update public.kv_store set value = (value::jsonb - 'usuarios')::text where value::jsonb ? 'usuarios';

-- REVERTIR (solo si hubiera que volver a la versión anterior de la app):
-- grant select, insert, update, delete on table public.kv_store to anon, authenticated;
-- alter policy "allow all" on public.kv_store using (true) with check (true);
-- (la app anterior requiere además volver a cargar 'usuarios' en el JSON)
