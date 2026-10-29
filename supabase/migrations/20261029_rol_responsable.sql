-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — rol «Responsable de línea» (ADITIVA)
-- Permite crear usuarios que solo trabajan el módulo de líneas de producción.
-- Las funciones ch_* solo distinguen 'admin'; no requieren cambios.
-- REVERTIR (si no quedan usuarios con ese rol):
--   alter table public.ch_usuarios drop constraint ch_usuarios_rol_check,
--     add constraint ch_usuarios_rol_check check (rol in ('admin','supervisor'));
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_usuarios drop constraint if exists ch_usuarios_rol_check;
alter table public.ch_usuarios add constraint ch_usuarios_rol_check check (rol in ('admin','supervisor','responsable'));
