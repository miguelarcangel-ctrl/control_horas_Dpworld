// Edge Function push-marcaje — avisos push de Control de Horas · DP World Panamá
// Cada usuario elige con interruptores qué momentos le avisan (ch_push_prefs); sin elección, los de su rol (DEF).
// Pedidos (POST JSON):
//   {accion:'clave'}                                         → clave pública VAPID (la primera vez la genera y la guarda)
//   {accion:'prueba', token, key}                            → aviso de prueba a los celulares de quien lo pide
//   {accion:'marca',  token, key, marcaId}                   → aviso de un marcaje (lo pide la tablet, sesión admin)
//   {accion:'evento', token, key, evento, ref, titulo, cuerpo, data} → aviso de producción o del turno que detectó la app
//                                                               (sale una sola vez por ref aunque lo detecten varios equipos)
// Las claves VAPID viven en ch_push_config y solo las lee esta función (service role).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const PUESTOS: Record<string, string> = { operador: 'Operador', ag: 'Ayudante general', supervisor: 'Supervisor', linea: 'Línea de producción', responsable: 'Responsable de línea' };
const KEYS = ['ctrl_horas', 'ctrl_horas_test'];
const ROLES = ['admin', 'supervisor', 'responsable'];
// Avisos por omisión de cada rol (los mismos que muestra la app en la pantalla Avisos)
const DEF: Record<string, string[]> = {
  admin: ['ent_sup', 'ent_resp', 'ent_op', 'ent_lin', 'alm_reg', 'lin_meta', 'lin_riesgo', 'lin_paro', 'lin_cierre'],
  supervisor: ['ent_sup', 'ent_op', 'alm_reg', 'lin_riesgo', 'lin_paro', 'tur_libre', 'tur_larga', 'tur_pend'],
  responsable: ['ent_resp', 'ent_lin', 'alm_reg', 'lin_arranca', 'lin_mitad', 'lin_meta', 'lin_riesgo', 'lin_paro', 'lin_insumo'],
};
const RELAY = new Set(['lin_arranca', 'lin_mitad', 'lin_meta', 'lin_riesgo', 'lin_paro', 'lin_insumo', 'lin_cierre', 'tur_libre', 'tur_larga', 'tur_pend']);
const eventoMarca = (m: any) => m.tipo === 'entrada'
  ? (({ supervisor: 'ent_sup', responsable: 'ent_resp', linea: 'ent_lin' } as Record<string, string>)[m.puesto] || 'ent_op')
  : ({ salida_almuerzo: 'alm_sal', regreso_almuerzo: 'alm_reg', salida: 'salida' } as Record<string, string>)[m.tipo];
