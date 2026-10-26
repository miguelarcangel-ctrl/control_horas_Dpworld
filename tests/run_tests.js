// Pruebas end-to-end de Control de Horas contra el simulador local
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const BASE = 'http://localhost:8765/index.html';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost')) return route.continue();
    if (u.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: MOCK });
    if (u.includes('xlsx')) return route.fulfill({ contentType: 'application/javascript', body: 'window.XLSX={utils:{book_new:()=>({s:[]}),aoa_to_sheet:a=>a,book_append_sheet:(w,s,n)=>w.s.push([n,s])},writeFile:(w,n)=>{window.__xlsx={w,n}}};' });
    if (/\.(png|jpg|svg)/.test(u)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/plain', body: '' });
  });
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch();
  const { page, errors, ctx } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForTimeout(400);
  ok(await page.isVisible('#loginScreen'), 'login visible al abrir');
  ok(await page.isVisible('#modoPrueba'), 'distintivo de MODO PRUEBA visible en local');

  // 1) clave incorrecta
  await page.fill('#loginUser', 'admin'); await page.fill('#loginPass', 'mala');
  await page.click('#loginScreen button'); await page.waitForTimeout(300);
  ok((await page.textContent('#loginErr')).includes('incorrectos'), 'clave incorrecta rechazada');
  // admin/admin123 ya no existe
  await page.fill('#loginUser', 'admin'); await page.fill('#loginPass', 'admin123');
  await page.click('#loginScreen button'); await page.waitForTimeout(300);
  ok(await page.isHidden('#appScreen'), 'admin/admin123 ya no da acceso');
  await page.screenshot({ path: SHOTS + '/01_login.png' });

  // 2) login correcto
  await page.fill('#loginUser', 'admin'); await page.fill('#loginPass', 'secreto1');
  await page.click('#loginScreen button'); await page.waitForTimeout(600);
  ok(await page.isVisible('#appScreen'), 'login admin correcto');
  const disp = await page.textContent('#tDisp'), us = await page.textContent('#tUsadas'), lib = await page.textContent('#tLibres');
  console.log('   banner:', disp, us, lib);
  ok(disp === '24.0h', 'horas disponibles 24.0h (3 personas × 8h)');
  ok(Math.abs(parseFloat(us) - 4.7) < 0.15, 'horas usadas cuentan horas-persona (2h×2 + 0.67h ≈ 4.7h)');
  await page.screenshot({ path: SHOTS + '/02_turno.png', fullPage: true });

  // 3) motor de costos en histórico
  const eng = await page.evaluate(() => { const t = S.turnosHistorial; const a = engTurnoCerrado(t[0]), b = engTurnoCerrado(t[1]); return { a: [a.pagado, a.productivo, a.efic, a.usadas], b: [b.pagado, b.productivo, b.efic] }; });
  console.log('   motor:', JSON.stringify(eng));
  ok(Math.abs(eng.a[0] - 92.02) < 0.05, 'pagado turno martes = $92.02');
  ok(Math.abs(eng.a[1] - 66.07) < 0.05 && eng.a[2] === 72, 'productivo $66.07 · eficiencia 72% (antes daba ~47%)');
  ok(Math.abs(eng.b[0] - 40.13) < 0.05, 'sábado aplica recargo 1.5× ($40.13)');
  const persisted = await page.evaluate(() => Object.keys(persistable()));
  ok(!persisted.includes('usuarios') && !persisted.includes('editingId'), 'no se persisten usuarios ni campos de pantalla');

  // 4) Insights + usuarios desde servidor
  await page.click('#navInsBtn'); await page.waitForTimeout(500);
  const ins = await page.textContent('#insightsContent');
  ok(ins.includes('Admin Prueba') && ins.includes('@super'), 'lista de usuarios viene del servidor');
  ok(!/secreto/.test(await page.content()), 'ninguna clave aparece en la página');
  await page.screenshot({ path: SHOTS + '/03_insights.png', fullPage: true });
  // usuario con clave corta
  await page.evaluate(() => openModalUsuario());
  await page.fill('#uNombre', 'Nuevo'); await page.fill('#uUser', 'nuevo'); await page.fill('#uPass', '123');
  await page.evaluate(() => guardarUsuario()); await page.waitForTimeout(300);
  ok((await page.textContent('#toast')).includes('6 caracteres'), 'valida clave mínima de 6');
  await page.fill('#uPass', 'clave123'); await page.evaluate(() => guardarUsuario()); await page.waitForTimeout(400);
  ok(await page.evaluate(() => window.__SRV.users.some(u => u.username === 'nuevo')), 'crea usuario en servidor');
  await page.evaluate(() => hideModal('modalUsuario'));

  // 5) Concurrencia: otro usuario agrega un cliente mientras yo agrego otro
  await page.evaluate(() => { const r = window.__SRV.rows.ctrl_horas_test; r.value.clientes.push({ id: 'kX', nombre: 'Cliente de otro usuario' }); r.version++; });
  await page.evaluate(() => openModalCliente());
  await page.fill('#clNombre', 'Cliente mío'); await page.evaluate(() => guardarCliente()); await page.waitForTimeout(500);
  const cl = await page.evaluate(() => window.__SRV.rows.ctrl_horas_test.value.clientes.map(c => c.nombre));
  console.log('   clientes en servidor:', cl.join(' | '));
  ok(cl.includes('Cliente de otro usuario') && cl.includes('Cliente mío'), 'conflicto: se conservan los cambios de ambos usuarios');

  // 6) Concurrencia en el turno: otro supervisor cierra una tarea mientras yo inicio otra
  await page.evaluate(() => { const v = window.__SRV.rows.ctrl_horas_test; const a = v.value.tareasActivas.shift(); a.fin = Date.now(); a.durH = (a.fin - a.inicio) / 3600000; v.value.historial.push(a); v.version++; });
  await page.evaluate(async () => { S.tareasActivas.push({ id: 'nueva', tareaId: 't1', tarea: 'Descargue contenedor', clienteId: 'k1', cliente: 'CERNAC', colaboradores: [S.turno.equipo[0]], inicio: Date.now(), prod: 20, unidad: 'pallet' }); await save(); });
  const v = await page.evaluate(() => { const x = window.__SRV.rows.ctrl_horas_test.value; return { act: x.tareasActivas.map(t => t.id), hist: x.historial.map(t => t.id) }; });
  console.log('   activas:', v.act, 'historial:', v.hist);
  ok(v.act.join() === 'nueva' && v.hist.includes('act1'), 'cierre remoto + inicio local se integran sin perder nada');

  // 7) Sin conexión → respaldo local → se sincroniza al volver
  await page.evaluate(async () => { window.__SRV.offline = true; S.clientes.push({ id: 'kOff', nombre: 'Offline' }); await save(); });
  ok(await page.evaluate(() => !!localStorage.getItem(BK_KEY)), 'sin conexión: guarda respaldo en el equipo');
  await page.evaluate(async () => { window.__SRV.offline = false; await reload(); });
  ok(await page.evaluate(() => window.__SRV.rows.ctrl_horas_test.value.clientes.some(c => c.id === 'kOff') && !localStorage.getItem(BK_KEY)), 'al volver la conexión sube los cambios pendientes');

  // 8) Excel
  await page.evaluate(() => exportExcel(null));
  const x = await page.evaluate(() => window.__xlsx.w.s.map(s => s[0] + ':' + s[1].length));
  ok(x.length === 5, 'Excel con 5 hojas: ' + x.join(', '));

  // 9) Configuración con tarifas
  await page.click('#navInsBtn'); await page.evaluate(() => openConfig()); await page.waitForTimeout(200);
  await page.fill('#cfgTarOp', '60'); await page.evaluate(() => guardarConfig()); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__SRV.rows.ctrl_horas_test.value.config.tarifaOperador === 60), 'tarifa operador editable y guardada');
  ok(await page.evaluate(() => Math.abs(costoCargo('operador').dia - 64.2) < 0.01), 'nueva tarifa aplica al cálculo ($60 × 1.07)');

  // 10) Sesión persistente
  await page.reload(); await page.waitForTimeout(700);
  ok(await page.isVisible('#appScreen'), 'al recargar no pide login (sesión guardada)');
  ok(errors.length === 0, 'sin errores JS (' + errors.join(' | ') + ')');

  // 11) Supervisor no ve Insights
  await page.evaluate(() => doLogout()); await page.waitForTimeout(300);
  await page.fill('#loginUser', 'super'); await page.fill('#loginPass', 'secreto2');
  await page.click('#loginScreen button'); await page.waitForTimeout(600);
  ok(await page.isHidden('#navInsBtn'), 'supervisor no ve Insights');
  ok(await page.evaluate(() => document.getElementById('adminKPI').style.display !== 'flex'), 'supervisor no ve costos');

  // 12) TV
  const tv = await newPage(browser, { viewport: { width: 1600, height: 900 } });
  await tv.page.goto(BASE + '?tv=1'); await tv.page.waitForTimeout(800);
  ok(await tv.page.isVisible('#dashboardOverlay'), 'TV abre dashboard sin login');
  ok(await tv.page.isHidden('#loginScreen'), 'TV no muestra login');
  ok(await tv.page.evaluate(() => !S.usuarios), 'TV no recibe usuarios');
  await tv.page.screenshot({ path: SHOTS + '/04_tv.png' });
  ok(tv.errors.length === 0, 'TV sin errores JS (' + tv.errors.join(' | ') + ')');

  await browser.close();
  console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
