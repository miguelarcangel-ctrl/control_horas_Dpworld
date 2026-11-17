-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — La sesión se renueva sola con el uso
-- Mientras la app se use, la sesión no vence: ch_version (la app la consulta cada 20 s) la extiende a 180 días
-- cuando le quedan menos de 170 (a lo sumo una escritura cada ~10 días por equipo).
-- Los avisos push no dependen de la sesión: llegan al celular registrado aunque la app esté cerrada.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_version(p_token uuid, p_key text default 'ctrl_horas') returns bigint
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); v bigint;
begin
  update public.ch_sesiones set expires_at = now() + interval '180 days'
   where token = p_token and expires_at < now() + interval '170 days';
  select version into v from public.kv_store where key = public.ch_key_ok(p_key);
  return coalesce(v, 0);
end $$;