const horaPA = (ts: string) => new Date(ts).toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtH = (h: number) => h >= 1 ? Math.floor(h) + ' h ' + Math.round((h % 1) * 60) + ' min' : Math.round(h * 60) + ' min';
const txt = (s: unknown, n: number) => String(s ?? '').slice(0, n);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METODO' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  // Claves VAPID (se generan una sola vez)
  let { data: cfg } = await sb.from('ch_push_config').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (!cfg) {
    const k = webpush.generateVAPIDKeys();
    await sb.from('ch_push_config').insert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
    ({ data: cfg } = await sb.from('ch_push_config').select('public_key, private_key').eq('id', 1).maybeSingle());
  }
  if (!cfg) return json({ error: 'CLAVES' }, 500);
  if (body.accion === 'clave') return json({ publicKey: cfg.public_key });

  // Sesión de la app (misma tabla que usan las funciones ch_*)
  if (!KEYS.includes(body.key)) return json({ error: 'KEY' }, 400);
  const { data: ses } = await sb.from('ch_sesiones').select('usuario_id, expires_at').eq('token', body.token).maybeSingle();
  if (!ses || new Date(ses.expires_at) < new Date()) return json({ error: 'SESION' }, 401);
  const { data: yo } = await sb.from('ch_usuarios').select('id, rol, activo, nombre').eq('id', ses.usuario_id).maybeSingle();
  if (!yo || !yo.activo) return json({ error: 'SESION' }, 401);

  webpush.setVapidDetails('https://control-horas-dpworld.vercel.app', cfg.public_key, cfg.private_key);
  const enviar = async (subs: any[], payload: unknown) => {
    let n = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
        n++;
      } catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from('ch_push_subs').delete().eq('endpoint', s.endpoint);   // celular que ya no existe
        else console.error('push', e && e.statusCode, e && e.body);
      }
    }
    return n;
  };
  // Celulares de quienes tienen encendido ese aviso (con «solo tardanzas», las entradas a tiempo no les llegan)
  const celularesPara = async (evento: string, tarde?: number) => {
    const { data: us } = await sb.from('ch_usuarios').select('id, rol').in('rol', ROLES).eq('activo', true);
    const { data: pr } = await sb.from('ch_push_prefs').select('usuario_id, prefs').eq('key', body.key);
    const P: Record<string, any> = {}; (pr || []).forEach((p: any) => { P[p.usuario_id] = p.prefs || {}; });
    const ids = (us || []).filter((u: any) => {
      const p = P[u.id], on = p ? !!p[evento] : (DEF[u.rol] || []).includes(evento);
      if (!on) return false;
      if (evento.startsWith('ent_') && p && p.solo_tarde && !tarde) return false;
      return true;
    }).map((u: any) => u.id);
    if (!ids.length) return [];
    const { data: subs } = await sb.from('ch_push_subs').select('endpoint, p256dh, auth').eq('key', body.key).in('usuario_id', ids);
    return subs || [];
  };

  if (body.accion === 'prueba') {
    const { data: subs } = await sb.from('ch_push_subs').select('endpoint, p256dh, auth').eq('usuario_id', yo.id).eq('key', body.key);
    const n = await enviar(subs || [], { title: 'Avisos activos', body: 'Este celular recibirá los avisos que elegiste.', tag: 'ch-prueba', data: { accion: 'prueba' } });
    return json({ ok: true, enviados: n, celulares: (subs || []).length });
  }

  if (body.accion === 'marca') {
    if (yo.rol !== 'admin') return json({ error: 'PERMISO' }, 403);
    const { data: m } = await sb.from('ch_marcajes').select('*').eq('id', body.marcaId).eq('key', body.key).maybeSingle();
    const evento = m && eventoMarca(m);
    if (!m || m.anulado || m.push_enviado || !evento) return json({ ok: true, enviados: 0 });
    const { data: dia } = await sb.from('ch_marcajes').select('tipo, ts').eq('key', body.key).eq('persona_id', m.persona_id).eq('fecha', m.fecha)
      .eq('anulado', false).lte('ts', m.ts).order('ts', { ascending: true });
    const puesto = PUESTOS[m.puesto] || '';
    let title = '', cuerpo = '', tarde = 0;
    if (m.tipo === 'entrada') {
      // Tardanza contra la hora de inicio de la jornada (Configuración de la app)
      const { data: kv } = await sb.from('kv_store').select('value').eq('key', body.key).maybeSingle();
      let cfgApp: any = {}; try { cfgApp = (JSON.parse(kv?.value || '{}').config) || {}; } catch (_) { /* sin configuración */ }
      const lim = new Date(`${m.fecha}T${cfgApp.horaInicio || '08:00'}:00-05:00`).getTime() + (Number(cfgApp.toleranciaMin) || 5) * 60000;
      tarde = Math.max(0, Math.round((new Date(m.ts).getTime() - lim) / 60000));
      title = 'Llegó ' + m.nombre; cuerpo = horaPA(m.ts) + ' · ' + puesto + (tarde ? ' · ' + tarde + ' min tarde' : '');
    } else if (m.tipo === 'salida_almuerzo') {
      title = 'Salió a almuerzo: ' + m.nombre; cuerpo = horaPA(m.ts) + ' · ' + puesto;
    } else if (m.tipo === 'regreso_almuerzo') {
      const sa = (dia || []).filter((x: any) => x.tipo === 'salida_almuerzo').pop();
      const almMin = sa ? Math.round((new Date(m.ts).getTime() - new Date(sa.ts).getTime()) / 60000) : 0;
      title = 'Regresó de almuerzo: ' + m.nombre; cuerpo = horaPA(m.ts) + ' · ' + puesto + (almMin ? ' · almuerzo de ' + almMin + ' min' : '');
    } else {
      // Horas trabajadas del día: de entrada/regreso a salida a almuerzo/salida
      let h = 0, ini: number | null = null;
      (dia || []).forEach((x: any) => { const t = new Date(x.ts).getTime();
        if (x.tipo === 'entrada' || x.tipo === 'regreso_almuerzo') { if (ini == null) ini = t; }
        else if (ini != null) { h += t - ini; ini = null; } });
      title = 'Salió ' + m.nombre; cuerpo = horaPA(m.ts) + ' · ' + puesto + ' · ' + fmtH(h / 3600000) + ' trabajadas';
    }
    const n = await enviar(await celularesPara(evento, tarde), { title, body: cuerpo, tag: 'marca|' + m.id, data: { accion: 'marca' } });
    await sb.from('ch_marcajes').update({ push_enviado: true }).eq('id', m.id);
    return json({ ok: true, enviados: n });
  }

  if (body.accion === 'evento') {
    const evento = String(body.evento || ''), ref = txt(body.ref, 200);
    if (!RELAY.has(evento) || !ref) return json({ error: 'EVENTO' }, 400);
    const { data: nuevo } = await sb.from('ch_push_eventos').upsert({ key: body.key, ref, evento }, { onConflict: 'key,ref', ignoreDuplicates: true }).select();
    if (!nuevo || !nuevo.length) return json({ ok: true, enviados: 0, repetido: true });
    const d = body.data || {}, data: Record<string, string> = {};
    ['accion', 'lid', 'tid', 'pid'].forEach((k) => { if (typeof d[k] === 'string') data[k] = d[k].slice(0, 60); });
    if (typeof d.desde === 'number') (data as any).desde = d.desde;
    const n = await enviar(await celularesPara(evento), { title: txt(body.titulo, 120), body: txt(body.cuerpo, 240), tag: ref, data });
    return json({ ok: true, enviados: n });
  }
  return json({ error: 'ACCION' }, 400);
});
