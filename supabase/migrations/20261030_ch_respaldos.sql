-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — tabla de respaldos (solo administración de base de datos)
-- La app no tiene acceso: RLS activo, sin políticas y sin permisos para anon/authenticated.
-- Uso: copia íntegra de kv_store antes de una limpieza o cambio masivo.
--   insert into public.ch_respaldos (key, version, value, motivo)
--   select key, version, value, 'motivo' from public.kv_store where key = 'ctrl_horas';
-- Restaurar (sube la versión para que los equipos tomen el estado restaurado):
--   update public.kv_store k set value = r.value, version = k.version + 1, updated_at = now(), updated_by = 'restauracion'
--   from public.ch_respaldos r where r.id = <id> and k.key = r.key;
-- 2026-10-30: respaldos 1 (ctrl_horas_test, v2) y 2 (ctrl_horas, v58) antes de borrar los 39 turnos,
-- 2 solicitudes y 6 planes de turno a pedido del dueño.
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.ch_respaldos (
  id bigserial primary key,
  key text not null,
  version bigint,
  value text not null,
  motivo text,
  creado timestamptz not null default now()
);
alter table public.ch_respaldos enable row level security;
revoke all on table public.ch_respaldos from anon, authenticated;
