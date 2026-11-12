-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Bodega del marcaje (ADITIVA, sin cambiar firmas existentes)
-- La persona elige su bodega al marcar la entrada; queda en ch_marcajes.bodega.
-- ch_marca_bodega la asigna (tablet en modo marcaje o corrección del admin); ch_marcajes la devuelve.
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_marcajes add column if not exists bodega text;

create or replace function public.ch_marca_bodega(p_token uuid, p_key text, p_id bigint, p_bodega text) returns void
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  update public.ch_marcajes set bodega = nullif(left(trim(coalesce(p_bodega,'')), 60), '') where id = p_id and key = p_key;
end $$;

create or replace function public.ch_marcajes(p_token uuid, p_key text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if p_hasta - p_desde > 62 then raise exception 'RANGO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'persona_id', persona_id, 'nombre', nombre, 'fecha', fecha,
                    'tipo', tipo, 'puesto', puesto, 'ts', ts, 'por', por, 'anulado', anulado, 'motivo', motivo,
                    'corregido_por', corregido_por, 'corregido_en', corregido_en, 'bodega', bodega) order by ts)
                   from public.ch_marcajes where key = public.ch_key_ok(p_key) and fecha between p_desde and p_hasta), '[]'::jsonb);
end $$;

grant execute on function public.ch_marca_bodega(uuid,text,bigint,text) to anon, authenticated;
