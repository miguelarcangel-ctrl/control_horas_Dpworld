-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Perfil «Líder de línea» (ADITIVA)
-- Al entrar elige su línea y lleva el conteo (pallets, paros, insumos), como el supervisor, solo de esa línea.
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_usuarios drop constraint if exists ch_usuarios_rol_check;
alter table public.ch_usuarios add constraint ch_usuarios_rol_check check (rol in ('admin','supervisor','responsable','lider'));
