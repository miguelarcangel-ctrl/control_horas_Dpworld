-- ═══════════════════════════════════════════════════════════════
-- Control de Horas — Personal de contingente (ADITIVA)
-- El supervisor puede dar de alta personal nuevo (contingente) para que marque; queda en la base del personal
-- marcado como contingente y con quién lo creó. Solo el administrador edita personas ya registradas.
-- ═══════════════════════════════════════════════════════════════
alter table public.ch_personal add column if not exists contingente boolean not null default false;

create or replace function public.ch_personal_list(p_token uuid, p_key text default 'ctrl_horas') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u public.ch_usuarios := public.ch_user(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'puesto_def', puesto_def,
                    'activo', activo, 'tiene_cedula', cedula_hash is not null, 'contingente', contingente,
                    'creado_por', creado_por, 'creado', creado) order by nombre)
                   from public.ch_personal where key = public.ch_key_ok(p_key)), '[]'::jsonb);
end $$;

drop function if exists public.ch_personal_upsert(uuid,text,text,text,text,text,boolean);
create or replace function public.ch_personal_upsert(p_token uuid, p_key text, p_id text, p_nombre text,
                                                     p_cedula text, p_puesto text, p_activo boolean default true,
                                                     p_contingente boolean default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare u public.ch_usuarios := public.ch_user(p_token); ced text := public.ch_norm_cedula(p_cedula); nid text; r record; nuevo boolean;
begin
  perform public.ch_key_ok(p_key);
  nuevo := coalesce(p_id,'') = '' or not exists (select 1 from public.ch_personal where key = p_key and id = p_id);
  -- El supervisor solo da de alta personas nuevas (contingente), con cédula; no edita las existentes
  if u.rol = 'supervisor' then
    if not nuevo then raise exception 'PERMISO' using errcode = '42501'; end if;
    if ced = '' then raise exception 'DATOS'; end if;
  elsif u.rol <> 'admin' then raise exception 'PERMISO' using errcode = '42501'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'DATOS'; end if;
  if ced <> '' and length(ced) < 4 then raise exception 'CEDULA_CORTA'; end if;
  nid := coalesce(nullif(p_id,''), encode(gen_random_bytes(6),'hex'));
  if ced <> '' then
    for r in select id, cedula_hash from public.ch_personal where key = p_key and id <> nid and cedula_hash is not null loop
      if r.cedula_hash = crypt(ced, r.cedula_hash) then raise exception 'CEDULA_EXISTE'; end if;
    end loop;
  end if;
  insert into public.ch_personal (key, id, nombre, cedula_hash, puesto_def, activo, creado_por, contingente)
  values (p_key, nid, trim(p_nombre), case when ced <> '' then crypt(ced, gen_salt('bf')) end, p_puesto,
          case when u.rol = 'supervisor' then true else coalesce(p_activo,true) end, u.username,
          case when u.rol = 'supervisor' then true else coalesce(p_contingente,false) end)
  on conflict (key, id) do update set nombre = excluded.nombre, puesto_def = excluded.puesto_def, activo = excluded.activo,
     cedula_hash = case when ced <> '' then excluded.cedula_hash else public.ch_personal.cedula_hash end,
     contingente = coalesce(p_contingente, public.ch_personal.contingente);
  return nid;
end $$;

grant execute on function public.ch_personal_upsert(uuid,text,text,text,text,text,boolean,boolean) to anon, authenticated;
