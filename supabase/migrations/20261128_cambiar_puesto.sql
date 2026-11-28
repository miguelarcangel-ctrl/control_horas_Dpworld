-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — El supervisor cambia la posición del día de una persona (ADITIVA)
-- Ej.: marcó como operador o ayudante general y en realidad va a la línea (o al revés). Cambia el puesto de sus marcas
-- de ese día y deja registro de quién lo cambió y por qué.
-- ═══════════════════════════════════════════════════════════════
create or replace function public.ch_cambiar_puesto(p_token uuid, p_key text, p_persona text, p_fecha date, p_puesto text, p_motivo text default null)
returns int language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token); n int;
begin
  if u.rol not in ('admin','supervisor') then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  if coalesce(p_puesto,'') !~ '^[a-z][a-z0-9_]{0,29}$' then raise exception 'PUESTO'; end if;
  update public.ch_marcajes set puesto = p_puesto, corregido_por = u.username, corregido_en = now(),
         motivo = coalesce(motivo||' · ','') || coalesce(nullif(trim(p_motivo),''), 'Posición cambiada a '||p_puesto||' por '||u.username)
   where key = p_key and persona_id = p_persona and fecha = p_fecha and not anulado and puesto is distinct from p_puesto;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.ch_cambiar_puesto(uuid,text,text,date,text,text) to anon, authenticated;
