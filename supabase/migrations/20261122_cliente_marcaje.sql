-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Cliente del marcaje (ADITIVA, sin cambiar firmas existentes)
-- Para empresas que ponen personal donde sus clientes (Door Logistic): la persona elige al marcar la entrada
-- para qué cliente trabaja ese día; queda en ch_marcajes.cliente (nombre del cliente).
-- La app solo la usa con config.marcajeCliente encendido (apagado en DP World).
-- REVERTIR: drop function public.ch_marca_cliente(uuid,text,bigint,text); alter table public.ch_marcajes drop column cliente;
--           y volver a crear ch_marcajes como en 20261112_bodega_marcaje.sql
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_marcajes add column if not exists cliente text;

create or replace function public.ch_marca_cliente(p_token uuid, p_key text, p_id bigint, p_cliente text) returns void
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  perform public.ch_key_ok(p_key);
  update public.ch_marcajes set cliente = nullif(left(trim(coalesce(p_cliente,'')), 80), '') where id = p_id and key = p_key;
end $$;

create or replace function public.ch_marcajes(p_token uuid, p_key text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  if p_hasta - p_desde > 62 then raise exception 'RANGO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'persona_id', persona_id, 'nombre', nombre, 'fecha', fecha,
                    'tipo', tipo, 'puesto', puesto, 'ts', ts, 'por', por, 'anulado', anulado, 'motivo', motivo,
                    'corregido_por', corregido_por, 'corregido_en', corregido_en, 'bodega', bodega, 'cliente', cliente) order by ts)
                   from public.ch_marcajes where key = public.ch_key_ok(p_key) and fecha between p_desde and p_hasta), '[]'::jsonb);
end $$;

grant execute on function public.ch_marca_cliente(uuid,text,bigint,text) to anon, authenticated;
