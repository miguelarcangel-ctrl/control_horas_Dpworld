-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — La Vista TV es solo para el administrador
-- Se elimina la lectura anónima (ch_tv_state): la pantalla TV entra con sesión de administrador
-- y lee con ch_get_state como el resto de la app. Sin sesión no se entrega ningún dato.
-- ═══════════════════════════════════════════════════════════════
revoke execute on function public.ch_tv_state(text) from public, anon, authenticated;
drop function if exists public.ch_tv_state(text);
