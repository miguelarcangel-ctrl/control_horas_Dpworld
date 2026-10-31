// Edge Function push-marcaje — avisos push de llegada al personal (Control de Horas · DP World Panamá)
// Pedidos (POST JSON):
//   {accion:'clave'}                          → clave pública VAPID (la primera vez la genera y la guarda)
//   {accion:'prueba', token, key}             → aviso de prueba a los celulares de quien lo pide
//   {accion:'marca',  token, key, marcaId}    → aviso de entrada a admin y supervisores (lo pide la tablet, sesión admin)
// Las claves VAPID viven en ch_push_config y solo las lee esta función (service role).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const PUESTOS: Record<string, string> = { operador: 'Operador', ag: 'Ayudante general', supervisor: 'Supervisor', linea: 'Línea de producción' };
const KEYS = ['ctrl_horas', 'ctrl_horas_test'];
const horaPA = (ts: string) => new Date(ts).toLocaleTimeString('es-PA', { timeZone: 'America/Panama', hour: '2-digit', minute: '2-digit', hour12: false });

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

  if (body.accion === 'prueba') {
    const { data: subs } = await sb.from('ch_push_subs').select('endpoint, p256dh, auth').eq('usuario_id', yo.id).eq('key', body.key);
    const n = await enviar(subs || [], { title: 'Avisos activos', body: 'Este celular recibirá las llegadas del personal.', tag: 'ch-prueba', data: { accion: 'prueba' } });
    return json({ ok: true, enviados: n, celulares: (subs || []).length });
  }

  if (body.accion === 'marca') {
    if (yo.rol !== 'admin') return json({ error: 'PERMISO' }, 403);
    const { data: m } = await sb.from('ch_marcajes').select('*').eq('id', body.marcaId).eq('key', body.key).maybeSingle();
    if (!m || m.anulado || m.push_enviado || m.tipo !== 'entrada') return json({ ok: true, enviados: 0 });
    // Tardanza contra la hora de inicio de la jornada (Configuración de la app)
    const { data: kv } = await sb.from('kv_store').select('value').eq('key', body.key).maybeSingle();
    let cfgApp: any = {}; try { cfgApp = (JSON.parse(kv?.value || '{}').config) || {}; } catch (_) { /* sin configuración */ }
    const lim = new Date(`${m.fecha}T${cfgApp.horaInicio || '08:00'}:00-05:00`).getTime() + (Number(cfgApp.toleranciaMin) || 5) * 60000;
    const tarde = Math.max(0, Math.round((new Date(m.ts).getTime() - lim) / 60000));
    const { data: dest } = await sb.from('ch_usuarios').select('id').in('rol', ['admin', 'supervisor']).eq('activo', true);
    const { data: subs } = await sb.from('ch_push_subs').select('endpoint, p256dh, auth').eq('key', body.key).in('usuario_id', (dest || []).map((d) => d.id));
    const n = await enviar(subs || [], {
      title: 'Llegó ' + m.nombre,
      body: horaPA(m.ts) + ' · ' + (PUESTOS[m.puesto] || '') + (tarde ? ' · ' + tarde + ' min tarde' : ''),
      tag: 'marca|' + m.id, data: { accion: 'marca' },
    });
    await sb.from('ch_marcajes').update({ push_enviado: true }).eq('id', m.id);
    return json({ ok: true, enviados: n });
  }
  return json({ error: 'ACCION' }, 400);
});
