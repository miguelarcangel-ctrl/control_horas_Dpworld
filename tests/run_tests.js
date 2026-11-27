// Pruebas end-to-end de Control de Horas contra el simulador local
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const BASE = 'http://localhost:8765/index.html';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
// Navegación por el menú desplegable (línea gráfica común): abre el menú y elige la sección
// Menú por categorías: si el nombre es una fila del menú la toca; si es una pestaña, entra por su categoría y toca la pestaña
const irA = async (page, label) => { await page.click('.dpw-burger');
  const it = page.locator(`.dpw-item:has-text("${label}")`).first();
  if (await it.count()) { await it.click(); return; }
  const key = await page.evaluate(l => { for (const c of CATS) { const x = tabsDe(c).find(t => t[1] === l); if (x) { DPW.cerrarMenu(); irCategoria(c.id); return x[0]; } } return null; }, label);
  if (!key) throw new Error('No está en el menú ni en las pestañas: ' + label);
  await page.click(`.cat-tab:has-text("${label}")`); };
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 420, height: 900 } });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('__tour')) ['u1', 'u2'].forEach(id => localStorage.setItem('ch_tutorial_' + id, 'visto')); } catch (e) {} });
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
  await page.click('#loginBtn'); await page.waitForTimeout(300);
  ok((await page.textContent('#loginErr')).includes('incorrectos'), 'clave incorrecta rechazada');
  // admin/admin123 ya no existe
  await page.fill('#loginUser', 'admin'); await page.fill('#loginPass', 'admin123');
  await page.click('#loginBtn'); await page.waitForTimeout(300);
  ok(await page.isHidden('#appScreen'), 'admin/admin123 ya no da acceso');
  await page.screenshot({ path: SHOTS + '/01_login.png' });

  // 2) login correcto
  await page.fill('#loginUser', 'admin'); await page.fill('#loginPass', 'secreto1');
  await page.click('#loginBtn'); await page.waitForTimeout(600);
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

  // 4) Configuración → Usuarios (antes Insights): usuarios desde servidor
  await irA(page, 'Usuarios y accesos'); await page.waitForTimeout(500);
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
  ok(x.length === 9, 'Excel con 9 hojas: ' + x.join(', '));
  const rp = await page.evaluate(() => {
    _rep = { id: 0, desde: '', hasta: '' }; abrirSeccion('exportar');
    const box = document.getElementById('repBox'), r = {};
    r.pantalla = !!box && box.querySelectorAll('.rep-lista .chip').length === 9 && box.querySelectorAll('.rep-tabla tbody tr').length > 0 && /Detalle Tareas/.test(box.innerHTML);
    box.querySelectorAll('.rep-lista .chip')[1].click();
    r.cambia = /Resumen Turnos/.test(document.querySelector('.rep-acc').textContent);
    descargarReporte(1); r.uno = window.__xlsx.w.s.length === 1 && window.__xlsx.w.s[0][0] === 'Resumen Turnos' && /^Resumen_Turnos_/.test(window.__xlsx.n);
    descargarReporte(-1); r.todos = window.__xlsx.w.s.length === 9;
    _rep.desde = '2000-01-01'; _rep.hasta = '2000-01-02'; pintarReportes(); r.rango = /Sin datos en estas fechas/.test(document.getElementById('repBox').innerHTML);
    _rep = { id: 0, desde: '', hasta: '' }; setNav('supervisor'); return r; });
  ok(rp.pantalla && rp.cambia, 'reportes: se ven en pantalla, uno por uno (9 reportes), con filtro de fechas');
  ok(rp.uno && rp.todos && rp.rango, 'reportes: se descarga solo el que se ve o todos juntos; el rango de fechas filtra');

  // 9) Configuración con tarifas
  await irA(page, 'Horario y recargos'); await page.evaluate(() => openConfig()); await page.waitForTimeout(200);
  await page.fill('#cfgTarOp', '60'); await page.evaluate(() => guardarConfig()); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__SRV.rows.ctrl_horas_test.value.config.tarifaOperador === 60), 'tarifa operador editable y guardada');
  ok(await page.evaluate(() => Math.abs(costoCargo('operador').dia - 64.2) < 0.01), 'nueva tarifa aplica al cálculo ($60 × 1.07)');

  // 9b) Homologación con el Excel de ventas: solo actividades con costo por hora; tareas genéricas + nombre por cliente
  const AOA = [['MAESTRO TARIFAS 2026'], [],
    ['', 'ACTIVIDAD', 'TARIFA', 'CLIENTE', 'ORDEN ', 'COSTE HORA', 'Prod Obj T1', 'Prod Obj T2', 'Prod Obj T3', 'Prod Obj T4', 'CATEGORIA', 'TIPO ACTIVIDAD', 'SUB-ACTIVIDAD', 'COSTE UNIDAD', 'CENTRO'],
    ['', 'DESCARGA DE CONTENEDOR', 108, 'CERNAC', 1, 6.69, '', '', '', '', 'PAYROLL', 'DOOR LOGISTIC', 'MANIP', 0, 'CLP'],
    ['', 'DESCARGA DE CONTENEDOR', 999, 'CERNAC', 2, 6.69, '', '', '', '', 'PAYROLL', 'DOOR LOGISTIC', 'MANIP', 0, 'CLP'],
    ['', 'PICKING DE MERCANCIA', 0, 'CERNAC', 3, 6.69, '', '', '', '', 'PAYROLL', 'DOOR LOGISTIC', 'MANIP', '', ''],
    ['', 'PICKING (ALICORP)', 0.9, 'ALICORP', 4, 6.69, '', '', '', '', 'PAYROLL', 'DOOR LOGISTIC', 'MANIP', '', ''],
    ['', 'TRANSPORTE 1X40', 160, 'CERNAC', 5, 0, 0, 0, 0, 0, 'TRANSPORTES ', 'TRANSPORTES ', 'TRANSPORTES', 150, 'CLP'],
    ['', 'VAS TRASIEGO DE 6 PACK', 10, 'Otro Cliente', 6, 6.69, '', '', '', '', 'OVAS', 'DOOR LOGISTIC', 'MANIP', '', ''],
    ['', '', '', '', '', '']];
  await page.evaluate(aoa => prepImportMaestro(parseMaestroAOA(aoa), 'prueba.xlsx'), AOA); await page.waitForTimeout(200);
  const sug = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#maestroPrev .mVinc')].map(s => [s.dataset.k, s.value])));
  ok(Object.keys(sug).length === 4 && !('transporte 1x40|cernac' in sug), 'Excel: solo actividades con costo por hora (transporte queda fuera)');
  ok(sug['descarga de contenedor|cernac'] === 't1' && sug['picking de mercancia|cernac'] === 't2' && sug['picking alicorp|alicorp'] === 't2', 'Excel: sugiere la tarea genérica para cada cliente');
  ok(sug['vas trasiego de 6 pack|otro cliente'] === 'nueva', 'Excel: sin tarea parecida propone crear una genérica');
  await page.evaluate(() => aplicarImportMaestro()); await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ n: S.maestro.length, t2: S.tareasCat.find(t => t.id === 't2').excel, cli: S.clientes.map(c => c.nombre),
    nueva: S.tareasCat.find(t => t.nombre === 'Vas trasiego de 6 pack'), dup: S.tareasCat.filter(t => /picking/i.test(t.nombre)).length }));
  ok(st.n === 4 && Object.keys(st.t2).length === 2, 'Excel: una tarea genérica sirve a dos clientes con su propio nombre');
  ok(st.dup === 1, 'Excel: no duplica tareas por cliente');
  ok(st.nueva && st.cli.includes('Otro Cliente') && st.cli.filter(c => /cernac/i.test(c)).length === 1, 'Excel: crea la tarea genérica y solo los clientes que faltan');
  await page.evaluate(() => { S.tareasActivas.push({ id: 'actM', tareaId: 't2', tarea: 'Picking', clienteId: 'k2', cliente: 'Alicorp', colaboradores: [S.turno.equipo[0], S.turno.equipo[1]], inicio: Date.now() - 3600000, prod: 60, unidad: 'caja' });
    prepCerrarTarea('actM'); S._cerrandoPersonaId = 'todos'; document.getElementById('cantEjec').value = '100'; return confirmarCierre(); }); await page.waitForTimeout(300);
  const h = await page.evaluate(() => { const x = S.historial.find(h => h.tareaId === 't2' && h.cant === 100); return { ex: x.excel, hp: engVivo().horasPersonaTarea(x) }; });
  ok(h.ex && h.ex.actividad === 'PICKING (ALICORP)' && h.ex.categoria === 'PAYROLL', 'al cerrar, la tarea guarda su nombre en el Excel según el cliente');
  ok(Math.abs(h.hp - 2) < 0.02, 'horas-persona de la tarea: 1 h × 2 personas = 2 h');
  await page.evaluate(aoa => prepImportMaestro(parseMaestroAOA(aoa), 'prueba2.xlsx'), AOA); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector('#maestroPrev .mVinc[data-k="picking alicorp|alicorp"]').value === 't2'), 'reimportar conserva la homologación');
  await page.evaluate(() => { document.querySelector('#maestroPrev .mVinc[data-k="picking de mercancia|cernac"]').value = 't1'; return aplicarImportMaestro(); }); await page.waitForTimeout(200);
  ok(await page.evaluate(() => Object.keys(S.tareasCat.find(t => t.id === 't1').excel).length === 1), 'no permite dos actividades del mismo cliente en una tarea');
  ok(await page.evaluate(() => window.__SRV.rows.ctrl_horas_test.value.maestro.length === 4), 'homologación se guarda en el servidor');

  // 9c) Tablero por persona: cambiar de tarea cierra la anterior; cantidades pendientes; 4 grupos de tiempo
  await page.evaluate(() => hideModal('modalMaestro'));
  await irA(page, 'Turno'); await page.waitForTimeout(200);
  const tb = await page.evaluate(async () => {
    cerrarActividad(S.turno.equipo.map(c => c.id), Date.now()); S.historial.forEach(h => h.cantPend = false);
    await asignarTarea(['c1', 'c2'], 't1', 'k1', 0);
    const a = S.tareasActivas.find(t => t.tareaId === 't1');
    await sumarCant(a.id, 5); await sumarCant(a.id, 5);
    const r = { grupo: a.colaboradores.length, por: a.por };
    await asignarTarea(['c1'], 't2', 'k2', 0);                       // c1 cambia: sale del grupo
    r.parcial = !!S.historial.find(h => h.tareaId === 't1' && h.parcial && h.colaboradores[0].id === 'c1');
    r.sigue = S.tareasActivas.find(t => t.tareaId === 't1').colaboradores.map(c => c.id).join();
    await pausar(['c2'], 'bano', 0);                                 // c2 a pausa: termina t1 con la cantidad contada
    const t1 = S.historial.filter(h => h.tareaId === 't1' && !h.parcial).pop();
    r.cantT1 = t1.cant; r.pendT1 = !!t1.cantPend;
    r.pausa = (actDe('c2') || {}).causa;
    await liberar(['c1']);                                           // Picking sin contar → pendiente
    r.pide = !document.getElementById('modalCantidad').classList.contains('hidden'); hideModal('modalCantidad');
    r.pend = pendientes().map(h => h.tareaId).join();
    r.cards = document.querySelectorAll('#equipoList .pc').length;
    r.libre = !!document.querySelector('#equipoList .pc.st-libre');
    return r;
  });
  ok(tb.grupo === 2 && tb.por === 'admin', 'tablero: asigna una tarea a 2 personas a la vez (registrado por)');
  ok(tb.parcial && tb.sigue === 'c2', 'tablero: asignar otra tarea saca a la persona del grupo y registra sus horas');
  ok(tb.cantT1 === 10 && !tb.pendT1, 'tablero: el contador de la tarjeta queda como cantidad al terminar');
  ok(tb.pausa === 'bano', 'tablero: pausa de un toque (baño) cierra la tarea anterior');
  ok(tb.pend === 't2' && tb.pide, 'tablero: al terminar sin cantidad la pide de inmediato y, si no se pone, queda pendiente');
  ok(tb.cards === 3 && tb.libre, 'tablero: una tarjeta por persona; libre en rojo');
  const sinAct = await page.evaluate(async () => { const n = S.historial.length; await liberar(['c3']); return { n: S.historial.length === n, msg: document.getElementById('toast').textContent }; });
  ok(sinAct.n && /No hay ninguna tarea/.test(sinAct.msg), 'terminar sin tarea en curso avisa y no registra nada');
  ok(await page.evaluate(() => { _sel = new Set(['c3']); pintarSel(); const d = document.getElementById('tbTerminar').disabled; limpiarSel(); return d; }), 'botón Terminar tarea desactivado si nadie seleccionado tiene tarea');
  await page.evaluate(async () => { await liberar(S.turno.equipo.map(c => c.id)); });
  await page.evaluate(() => prepCerrarTurno()); await page.waitForTimeout(200);
  ok(await page.isVisible('#modalCantidad') && await page.isHidden('#modalCerrarTurno'), 'no deja cerrar el turno con cantidades pendientes');
  await page.fill('#cantValor', '40'); await page.evaluate(() => guardarCantidad()); await page.waitForTimeout(200);
  const pk = await page.evaluate(() => { const h = S.historial.filter(h => h.tareaId === 't2').pop(); return { p: pendientes().length, cant: h.cant, efic: h.efic != null }; });
  ok(pk.p === 0 && pk.cant === 40 && pk.efic, 'cantidad pendiente completada calcula productividad');
  const H = 3600000, b = Date.parse('2026-10-20T13:00:00Z');
  const tg = await page.evaluate(({ H, b }) => {
    const c = S.colaboradores[0], T = (id, tareaId, ini, dur, extra) => ({ id, tareaId, tarea: id, colaboradores: [c], inicio: b + ini * H, fin: b + (ini + dur) * H, durH: dur, ...extra });
    const k = calcTurno({ fecha: '2026-10-20', inicio: b, fin: b + 9 * H, equipo: [c], hpPorPersona: 8 },
      [T('p', 't1', 0, 4), T('s', 't3', 4, 1), T('ba', '_bano', 5, .5, { isEspecial: true, causa: 'bano' }), T('al', '_almuerzo', 6, 1, { tarea: 'Almuerzo', isEspecial: true })], [], b + 9 * H);
    const r = k.per[c.id].rate;
    return { prod: k.prodH, apoyo: k.apoyoH, np: k.noprodH, sin: k.libres, okProd: Math.abs(k.productivo - r * 5) < .01, okNP: Math.abs(k.perdidoNP - r * .5) < .01, okSin: Math.abs(k.perdidoSinReg - r * 2.5) < .01 };
  }, { H, b });
  ok(tg.prod === 4 && tg.apoyo === 1 && tg.np === .5 && Math.abs(tg.sin - 2.5) < 1e-9, 'tiempos: 4 h productivas · 1 h apoyo · 0.5 h baño · 2.5 h sin registrar (almuerzo fuera)');
  ok(tg.okProd && tg.okNP && tg.okSin, 'tiempos: costo trabajado 5 h · perdido por pausas 0.5 h · sin registrar 2.5 h');
  ok(await page.evaluate(() => { const k = engVivo(); return k.baseH <= 3 * 3 + 0.1 && k.baseH > 8; }), 'turno en curso: la base son las horas transcurridas (3 h × 3), no la jornada completa');

  // 9d) Avisos y app instalable
  const av = await page.evaluate(() => { const f0 = S.turno.fecha; S.turno.fecha = '2026-10-20';   // fecha pasada: la hora de inicio no limita el aviso
    _avisados.clear(); _avisosApp = []; pintarAvisosApp(); const ok15 = (revisarAlertas(), [..._avisados].some(k => k.startsWith('libre|'))); S.config.alertaLibreMin = 0.001; revisarAlertas(); S.config.alertaLibreMin = 15; S.turno.fecha = f0; if (ok15) return {}; return { libre: [..._avisados].some(k => k.startsWith('libre|')), toast: document.getElementById('avisosApp').textContent }; });
  ok(av.libre && /sin tarea/i.test(av.toast), 'aviso: persona sin tarea pasado el umbral (y no antes)');
  const _rep = await page.evaluate(() => { revisarAlertas(); const a = new Set(_avisados); revisarAlertas(); return [..._avisados].filter(k => !a.has(k)); });
  ok(_rep.length === 0, 'aviso: no se repite el mismo aviso');
  const acc = await page.evaluate(async () => {
    const r = { tarjeta: document.querySelectorAll('#avisosApp .aviso-card').length > 0 };
    const pid = _avisosApp.find(a => a.data && a.data.accion === 'libre').data.pid;
    _avisosApp = _avisosApp.filter(a => !(a.data && a.data.accion === 'libre' && a.data.pid !== pid)); pintarAvisosApp();
    tocarAviso(_avisosVista.findIndex(v => v.data.accion === 'libre')); r.asignar = !document.getElementById('modalAsignar').classList.contains('hidden') && _sel.has(pid) && _sel.size === 1;
    hideModal('modalAsignar'); limpiarSel();
    // Notificación tocada con la app abierta: el service worker manda un mensaje
    S.historial.push({ id: 'pendX', tareaId: 't1', tarea: 'Descargue contenedor', cliente: 'CERNAC', colaboradores: [S.turno.equipo[0]], inicio: Date.now() - 3600000, fin: Date.now(), durH: 1, cant: 0, cantPend: true, prod: 20, unidad: 'pallet' });
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { tipo: 'aviso', data: { accion: 'pend' } } }));
    await new Promise(res => setTimeout(res, 100));
    r.cantidad = !document.getElementById('modalCantidad').classList.contains('hidden') && _cantRef && _cantRef.id === 'pendX';
    hideModal('modalCantidad'); S.historial = S.historial.filter(h => h.id !== 'pendX');
    // Al asignarle tarea, la tarjeta del aviso desaparece sola
    await asignarTarea([pid], 't1', 'k1', 0); revisarAlertas();
    r.limpia = !_avisosApp.some(a => a.data && a.data.pid === pid && a.data.accion === 'libre');
    await liberar([pid]); hideModal('modalCantidad'); S.historial.forEach(h => h.cantPend = false);
    return r; });
  ok(acc.tarjeta, 'aviso: aparece como tarjeta en la app');
  const grp = await page.evaluate(() => { _avisosApp = S.turno.equipo.map(c => ({ key: 'libre|' + c.id + '|0', titulo: 'Sin tarea asignada', cuerpo: '', data: { accion: 'libre', pid: c.id, desde: 0 } })); pintarAvisosApp();
    const n = document.querySelectorAll('#avisosApp .aviso-card').length; tocarAviso(0); const r = { n, sel: _sel.size, quedan: _avisosApp.length }; hideModal('modalAsignar'); limpiarSel(); return r; });
  ok(grp.n === 1 && grp.sel === 3 && grp.quedan === 0, 'aviso: varias personas sin tarea en una sola tarjeta que las asigna juntas');
  ok(acc.asignar, 'aviso «sin tarea»: al tocarlo abre Asignar con esa persona');
  ok(acc.cantidad, 'notificación «cantidades pendientes»: al tocarla abre la cantidad');
  ok(acc.limpia, 'aviso: la tarjeta se quita sola cuando se resuelve');
  ok(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 'app instalable: service worker registrado');
  ok(await page.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()).icons.length >= 2), 'app instalable: manifest con íconos');
  await page.evaluate(() => exportExcel(null));
  const x2 = await page.evaluate(() => window.__xlsx.w.s.slice(-9).map(s => s[1][0]));
  ok(x2[0].includes('Tipo de tiempo') && x2[1].includes('Horas sin registrar') && x2[4].includes('% productivo'), 'Excel: columnas de tiempos y nombre en Excel');

  // Marcajes de apoyo para las pruebas de líneas (personas temporales que se quitan al terminar)
  await page.evaluate(() => {
    window.mkTmp = (id, nombre, puesto, tipo = 'entrada', hace = 0) => { const SRV = window.__SRV;
      if (!SRV.personal.some(x => x.id === id)) SRV.personal.push({ key: STATE_KEY, id, nombre, cedula: 'X' + id, puesto_def: puesto, activo: true });
      SRV.marcas.push({ id: ++SRV.marcaSeq, key: STATE_KEY, persona_id: id, nombre, fecha: hoyStr(), tipo, puesto, ts: new Date(Date.now() - hace).toISOString(), por: 'admin', anulado: false }); };
    window.limpiarTmp = async () => { const SRV = window.__SRV; SRV.personal = SRV.personal.filter(x => !x.id.startsWith('tmp_')); SRV.marcas = SRV.marcas.filter(x => !x.persona_id.startsWith('tmp_')); await cargarPersonal(); await cargarMarcas(); };
  });
  // 9e) Líneas de producción (módulo propio): no dependen del turno; cuadrilla escrita (paletizan + apoyo); cualquier día
  const ln = await page.evaluate(async () => {
    const r = {}, hoy = hoyStr();
    S.lineasTipo = [{ id: 'lt1', nombre: 'Inserto botella', clienteId: 'k1', prod: 0.5, apoyo: [{ nombre: 'Armado de cajas', cant: 2 }, { nombre: 'Etiquetado', cant: 1 }], excel: null }];
    // migración: líneas que vivían en el turno y planes viejos pasan a S.lineas
    S.lineas = []; S.turno.lineas = [{ id: 'old1', tipoId: 'lt1', nombre: 'Inserto botella', estado: 'cerrada', meta: 5, horas: 8, prod: 0.5, apoyo: [], personas: [{ id: 'x', nombre: 'Viejo', pallets: [1, 2] }], inicio: Date.now() - 3600000, fin: Date.now() }];
    S.lineasPlan = [{ id: 'pl0', fecha: '2099-01-01', tipoId: 'lt1', meta: 12, horas: 8 }];
    migrarLineas();
    r.migra = !S.turno.lineas && S.lineas.some(l => l.id === 'old1' && l.fecha === S.turno.fecha) && S.lineas.some(l => l.id === 'pl0' && l.estado === 'pendiente' && l.fecha === '2099-01-01') && S.lineasPlan.length === 0;
    S.lineas = [];
    const c = cuadrilla(40, 0.5, 8);
    r.calc = c.total === 10 && c.ap === 0;
    // planificar otro día de la semana: no aparece hoy
    // día hábil entre 2 y 6 días adelante (sábado y domingo tienen otra jornada y cambian el cálculo)
    const d = new Date(); d.setDate(d.getDate() + 2); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); const otroDia = fechaLocal(d);
    abrirPlanLinea(fechaManana()); r.chips = document.querySelectorAll('#plDias .chip').length === 7;
    setPlanFecha(otroDia); document.getElementById('plTipo').value = 'lt1'; document.getElementById('plMeta').value = '40'; calcPlanLinea();
    r.calcTxt = /10 personas/.test(document.getElementById('plCalc').textContent);
    document.getElementById('plPersonas').value = '8'; calcPlanLinea();
    r.inversa = /Con 8 personas alcanzas 32 pallets · faltan 2 personas/.test(document.getElementById('plCalc').textContent);
    await guardarPlanLinea(); setNav('lineas');
    r.otroDia = lineasHoy().length === 0 && S.lineas.some(l => l.fecha === otroDia) && /Inserto botella/.test(document.getElementById('lineasPlanList').innerHTML);
    // una línea futura no se puede arrancar
    const fut = S.lineas.find(l => l.fecha === otroDia); abrirLinea(fut.id); r.futura = !/Arrancar línea/.test(document.getElementById('lineaBody').innerHTML); hideModal('modalLinea');
    // sin turno regular abierto, igual se trabaja la línea de hoy
    const turnoGuardado = S.turno; S.turno = null; renderAll();
    abrirPlanLinea(hoy); setPlanFecha(hoy); document.getElementById('plTipo').value = 'lt1'; document.getElementById('plMeta').value = '20'; document.getElementById('plHoras').value = '8';
    await guardarPlanLinea();
    const l = lineasHoy()[0]; r.hoy = !!l && l.estado === 'pendiente' && document.querySelectorAll('#lineasList .lb').length === 1;
    abrirLinea(l.id);
    // sin marcajes: nadie disponible y no arranca
    const lb = () => document.getElementById('lineaBody').innerHTML;
    r.sinMarcas = /Nadie disponible/.test(lb()) && !document.getElementById('lmNombre') && /disabled="">Arrancar línea/.test(lb());
    mkTmp('tmp_p1', 'Pedro Temporal', 'linea', 'entrada', 3 * 3600000); mkTmp('tmp_p2', 'María Externa', 'linea'); mkTmp('tmp_r', 'Rosa Cajas', 'linea'); mkTmp('tmp_t', 'Tito Etiquetas', 'linea');
    await cargarPersonal(); await cargarMarcas(); renderLineaModal();
    const add = async pid => { renderLineaModal(); await agregarMarcadoLinea(pid); };
    await add('tmp_p1'); await add('tmp_p2'); await add('tmp_p1'); await add('tmp_r'); await add('tmp_t');
    r.nombres = l.personas.map(p => p.nombre).join('|') === 'Pedro Temporal|María Externa|Rosa Cajas|Tito Etiquetas' && !/lmPuesto/.test(lb()) && !S.colaboradores.some(x => x.nombre === 'Pedro Temporal');
    // sin supervisor ni responsable marcados la línea arranca igual (la producción no se detiene por una ausencia)
    r.recuerda = r.sinMarcas && !presentes(['supervisor', 'responsable']).length;
    await arrancarLinea();
    r.corre = l.estado === 'corriendo' && l.responsable === 'Admin Prueba' && !S.turno;
    const p1 = l.personas[0];
    await sumarPallet(1); await sumarPallet(1); await sumarPallet(5); await sumarPallet(-1); await sumarPallet(-1); await sumarPallet(-1); await sumarPallet(-1);
    r.pallets = totalPallets(l) === 3 && /sumarPallet\(5\)/.test(lb()) && !/sumarPallet\('/.test(lb()) && /lp-total/.test(lb());
    r.bloque = /3<\/b> \/ 20 pallets/.test(document.getElementById('lineasList').innerHTML) && /4 personas/.test(document.getElementById('lineasList').innerHTML);
    // letra por día y nombres en la tarjeta
    { const hoyL = S.lineas.filter(x => x.fecha === l.fecha), letras = hoyL.map(x => x.letra);
      const dup = { ...JSON.parse(JSON.stringify(l)), id: 'tmpl2', letra: l.letra, pallets: [], personas: [{ id: 'z1', nombre: 'Eliezer Velázquez' }, { id: 'z2', nombre: 'Eliezer Rodríguez' }, { id: 'z3', nombre: 'Ana Flores' }] };
      S.lineas.push(dup); asignarLetras();
      r.letras = !!l.letra && new Set(letras).size === letras.length && dup.letra && dup.letra !== l.letra && letraN(0) === 'A' && letraN(25) === 'Z' && letraN(26) === 'AA';
      renderLineas(); const html = document.getElementById('lineasList').innerHTML;
      r.tarjeta = html.includes('Línea ' + l.letra + ' · Inserto botella') && /Pedro · María · Rosa · Tito/.test(html) && /Eliezer V\. · Eliezer R\. · Ana/.test(html);
      S.lineas = S.lineas.filter(x => x.id !== 'tmpl2'); renderLineas(); }
    // almuerzo: se ve en la cuadrilla y no cuenta en sus horas de línea
    l.inicio = p1.desde = Date.now() - 2 * 3600000;
    mkTmp('tmp_p1', 'Pedro Temporal', 'linea', 'salida_almuerzo', 3600000); await cargarMarcas(); renderLineaModal();
    r.almBloq = /En almuerzo desde/.test(lb());
    mkTmp('tmp_p1', 'Pedro Temporal', 'linea', 'regreso_almuerzo', 1800000); await cargarMarcas(); renderLineaModal();
    r.almOk = !/En almuerzo desde/.test(lb()) && Math.abs(horasEnLinea(p1, l) - 1.5) < 0.02;
    // almuerzo de la línea: el encargado lo pone a toda la cuadrilla (queda en el marcaje de cada uno) y no cuenta como paro
    { const c0 = window.confirm, SRV = window.__SRV; window.confirm = () => true; renderLineaModal();
      r.btnAlm = !!document.getElementById('lmAlmuerzo');
      const n0 = SRV.marcas.length; await iniciarAlmuerzoLinea();
      r.lineaAlm = !!l.almuerzoActivo && SRV.marcas.slice(n0).filter(m => m.tipo === 'salida_almuerzo').length === 4
        && l.personas.every(p => estadoMarca(p.personaId).estado === 'almuerzo') && /Terminar almuerzo/.test(lb()) && !/sumarPallet\(1\)/.test(lb());
      const t0 = totalPallets(l); await sumarPallet(1);
      r.almSinPallet = totalPallets(l) === t0 && !claveSinRegistro(l, Date.now() + 5 * 3600000) && ritmoLinea(l).paroH === 0;
      await terminarAlmuerzoLinea();
      r.lineaReg = !l.almuerzoActivo && l.almuerzos.length === 1 && SRV.marcas.slice(n0).filter(m => m.tipo === 'regreso_almuerzo').length === 4
        && l.personas.every(p => estadoMarca(p.personaId).estado === 'presente') && /sumarPallet\(1\)/.test(lb()) && /Almuerzo: /.test(lb());
      window.confirm = c0; }
    // una línea en marcha sin pallets (arrancada por error) se puede quitar sin marcar salidas
    { const c0 = window.confirm, SRV = window.__SRV; window.confirm = () => true;
      const l2 = JSON.parse(JSON.stringify(l)); l2.id = 'tmpq'; l2.pallets = []; l2.paros = []; l2.almuerzos = []; S.lineas.push(l2);
      _lineaAbierta = 'tmpq'; renderLineaModal(); r.btnQuitar = !!document.getElementById('lmQuitar');
      _lineaAbierta = l.id; renderLineaModal(); r.sinBtnConPallets = !document.getElementById('lmQuitar');
      _lineaAbierta = 'tmpq'; const n0 = SRV.marcas.length; await eliminarLinea();
      r.quitada = !S.lineas.some(x => x.id === 'tmpq') && SRV.marcas.length === n0 && S.lineas.some(x => x.id === l.id);
      _lineaAbierta = l.id; window.confirm = c0; }
    hideModal('modalLinea');
    // vuelve el turno regular: la línea sigue en marcha, se ve en el resumen y los operadores pueden apoyarla
    S.turno = turnoGuardado; S.tareasActivas = []; renderAll();
    r.resumen = !document.getElementById('secLineas').classList.contains('hidden') && /Inserto botella/.test(document.getElementById('lineasTurno').innerHTML);
    _sel = new Set(['c1']); abrirAsignar(); r.chipLinea = !document.getElementById('asigLineaField').classList.contains('hidden');
    setAsigLinea(l.id); elegirTarea('t1'); await new Promise(res => setTimeout(res, 50));
    const ta = S.tareasActivas.find(t => t.lineaId === l.id); if (ta) ta.inicio = Date.now() - 2 * 3600000;
    r.apoyoOp = ta && Math.abs(apoyoOperadores(l.id).total - 2) < 0.05 && /línea [A-Z]+ · Inserto botella/.test(document.getElementById('equipoList').innerHTML);
    // cerrar el turno regular no cierra la línea
    await liberar(['c1']); hideModal('modalCantidad'); S.historial.forEach(h => h.cantPend = false);
    r.independiente = l.estado === 'corriendo';
    abrirLinea(l.id); await cerrarLinea(); r.pickCierre = !!document.getElementById('lmCierreSalida') && !!document.getElementById('lmCierreSiguen') && l.estado === 'corriendo';
    { const SRV = window.__SRV, n0 = SRV.marcas.length; await cerrarLinea('salida'); const nuevas = SRV.marcas.slice(n0);
      r.salidaLinea = l.estado === 'cerrada' && nuevas.length === 4 && nuevas.every(m => m.tipo === 'salida' && /^Salida con la línea [A-Z]+ · /.test(m.motivo)) && l.personas.every(p => estadoMarca(p.personaId).estado === 'salio'); }
    hideModal('modalLinea');
    r.cierre = l.estado === 'cerrada' && l.fin > 0;
    exportExcel(null);
    const hojas = window.__xlsx.w.s.slice(-4, -2), lr = hojas[0][1].find(x => /^[A-Z]+ · Inserto botella$/.test(x[1]));
    const det = window.__xlsx.w.s.slice(-9)[0][1]; const cols = det[0];
    const lh = hojas[0][1][0], cu = hojas[1];
    r.excel = lr && lr[lh.indexOf('Pallets')] === 3 && lr[lh.indexOf('Personas')] === 4 && !lh.includes('Paletizan') && Math.abs(lr[lh.indexOf('Horas operadores de apoyo')] - 2) < 0.05 && cu[0] === 'Cuadrilla de línea' && cu[1].length === 5 && det.some(x => x[cols.indexOf('Apoyo a línea')] === 'Inserto botella');
    r.insights = /Horas operadores/.test(buildLineasSection());
    await limpiarTmp(); return r; });
  ok(ln.migra, 'línea: las líneas y planes anteriores se migran solos al módulo propio');
  ok(ln.calc && ln.calcTxt && ln.inversa, 'línea: personas = meta ÷ (productividad × horas) = 10; con 8 personas → 32 pallets y faltan 2');
  ok(ln.chips && ln.otroDia && ln.futura, 'línea: se planifica cualquier día; la futura no se arranca antes de su fecha');
  ok(ln.hoy && ln.corre, 'línea: funciona sin turno regular abierto y guarda quién está a cargo');
  ok(ln.nombres && ln.recuerda, 'línea: la cuadrilla es solo la lista de quienes marcaron (sin puestos ni duplicados); sin marcajes no arranca; sin supervisor ni responsable sí');
  ok(ln.almBloq && ln.almOk, 'línea: quien está en almuerzo se ve en la cuadrilla y su almuerzo no cuenta en sus horas de línea');
  ok(ln.btnAlm && ln.lineaAlm, 'línea: «Almuerzo de la línea» manda a almuerzo a toda la cuadrilla y lo registra en el marcaje de cada uno');
  ok(ln.almSinPallet, 'línea: en almuerzo no se suman pallets, no avisa «sin registrar» y no cuenta como paro');
  ok(ln.lineaReg, 'línea: «Terminar almuerzo» registra el regreso de todos y vuelve a sumar pallets');
  ok(ln.letras, 'línea: cada línea del día lleva su letra (A, B, C…), sin repetirse aunque dos la creen a la vez');
  ok(ln.tarjeta, 'línea: la tarjeta muestra «Línea A · nombre» y el primer nombre de la cuadrilla (con inicial si se repite)');
  ok(ln.btnQuitar && ln.sinBtnConPallets && ln.quitada, 'línea: en marcha y sin pallets se puede quitar, sin marcar la salida de nadie (con pallets, no)');
  ok(ln.pallets && ln.bloque, 'línea: un solo contador de pallets por línea (+1 / +5 / −1); el bloque muestra cuántas personas');
  ok(ln.resumen && ln.chipLinea && ln.apoyoOp, 'línea: resumen en el turno; tarea de operador marcada como apoyo a la línea (2 h)');
  ok(ln.independiente && ln.cierre, 'línea: su ciclo es propio (se cierra con su botón, no con el turno)');
  ok(ln.pickCierre && ln.salidaLinea, 'línea: al cerrar, el encargado da la salida a toda la cuadrilla a la vez (como el almuerzo), como su salida del día');
  ok(ln.excel && ln.insights, 'línea: Excel e Insights con pallets, cuadrilla y horas de operadores de apoyo');
  // 9f) Paros e insumos de línea
  const pi = await page.evaluate(async () => {
    const r = {}, H = 3600000, t0 = Date.now() - 4 * H;
    const c0 = window.confirm; window.confirm = () => true;
    S.lineasTipo[0].insumos = [{ nombre: 'Cajas', unidad: 'unid', porPallet: 84 }, { nombre: 'Stretch', unidad: 'rollo', porPallet: 0.1 }];
    const l = nuevaLinea(S.lineasTipo[0], 20, 8); S.lineas.push(l);
    r.snap = l.insumos.length === 2 && l.insumos[0].porPallet === 84;
    mkTmp('tmp_u1', 'Uno', 'linea'); mkTmp('tmp_j2', 'Jefa Línea', 'responsable'); await cargarPersonal(); await cargarMarcas();
    l.personas.push({ id: 'pp1', nombre: 'Uno', personaId: 'tmp_u1', desde: null });
    abrirLinea(l.id); await arrancarLinea(); l.inicio = t0; l.personas[0].desde = t0;
    for (let k = 0; k < 4; k++) await sumarPallet(1);
    // paro: 30 min por falta de insumo
    renderLineaModal(); r.boton = /Registrar paro/.test(document.getElementById('lineaBody').innerHTML);
    _paroPick = true; renderLineaModal(); document.getElementById('paroNota').value = 'Sin cajas';
    await iniciarParo(causasParo().indexOf('Falta de insumo'));
    l.paroActivo.inicio = Date.now() - 0.5 * H;
    r.enParo = !!l.paroActivo && /En paro/.test(document.getElementById('lineasList').innerHTML) && /Reanudar/.test(document.getElementById('lineaBody').innerHTML);
    // aviso de paro largo (umbral 15 min) que lleva a la línea
    _avisados.clear(); _avisosApp = []; revisarAlertasLineas();
    const av = _avisosApp.find(a => a.data && a.data.accion === 'linea'); r.avisoParo = !!av && /en paro/.test(av.cuerpo);
    await reanudarLinea(); r.reanuda = !l.paroActivo && l.paros.length === 1 && l.paros[0].causa === 'Falta de insumo' && l.paros[0].nota === 'Sin cajas';
    revisarAlertasLineas(); r.avisoSeQuita = !_avisosApp.some(a => a.key.startsWith('paro|'));
    const rt = ritmoLinea(l); r.metricas = Math.abs(rt.paroH - 0.5) < 0.02 && Math.abs(rt.disponibilidad - 0.875) < 0.01;
    // insumos: entrega 400 cajas → esperado 4×84 = 336, alcanza para 0 pallets (64 sobran < 84) → aviso
    abrirLinea(l.id); document.getElementById('insQ_' + l.insumos[0].id).value = '400'; await entregarInsumo(l.insumos[0].id);
    const e1 = estadoInsumo(l.insumos[0], l); r.alcanza = e1.esp === 336 && e1.ent === 400 && e1.alcanza === 0;
    r.agota = insumosPorAgotar(l).length === 1 && /Por agotarse/.test(document.getElementById('lineaBody').innerHTML);
    revisarAlertasLineas(); r.avisoInsumo = _avisosApp.some(a => a.key.startsWith('insumo|'));
    document.getElementById('insQ_' + l.insumos[0].id).value = '200'; await entregarInsumo(l.insumos[0].id);
    r.alcanzaMas = estadoInsumo(l.insumos[0], l).alcanza === 3;
    // nuevo paro abierto se cierra al cerrar la línea; sobrante 250 → consumo 350, diferencia +14 (+4%)
    _paroPick = true; renderLineaModal(); await iniciarParo(0);
    await guardarSobrante(l.insumos[0].id, '250'); { const n0 = window.__SRV.marcas.length; await cerrarLinea('siguen'); r.siguen = l.estado === 'cerrada' && window.__SRV.marcas.length === n0; }
    const e2 = estadoInsumo(l.insumos[0], l);
    r.cierre = l.estado === 'cerrada' && !l.paroActivo && l.paros.length === 2 && e2.real === 350 && e2.dif === 14 && Math.round(e2.difPct) === 4;
    hideModal('modalLinea');
    exportExcel(null); const hs = window.__xlsx.w.s.slice(-2);
    r.excel = hs[0][0] === 'Paros de línea' && hs[0][1].some(x => x[2] === 'Falta de insumo' && x[5] === 30) && hs[1][0] === 'Insumos de línea' && hs[1][1].some(x => x[2] === 'Cajas' && x[9] === 350 && x[10] === 14);
    const ins = buildLineasSection(); r.insights = /Falta de insumo/.test(ins) && /Consumo real/.test(ins);
    // causas configurables
    openModalCausas(); addCausa('Lluvia'); await guardarCausas(); r.causas = causasParo().includes('Lluvia');
    await limpiarTmp(); window.confirm = c0; return r; });
  ok(pi.snap && pi.boton, 'paros/insumos: la línea copia los insumos del tipo; botón Registrar paro');
  ok(pi.enParo && pi.reanuda, 'paro: la línea queda en paro con su causa y nota hasta Reanudar');
  ok(pi.avisoParo && pi.avisoSeQuita, 'paro: aviso si pasa de 15 min (lleva a la línea) y se quita al reanudar');
  ok(pi.metricas, 'paro: 30 min de paro en 4 h → 87.5% corriendo');
  ok(pi.alcanza && pi.agota && pi.avisoInsumo && pi.alcanzaMas, 'insumos: esperado = pallets × estándar; alcanza para N pallets; aviso de insumo por agotarse');
  ok(pi.cierre, 'insumos: consumo real = entregado − sobrante y diferencia; cerrar la línea termina el paro abierto');
  ok(pi.siguen, 'línea: «Cerrar; siguen en otra línea» no registra la salida de nadie');
  const ayer = await page.evaluate(async () => {
    const SRV = window.__SRV, H = 3600000, ay = fechaMenos(hoyStr(), 1), r = {};
    const mk = (id, nombre, fecha, tipo, ts) => { if (!SRV.personal.some(x => x.id === id)) SRV.personal.push({ key: STATE_KEY, id, nombre, cedula: 'X' + id, puesto_def: 'linea', activo: true });
      SRV.marcas.push({ id: ++SRV.marcaSeq, key: STATE_KEY, persona_id: id, nombre, fecha, tipo, puesto: 'linea', ts: new Date(ts).toISOString(), por: 'admin', anulado: false }); };
    const t8 = new Date(ay + 'T08:00:00').getTime();
    mk('tmp_y1', 'Volvio Hoy', ay, 'entrada', t8); mk('tmp_y1', 'Volvio Hoy', hoyStr(), 'entrada', Date.now() - 30 * 60000);
    mk('tmp_y2', 'No Volvio', ay, 'entrada', t8);
    await cargarPersonal(); await cargarMarcas();
    const l = { ...nuevaLinea(S.lineasTipo[0], 10, 8, ay), estado: 'corriendo', inicio: t8, pallets: [t8 + H],
      personas: [{ id: 'q1', nombre: 'Volvio Hoy', personaId: 'tmp_y1', desde: t8 }, { id: 'q2', nombre: 'No Volvio', personaId: 'tmp_y2', desde: t8 }] };
    S.lineas.push(l); _lineaAbierta = l.id; await cerrarLinea(); r.aviso = /se cierra a las 16:00/.test(document.getElementById('lineaBody').innerHTML);
    const n0 = SRV.marcas.length; await cerrarLinea('salida'); const nuevas = SRV.marcas.slice(n0);
    r.ok = nuevas.length === 1 && nuevas[0].persona_id === 'tmp_y2' && new Date(nuevas[0].ts).getHours() === 16 && new Date(l.fin).getHours() === 16 && estadoMarca('tmp_y1').estado === 'presente';
    r.servidor = (await rpc('ch_salida_cierre', { p_token: SESSION.token, p_key: STATE_KEY, p_persona: 'tmp_y1', p_ts: new Date().toISOString(), p_motivo: 'x', p_fecha: ay })) === null;
    S.lineas = S.lineas.filter(x => x.id !== l.id); await limpiarTmp(); hideModal('modalLinea'); return r; });
  ok(ayer.aviso && ayer.ok, 'línea de ayer cerrada hoy: se cierra con sus horas planificadas (8:00 + 8 h), no con el turno; no le da salida a quien ya entró hoy, sí a quien no volvió');
  ok(await page.evaluate(() => { const l = { fecha: hoyStr(), inicio: Date.now() - 3600000, horas: 8, pallets: [] }; return Math.abs(horaCierreLinea(l) - Date.now()) < 2000; }), 'línea de hoy: se cierra en el momento en que se cierra, aunque el turno siga activo');
  ok(ayer.servidor, 'servidor: no da salida por cierre si la entrada abierta es de otro día');
  const tot = await page.evaluate(() => {
    const H = 3600000, t0 = Date.now() - 2 * H, mk = (meta, n, pers, est) => ({ ...nuevaLinea(S.lineasTipo[0], meta, 8, hoyStr()), estado: est, inicio: t0, fin: est === 'cerrada' ? Date.now() - H : null,
      pallets: Array.from({ length: n }, (_, k) => t0 + (k + 1) * 600000), personas: pers.map((x, i) => ({ id: 'z' + x + i, nombre: x, personaId: 'zz' + x, desde: t0 })) });
    const guard = S.lineas; S.lineas = [mk(15, 9, ['Ana', 'Beto', 'Caro'], 'corriendo'), mk(10, 6, ['Dani', 'Eva'], 'corriendo'), mk(8, 2, ['Ana'], 'cerrada')]; asignarLetras();
    const h = htmlResumenLineas(lineasHoy()); S.lineas = guard;
    return /Total del día/.test(h) && /17 <span[^>]*>\/ 33<\/span>/.test(h) && /52% de la meta/.test(h) && /2 en marcha · 1 cerrada/.test(h) && />5<\/div><div class="stat-sub">en líneas ahora/.test(h); });
  ok(tot, 'líneas: tarjeta «Total del día» con pallets / meta, %, proyección, personas, ritmo y paros sumados');
  const qp = await page.evaluate(async () => {
    const c0 = window.confirm; window.confirm = () => true; const r = {}, H = 3600000, t0 = Date.now() - 2 * H;
    ['tmp_q1', 'tmp_q2', 'tmp_q3'].forEach((id, i) => mkTmp(id, ['Ana Uno', 'Beto Dos', 'Caro Tres'][i], 'linea', 'entrada', 3 * H));
    await cargarPersonal(); await cargarMarcas();
    const l = { ...nuevaLinea(S.lineasTipo[0], 12, 8, hoyStr()), estado: 'corriendo', inicio: t0, pallets: [t0 + H],
      personas: [{ id: 'a1', nombre: 'Ana Uno', personaId: 'tmp_q1', desde: t0 }, { id: 'a2', nombre: 'Beto Dos', personaId: 'tmp_q2', desde: t0 }, { id: 'a3', nombre: 'Caro Tres', personaId: 'tmp_q3', desde: Date.now() - 2 * 60000 }] };
    S.lineas.push(l); asignarLetras(); _lineaAbierta = l.id; renderLineaModal();
    r.boton = /quitarPersonaLinea\('a1'\)/.test(document.getElementById('lineaBody').innerHTML);
    const l2 = { ...nuevaLinea(S.lineasTipo[0], 12, 8, hoyStr()), estado: 'corriendo', inicio: t0, pallets: [], personas: [] }; S.lineas.push(l2); asignarLetras();
    const n0 = window.__SRV.marcas.length;
    quitarPersonaLinea('a1'); r.panel = /Pasa a otra línea/.test(document.getElementById('lineaBody').innerHTML) && /Sale de las líneas/.test(document.getElementById('lineaBody').innerHTML);
    _qp.modo = 'sale'; _qp.motivo = 'Pasa al turno u otra tarea'; await confirmarQuitar('sale');
    quitarPersonaLinea('a3'); await confirmarQuitar('error');
    quitarPersonaLinea('a2'); _qp.modo = 'linea'; renderLineaModal(); r.destinos = document.getElementById('lineaBody').innerHTML.includes("confirmarQuitar('linea','" + l2.id + "')");
    await confirmarQuitar('linea', l2.id);
    const a2 = l.personas.find(p => p.id === 'a2');
    r.mueve = a2 && a2.hasta > 0 && a2.pasoA === lin(l2) && activosLinea(l2).some(p => p.personaId === 'tmp_q2') && !activosLinea(l).length;
    const a1 = l.personas.find(p => p.id === 'a1');
    r.ok = !!a1 && a1.hasta > 0 && !l.personas.some(p => p.id === 'a3') && window.__SRV.marcas.length === n0
      && a1.motivoSalida === 'Pasa al turno u otra tarea' && Math.abs(horasEnLinea(a1, l) - 2) < 0.05 && disponiblesLinea().some(p => p.id === 'tmp_q1') && !disponiblesLinea().some(p => p.id === 'tmp_q2')
      && /salió .*Pasa al turno/.test(document.getElementById('lineaBody').innerHTML);
    // «Se fue a casa»: le registra la salida
    _lineaAbierta = l2.id; const b2 = activosLinea(l2)[0]; quitarPersonaLinea(b2.id); _qp.modo = 'sale'; _qp.motivo = 'Se fue a casa'; await confirmarQuitar('sale');
    r.casa = window.__SRV.marcas.slice(n0).some(m => m.persona_id === 'tmp_q2' && m.tipo === 'salida' && /Se fue a casa/.test(m.motivo)) && estadoMarca('tmp_q2').estado === 'salio';
    _lineaAbierta = l.id;
    renderLineas(); const html = document.getElementById('lineasList').innerHTML;
    r.tarjeta = !/>Ana ·|· Ana</.test(html) && cuadrillaSinSalida(l).length === 0;
    S.lineas = S.lineas.filter(x => x.id !== l.id && x.id !== l2.id); await limpiarTmp(); hideModal('modalLinea'); window.confirm = c0; return r; });
  ok(qp.boton && qp.panel && qp.ok, 'línea en marcha: quitar a una persona pregunta qué pasa; «sale de las líneas» pide motivo, guarda sus horas y queda disponible; «por error» la borra');
  ok(qp.destinos && qp.mueve, 'línea en marcha: «pasa a otra línea» la deja en la línea elegida desde ese momento');
  ok(qp.casa, 'línea en marcha: «se fue a casa» le registra la salida');
  ok(qp.tarjeta, 'línea en marcha: quien salió de la línea ya no cuenta en la tarjeta ni recibe la salida al cerrar');
  const dn = await page.evaluate(async () => {
    const SRV = window.__SRV, ay = fechaMenos(hoyStr(), 1), r = {};
    if (!SRV.personal.some(x => x.id === 'tmp_dn')) SRV.personal.push({ key: STATE_KEY, id: 'tmp_dn', nombre: 'Dia Nuevo', cedula: '5555', puesto_def: 'linea', activo: true });
    const t = Math.max(Date.now() - 19 * 3600000, new Date(ay + 'T18:00:00').getTime());
    SRV.marcas.push({ id: ++SRV.marcaSeq, key: STATE_KEY, persona_id: 'tmp_dn', nombre: 'Dia Nuevo', fecha: ay, tipo: 'entrada', puesto: 'linea', ts: new Date(t).toISOString(), por: 'admin', anulado: false });
    await cargarPersonal(); await cargarMarcas();
    const h = new Date().getHours(); r.aplica = h >= 5;
    if (!r.aplica) { await limpiarTmp(); return r; }
    r.fuera = estadoMarca('tmp_dn').estado === 'fuera';
    r.servidor = (await rpc('ch_marcar', { p_token: SESSION.token, p_key: STATE_KEY, p_persona: 'tmp_dn', p_cedula: '5555', p_tipo: 'salida' }).catch(e => e.message)) === 'SECUENCIA';
    const m = await rpc('ch_marcar', { p_token: SESSION.token, p_key: STATE_KEY, p_persona: 'tmp_dn', p_cedula: '5555', p_tipo: 'entrada', p_puesto: 'linea' });
    const auto = SRV.marcas.find(x => x.persona_id === 'tmp_dn' && x.tipo === 'salida');
    r.ok = m.fecha === hoyStr() && auto && auto.fecha === ay && /Salida automática/.test(auto.motivo) && Date.parse(auto.ts) < Date.parse(m.ts);
    await limpiarTmp(); return r; });
  ok(!dn.aplica || (dn.fuera && dn.servidor && dn.ok), 'marcaje: desde las 5:00 de un día nuevo se marca entrada; la entrada abierta de ayer se cierra sola (salida automática)');
  const jst = await page.evaluate(async () => {
    const SRV = window.__SRV, f = fechaMenos(hoyStr(), 3), g = fechaMenos(hoyStr(), 4), r = {};
    const mk = (id, nombre, puesto, fecha, h) => { if (!SRV.personal.some(x => x.id === id)) SRV.personal.push({ key: STATE_KEY, id, nombre, cedula: 'X' + id, puesto_def: puesto, activo: true });
      SRV.marcas.push({ id: ++SRV.marcaSeq, key: STATE_KEY, persona_id: id, nombre, fecha, tipo: 'entrada', puesto, ts: new Date(fecha + 'T' + h + ':00').toISOString(), por: 'admin', anulado: false }); };
    mk('tmp_j1', 'Op Sin Turno', 'operador', f, '08:20'); mk('tmp_j2', 'Linea Sin Turno', 'linea', f, '08:10');
    S.turnosHistorial.push({ id: 'tjst', fecha: g, hora: '08:00', inicio: Date.now(), fin: Date.now(), equipo: [], historial: [], estado: 'cerrado' }); await save();
    mk('tmp_j3', 'Op Con Turno', 'operador', g, '08:20');
    Object.keys(localStorage).filter(k => k.startsWith('ch_jst_')).forEach(k => localStorage.removeItem(k));
    const n = await jornadaSinTurnoAuto();
    const de = id => SRV.marcas.filter(m => m.persona_id === id && !m.anulado).map(m => m.tipo + '@' + new Date(m.ts).getHours()).join(',');
    r.op = de('tmp_j1') === 'entrada@8,salida_almuerzo@12,regreso_almuerzo@13,salida@17';
    r.linea = de('tmp_j2') === 'entrada@8';
    r.conTurno = de('tmp_j3') === 'entrada@8';
    r.n = n >= 1; r.unaVez = (await jornadaSinTurnoAuto()) === 0;
    S.turnosHistorial = S.turnosHistorial.filter(t => t.id !== 'tjst'); await save(); await limpiarTmp(); return r; });
  ok(jst.op && jst.n && jst.unaVez, 'día sin turno: la app completa sola la jornada de 8 a 5 (con almuerzo) a supervisor, ayudante y operador sin salida');
  ok(jst.linea && jst.conTurno, 'día sin turno: no toca al personal de línea ni los días que sí tuvieron turno');
  ok(pi.excel && pi.insights && pi.causas, 'paros/insumos: Excel (Paros e Insumos de línea), Insights y causas configurables');

  // 9g) Marcaje de asistencia: personal con cédula, tablet en modo quiosco, turno armado solo, horas pagadas, planilla
  const mk = await page.evaluate(async () => {
    const r = {}, c0 = window.confirm; window.confirm = () => true;
    hideModal('modalLinea'); S.tareasActivas = []; S.historial.forEach(h => h.cantPend = false);
    // alta de personal (admin): colaborador del maestro + supervisor + persona de línea
    const alta = async (id, nombre, ced, puesto) => { openModalPersona(id); document.getElementById('peNombre').value = nombre; document.getElementById('peCedula').value = ced; _pePuesto = puesto; await guardarPersona(); };
    await alta('c1', 'Juan Pérez', '8-111-1111', 'operador'); await alta(null, 'Sara Supervisora', '8-222-2222', 'supervisor'); await alta(null, 'Rosa Línea', 'E-8-333', 'linea');
    openModalPersona(); document.getElementById('peNombre').value = 'Copia'; document.getElementById('peCedula').value = '8-111-1111'; await guardarPersona();
    r.dup = /ya está registrada/.test(document.getElementById('peErr').textContent); hideModal('modalPersona');
    r.cifrada = !JSON.stringify(S).includes('8-111-1111') && !JSON.stringify(window.__SRV.rows.ctrl_horas_test.value).includes('8-111-1111');
    const sara = _personal.find(p => p.nombre === 'Sara Supervisora').id, rosa = _personal.find(p => p.nombre === 'Rosa Línea').id;
    // tablet en modo quiosco
    await activarKiosco();
    r.kiosco = document.body.classList.contains('en-kiosco') && !document.getElementById('viewMarcaje').classList.contains('hidden') && document.querySelectorAll('#kiGrid .ki-p').length === 3;
    const marcar = async (pid, ced, tipo, puesto, bodega) => { abrirMarca(pid); if (tipo) _marca.tipo = tipo; if (puesto) _marca.puesto = puesto; _marca.bodega = bodega || _marca.bodega || bodegas()[0]; document.getElementById('mmCedula').value = ced; await confirmarMarca(); await new Promise(res => setTimeout(res, 20)); };
    abrirMarca('c1'); r.soloEntrada = [...document.querySelectorAll('#mmAcciones button')].map(b => b.dataset.t).join() === 'entrada' && _marca.puesto === 'operador';
    await marcar('c1', '0000', 'entrada'); r.cedulaMala = /Cédula incorrecta/.test(document.getElementById('mmErr').textContent) && window.__SRV.marcas.length === 0;
    hideModal('modalMarca');
    await marcar('c1', '8-111-1111', 'entrada'); r.ok = !document.getElementById('kiOk').classList.contains('hidden') && /Bienvenido, Juan/.test(document.getElementById('kiOkTit').textContent);
    await marcar(sara, '8-222-2222', 'entrada', 'supervisor'); await marcar(rosa, 'e-8-333', 'entrada', 'linea');
    // con el turno abierto: el operador queda con sus marcajes; la supervisora entra al tablero; la de línea no
    const e1 = S.turno.equipo.find(c => c.id === 'c1'), es = S.turno.equipo.find(c => c.id === sara);
    r.turno = e1 && e1.marcas && e1.marcas.length === 1 && es && es.cargo === 'supervisor' && !S.turno.equipo.some(c => c.id === rosa);
    r.linea = disponiblesLinea().some(p => p.id === rosa);
    await marcar('c1', '8-111-1111', 'salida_almuerzo'); r.almuerzo = (actDe('c1') || {}).causa === 'almuerzo';
    abrirMarca('c1'); r.accAlm = [...document.querySelectorAll('#mmAcciones button')].map(b => b.dataset.t).join() === 'salida'; hideModal('modalMarca');
    await marcar('c1', '8-111-1111', 'regreso_almuerzo'); r.regreso = !actDe('c1');
    abrirMarca('c1'); r.accPres = [...document.querySelectorAll('#mmAcciones button')].map(b => b.dataset.t).join() === 'salida'; hideModal('modalMarca');
    // el supervisor pone el almuerzo en el turno: queda en el marcaje, y al terminarlo, el regreso
    await pausar(['c1'], 'almuerzo'); await new Promise(res => setTimeout(res, 40)); r.pausaMarca = estadoMarca('c1').estado === 'almuerzo';
    await liberar(['c1']); await new Promise(res => setTimeout(res, 60)); r.pausaReg = estadoMarca('c1').estado === 'presente' && !actDe('c1');
    await marcar('c1', '8-111-1111', 'salida'); r.salida = !!salioDelTurno(S.turno.equipo.find(c => c.id === 'c1')) && /Salió a las/.test(document.querySelector('.pc[data-pid="c1"]').innerHTML);
    r.secuencia = (await rpc('ch_marcar', { p_token: SESSION.token, p_key: STATE_KEY, p_persona: sara, p_cedula: '8-222-2222', p_tipo: 'regreso_almuerzo' }).catch(e => e.message)) === 'SECUENCIA';
    // salir del modo marcaje: pide la contraseña del administrador
    kioscoAdmin('salir'); document.getElementById('apPass').value = 'mala'; await confirmarAdminPass(); r.salirMal = document.body.classList.contains('en-kiosco');
    document.getElementById('apPass').value = 'secreto1'; await confirmarAdminPass(); r.salirBien = !document.body.classList.contains('en-kiosco') && !enKiosco();
    // horas pagadas desde el marcaje: 8:00–12:00 y 13:00–18:00 = 9 h → 8 h de jornada + 1 h de sobretiempo
    const H = 3600000, b = new Date('2026-10-20T08:00:00').getTime(), c = { id: 'zz', nombre: 'Test', cargo: 'operador', marcas: [{ tipo: 'entrada', ts: b }, { tipo: 'salida_almuerzo', ts: b + 4 * H }, { tipo: 'regreso_almuerzo', ts: b + 5 * H }, { tipo: 'salida', ts: b + 10 * H }] };
    const k = calcTurno({ fecha: '2026-10-20', inicio: b, fin: b + 10 * H, equipo: [c], hpPorPersona: 8 }, [{ id: 'x', tareaId: 't1', tarea: 'x', colaboradores: [c], inicio: b, fin: b + 4 * H, durH: 4 }], [], b + 10 * H), p = k.per.zz;
    r.pagadas = Math.abs(p.pagadasH - 9) < 1e-9 && Math.abs(p.extra - 1) < 1e-9 && Math.abs(p.libre - 5) < 1e-9 && Math.abs(p.pagado - p.rate * (8 + (getConfig().multSobretiempo || 1.5))) < 0.01;
    const d = diaAsistencia([{ tipo: 'entrada', ts: new Date('2026-10-20T08:20:00').getTime() }, { tipo: 'salida', ts: new Date('2026-10-20T16:20:00').getTime() }], '2026-10-20');
    r.tarde = d.tarde === 15 && Math.abs(d.horas - 8) < 1e-9;
    // planilla: período, detalle, corrección con motivo y exportación
    setNav('insights'); await cargarAsistencia(hoyStr(), hoyStr());
    const R = resumenAsistencia(); r.planilla = R.length === 3 && R.find(o => o.id === 'c1').D.length === 1;
    verAsistencia('c1'); const sal = _asist.marcas.find(m => m.persona_id === 'c1' && m.tipo === 'salida');
    abrirCorreccion(sal.id); document.getElementById('coHora').value = '23:59'; await guardarCorreccion(); r.sinMotivo = !sal.corregido_por && !window.__SRV.marcas.find(m => m.id === sal.id).corregido_por;
    document.getElementById('coMotivo').value = 'Olvidó marcar'; await guardarCorreccion();
    const sm = window.__SRV.marcas.find(m => m.id === sal.id); r.correccion = sm.corregido_por === 'admin' && sm.motivo === 'Olvidó marcar';
    exportarAsistencia(); r.excel = window.__xlsx.w.s.slice(-3).map(x => x[0]).join('|') === 'Resumen por persona|Asistencia diaria|Marcajes';
    const resX = window.__xlsx.w.s.slice(-3)[0][1], tot = resX[resX.length - 1], RR = resumenAsistencia();
    r.total = tot[0] === 'TOTAL' && Math.abs(tot[2] - Math.round(RR.reduce((x, o) => x + o.horas, 0) * 100) / 100) < 0.011 && /rt-total/.test(buildAsistenciaSection());
    // aviso de llegada para el supervisor (no en la tablet)
    const nuevo = { id: 999, persona_id: sara, nombre: 'Sara Supervisora', fecha: hoyStr(), tipo: 'entrada', puesto: 'supervisor', ts: new Date().toISOString() };
    avisarMarcas([nuevo]); r.aviso = /Llegó Sara Supervisora/.test(document.getElementById('toast').textContent);
    hideModal('modalAsist'); setNav('supervisor'); window.confirm = c0; return r; });
  ok(mk.dup && mk.cifrada, 'marcaje: alta de personal; cédula repetida rechazada; la cédula no viaja con los datos de la app');
  ok(mk.kiosco, 'marcaje: la tablet queda en modo quiosco con el personal que tiene cédula');
  ok(mk.soloEntrada && mk.cedulaMala && mk.ok, 'marcaje: ofrece solo lo que corresponde, propone la posición, rechaza cédula incorrecta y confirma en grande');
  ok(mk.turno && mk.linea, 'marcaje: operador y supervisor al tablero del turno; la persona de línea a la cuadrilla disponible');
  ok(mk.almuerzo && mk.accAlm && mk.regreso && mk.salida, 'marcaje: almuerzo pone la pausa, el regreso la quita y la salida cierra su día en el tablero');
  ok(mk.accPres && mk.accAlm, 'marcaje: la tablet ya no ofrece marcar almuerzo, solo entrada y salida');
  ok(mk.pausaMarca && mk.pausaReg, 'turno: el almuerzo que pone el supervisor queda en el marcaje (salida y regreso)');
  ok(mk.secuencia, 'marcaje: el servidor rechaza marcajes fuera de secuencia');
  ok(mk.salirMal && mk.salirBien, 'marcaje: salir del modo quiosco pide la contraseña del administrador');
  ok(mk.pagadas && mk.tarde, 'marcaje: horas pagadas desde el marcaje (9 h = 8 + 1 extra); tardanza con tolerancia');
  ok(mk.total, 'asistencia: total de horas trabajadas del período según el marcaje (pantalla y Excel)');
  ok(mk.planilla && mk.sinMotivo && mk.correccion && mk.excel, 'asistencia: resumen del período, corrección solo con motivo (queda quién) y Excel de 3 hojas');
  ok(mk.aviso, 'marcaje: aviso de llegada al supervisor/administrador');

  // 9h) Notificaciones push de llegada
  const pu = await page.evaluate(async () => {
    const r = {}, c0 = window.confirm; window.confirm = () => true; const SRV = window.__SRV;
    SRV.push = []; await activarKiosco();
    const ivan = 'p_push'; await rpc('ch_personal_upsert', { p_token: SESSION.token, p_key: STATE_KEY, p_id: ivan, p_nombre: 'Iván Push', p_cedula: '8-999-0001', p_puesto: 'operador', p_activo: true }); await cargarPersonal();
    abrirMarca(ivan); _marca.bodega = bodegas()[1]; document.getElementById('mmCedula').value = '8-999-0001'; await confirmarMarca(); await new Promise(res => setTimeout(res, 30));
    const m = SRV.marcas.find(x => x.persona_id === ivan && x.tipo === 'entrada');
    r.pide = SRV.push.some(x => x.name === 'push-marcaje' && x.body.accion === 'marca' && x.body.marcaId === m.id) && m.push_enviado;
    const n = SRV.push.length; abrirMarca(ivan); _marca.tipo = 'salida_almuerzo'; document.getElementById('mmCedula').value = '8-999-0001'; await confirmarMarca(); await new Promise(res => setTimeout(res, 30));
    r.soloEntrada = SRV.push.length === n + 1 && SRV.push[n].body.accion === 'marca';
    abrirMarca(ivan); _marca.tipo = 'regreso_almuerzo'; document.getElementById('mmCedula').value = '8-999-0001'; await confirmarMarca(); await new Promise(res => setTimeout(res, 30));
    const rg = SRV.marcas.find(x => x.persona_id === ivan && x.tipo === 'regreso_almuerzo');
    r.regreso = SRV.push.length === n + 2 && SRV.push[n + 1].body.marcaId === rg.id && rg.push_enviado;
    r.unaVez = (await funcionPush({ accion: 'marca', token: SESSION.token, key: STATE_KEY, marcaId: m.id })).enviados === 0;
    r.tabletNoRecibe = avisosEstado() !== 'granted' ? !(await suscribirPush()) : true;   // sin permiso no se registra (en modo marcaje sí, si hay permiso)
    kioscoAdmin('salir'); document.getElementById('apPass').value = 'secreto1'; await confirmarAdminPass();
    r.sinPermiso = avisosEstado() !== 'granted' ? !(await suscribirPush()) : true;
    r.sw = /addEventListener\('push'/.test(await (await fetch('sw.js')).text());
    // admin, supervisor y responsable de línea registran su celular
    const t = SESSION.token, u = currentUser; currentUser = { ...u, rol: 'responsable' }; SRV.users.find(x => x.id === u.id).rol = 'responsable';
    r.permiso = (await rpc('ch_push_subscribe', { p_token: t, p_key: STATE_KEY, p_endpoint: 'https://push.example/x', p_p256dh: 'a', p_auth: 'b' }).catch(e => e.message)) === null;
    SRV.subs = SRV.subs.filter(x => x.endpoint !== 'https://push.example/x');
    SRV.users.find(x => x.id === u.id).rol = 'admin'; currentUser = u;
    window.confirm = c0; return r; });
  ok(pu.pide && pu.soloEntrada && pu.unaVez && pu.regreso, 'push: la tablet pide el aviso en cada marcaje (el servidor decide a quién según sus interruptores) y no se repite');
  ok(pu.tabletNoRecibe && pu.sinPermiso, 'push: los equipos sin permiso no se registran');
  ok(pu.sw && pu.permiso, 'push: el service worker muestra el aviso con la app cerrada; admin, supervisor y responsable registran su celular');

  // 9j) Avisos a elección: interruptores por usuario y avisos de producción
  const avs = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, c0 = window.confirm; window.confirm = () => true;
    hideModal('modalAsist'); document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    // pantalla propia: todos los momentos con su interruptor, por omisión los del rol
    _misAvisos = null; await abrirAvisos();
    const sw = [...document.querySelectorAll('#avBody input[data-av]')], total = AVISOS_CAT.reduce((a, g) => a + (g.solo && !g.solo() ? 0 : g.items.length), 0);
    r.lista = sw.length === total && total >= 18 && !document.getElementById('modalAvisos').classList.contains('hidden') && /Mis avisos/.test(document.getElementById('avTitulo').textContent);
    r.porRol = sw.find(x => x.dataset.av === 'ent_op').checked && !sw.find(x => x.dataset.av === 'lin_mitad').checked;
    // apagar y encender: se guarda en el servidor y rige los avisos de esta app
    await cambiarAviso('ent_op', false); await cambiarAviso('lin_mitad', true);
    const mio = SRV.prefs[STATE_KEY + '|' + currentUser.id];
    r.guarda = mio && mio.ent_op === false && mio.lin_mitad === true && !avisoOn('ent_op') && avisoOn('lin_mitad');
    // en la app: la entrada de un operador ya no avisa a este usuario; la de un supervisor sí
    const tsAhora = new Date().toISOString(); showToast('-');
    avisarMarcas([{ id: 9101, persona_id: 'x1', nombre: 'Op Uno', fecha: hoyStr(), tipo: 'entrada', puesto: 'operador', ts: tsAhora }]);
    const t1 = document.getElementById('toast').textContent;
    avisarMarcas([{ id: 9102, persona_id: 'x2', nombre: 'Sup Dos', fecha: hoyStr(), tipo: 'entrada', puesto: 'supervisor', ts: tsAhora }]);
    r.filtra = !/Op Uno/.test(t1) && /Llegó Sup Dos/.test(document.getElementById('toast').textContent);
    hideModal('modalAvisos');
    // el administrador elige los avisos de otro usuario desde Usuarios
    const sup = SRV.users.find(u => u.rol === 'supervisor'); _usuarios = SRV.users.map(u => ({ id: u.id, nombre: u.nombre, username: u.username, rol: u.rol }));
    await abrirAvisos(sup.id);
    r.otro = /Avisos de/.test(document.getElementById('avTitulo').textContent) && document.querySelector('#avBody input[data-av="tur_libre"]').checked;
    await cambiarAviso('lin_meta', true);
    r.otroGuarda = SRV.prefs[STATE_KEY + '|' + sup.id].lin_meta === true && SRV.prefs[STATE_KEY + '|' + sup.id].tur_libre === true && avisoOn('lin_mitad');
    hideModal('modalAvisos');
    r.botonUsuarios = (() => { abrirSeccion('usuarios'); return /abrirAvisos\('/.test(document.getElementById('insightsContent').innerHTML); })(); setNav('supervisor');
    // producción: mitad, meta y riesgo salen una sola vez al servidor
    SRV.push = []; _avisados.clear();
    const H = 3600000, l = nuevaLinea(S.lineasTipo[0], 10, 8); S.lineas.push(l);
    Object.assign(l, { estado: 'corriendo', inicio: Date.now() - 4 * H, personas: [{ id: 'q1', nombre: 'Q', desde: Date.now() - 4 * H }], pallets: [] });
    const ev = () => SRV.push.filter(x => x.body.accion === 'evento').map(x => x.body.evento);
    l.pallets = [1, 2]; revisarProduccion(l); r.riesgo = ev().includes('lin_riesgo') && !ev().includes('lin_mitad');
    l.pallets = [1, 2, 3, 4, 5]; revisarProduccion(l); revisarProduccion(l); r.mitad = ev().filter(e => e === 'lin_mitad').length === 1;
    l.pallets = Array.from({ length: 10 }, (_, i) => i); revisarProduccion(l); r.meta = ev().includes('lin_meta');
    const rel = SRV.push.find(x => x.body.evento === 'lin_meta').body; r.texto = /Meta cumplida/.test(rel.titulo) && rel.data.lid === l.id && rel.ref === 'meta|' + l.id;
    l.estado = 'cerrada'; l.fin = Date.now(); revisarProduccion(l); r.cierre = ev().includes('lin_cierre');
    r.unaVezServidor = (await funcionPush({ accion: 'evento', token: SESSION.token, key: STATE_KEY, evento: 'lin_meta', ref: 'meta|' + l.id })).repetido === true;
    S.lineas = S.lineas.filter(x => x.id !== l.id);
    window.confirm = c0; return r; });
  ok(avs.lista && avs.porRol, 'avisos: pantalla con todos los momentos y su interruptor; por omisión los de su rol');

  // Pedidos de personal de clientes (Door Logistic): apagado por omisión; el cliente solo ve los de su empresa
  const ped = await page.evaluate(async () => {
    const r = {}, yo = currentUser, cfg0 = { ...S.config }, ped0 = S.pedidosPersonal, uc0 = S.usuariosCliente;
    S.config.pedidosClientes = false; setNav('pedidos');
    r.apagado = _nav === 'supervisor' && document.getElementById('viewPedidos').classList.contains('hidden') && pedidosBadge() === 0;
    S.config.pedidosClientes = true; S.usuariosCliente = { cli: 'kA' };
    S.clientes.push({ id: 'kA', nombre: 'Cliente A' }, { id: 'kB', nombre: 'Cliente B' });
    const man = fechaManana();
    S.pedidosPersonal = [{ id: 'pa', clienteId: 'kA', fecha: man, inicio: '08:00', fin: '17:00', lineas: [{ tipo: 'ag', cant: 3, conf: 0 }], estado: 'pendiente', log: [] },
      { id: 'pb', clienteId: 'kB', fecha: man, inicio: '08:00', fin: '17:00', lineas: [{ tipo: 'linea', cant: 5, conf: 0 }], estado: 'pendiente', log: [] }];
    r.badge = pedidosBadge() === 2;
    setNav('pedidos'); r.interno = /Cliente A/.test(document.getElementById('pedidosContent').innerHTML) && /Cliente B/.test(document.getElementById('pedidosContent').innerHTML);
    abrirRespuesta('pa', 'confirmar'); document.querySelector('#prLineas input').value = '2'; await responderPedido();
    const pa = S.pedidosPersonal.find(p => p.id === 'pa');
    r.parcial = pa.estado === 'parcial' && pa.lineas[0].conf === 2 && pa.vistoCliente === false && /Confirmó 2 de 3/.test(pa.log[0].a);
    abrirRespuesta('pb', 'rechazar'); document.getElementById('prNota').value = ''; await responderPedido();
    r.motivo = S.pedidosPersonal.find(p => p.id === 'pb').estado === 'pendiente';
    hideModal('modalPedidoResp');
    currentUser = { ...yo, rol: 'cliente', username: 'cli', nombre: 'Cli' }; setNav('supervisor');
    r.cliente = _nav === 'pedidos' && pedidosVisibles().map(p => p.id).join() === 'pa' && !/Cliente B/.test(document.getElementById('pedidosContent').innerHTML);
    currentUser = yo; S.config = cfg0; S.pedidosPersonal = ped0; S.usuariosCliente = uc0; S.clientes = S.clientes.filter(c => !['kA', 'kB'].includes(c.id));
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); setNav('supervisor'); await save();
    return r; });
  ok(ped.apagado, 'pedidos de clientes: apagado por omisión (DP World no lo ve)');
  ok(ped.badge && ped.interno, 'pedidos de clientes: la empresa ve los de todos sus clientes con la insignia de por confirmar');
  ok(ped.parcial && ped.motivo, 'pedidos de clientes: confirmar parcial deja historial; rechazar exige motivo');
  ok(ped.cliente, 'pedidos de clientes: el cliente solo entra a sus pedidos y no ve los de otra empresa');

  // Cliente del día en el marcaje (Door): apagado no se pide; encendido es obligatorio y queda en la marca
  const mcl = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, cfg0 = { ...S.config }, cli0 = S.clientes.slice();
    SRV.personal.push({ key: STATE_KEY, id: 'pcl1', nombre: 'Prueba Cliente', cedula: '9-999-9999', puesto_def: 'ag', activo: true, contingente: false, creado_por: 'admin' });
    await cargarPersonal(); await cargarMarcas();
    S.config.marcajeCliente = false; abrirMarca('pcl1');
    r.apagado = document.getElementById('mmClienteField').classList.contains('hidden');
    S.clientes = [{ id: 'kq', nombre: 'Cliente Q' }, { id: 'kr', nombre: 'Cliente R' }]; S.config.marcajeCliente = true;
    S.pedidosPersonal = (S.pedidosPersonal || []).concat([{ id: 'pq', clienteId: 'kr', fecha: hoyStr(), lineas: [{ tipo: 'ag', cant: 1, conf: 1 }], estado: 'confirmado', log: [] }]);
    abrirMarca('pcl1');
    const chips = [...document.querySelectorAll('#mmClientes .chip')].map(c => c.textContent);
    r.encendido = !document.getElementById('mmClienteField').classList.contains('hidden') && /Cliente R.*Pedido de hoy/.test(chips[0]) && _marca.cliente === 'Cliente R';
    _marca.cliente = ''; _marca.bodega = bodegas()[0] || ''; pintarMarca();
    document.getElementById('mmCedula').value = '9-999-9999'; await confirmarMarca();
    r.obligatorio = /cliente/.test(document.getElementById('mmErr').textContent) && !SRV.marcas.some(m => m.persona_id === 'pcl1');
    setMarcaCliente(0); await confirmarMarca();
    const m = SRV.marcas.find(x => x.persona_id === 'pcl1' && x.tipo === 'entrada');
    r.guarda = !!m && m.cliente === 'Cliente Q' && /Cliente Q/.test(document.getElementById('kiOkSub').textContent);
    document.getElementById('kiOk').classList.add('hidden');
    S.config = cfg0; S.clientes = cli0; S.pedidosPersonal = S.pedidosPersonal.filter(p => p.id !== 'pq');
    SRV.marcas = SRV.marcas.filter(x => x.persona_id !== 'pcl1'); SRV.personal = SRV.personal.filter(x => x.id !== 'pcl1');
    await cargarPersonal(); await cargarMarcas(); document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); await save();
    return r; });
  ok(mcl.apagado, 'marcaje: sin la función encendida no pide cliente (DP World)');
  ok(mcl.encendido, 'marcaje con cliente: primero los clientes con pedido confirmado de hoy y propone ese');
  ok(mcl.obligatorio && mcl.guarda, 'marcaje con cliente: es obligatorio en la entrada y queda guardado en la marca');

  // Planilla, cobros y proformas (Door): apagado por omisión; rubros por día, sobretiempo y maquila; el cliente aprueba con check
  const fac = await page.evaluate(async () => {
    const r = {}, yo = currentUser, c0 = window.confirm, cfg0 = { ...S.config }, bk = {};
    ['clientes', 'proformas', 'lineas', 'lineasTipo', 'servicios', 'tarifasCliente', 'fichas', 'usuariosCliente'].forEach(k => bk[k] = JSON.parse(JSON.stringify(S[k])));
    window.confirm = () => true;
    S.config.facturacion = false; setNav('planilla'); r.apagado = _nav === 'supervisor' && document.getElementById('viewCobros').classList.contains('hidden');
    S.config.facturacion = true; S.config.itbms = 7; S.config.horaInicio = '08:00'; S.config.horaFin = '17:00'; S.config.horasAlmuerzo = 1; S.config.multSobretiempo = 1.5;
    S.clientes = [{ id: 'kF', nombre: 'Cliente F' }]; S.usuariosCliente = { clif: 'kF' };
    S.servicios = [{ id: 'sa', nombre: 'Ayudante', puesto: 'ag', costoDia: 30, ventaDia: 40 }, { id: 'ss', nombre: 'Supervisor', puesto: 'supervisor', costoDia: 50, ventaDia: 80 }, { id: 'sl', nombre: 'Línea', puesto: 'linea', costoDia: 25, ventaDia: 35 }];
    S.tarifasCliente = { kF: { sa: 44 } }; S.fichas = { fa: { cedula: '8-1-1' } }; S.proformas = [];
    // miércoles fijo (sin recargo de fin de semana); Ana trabaja 08:00–19:00 sin almuerzo marcado: 11 h, 3 de sobretiempo
    const f = '2026-11-18', ts = hm => new Date(f + 'T' + hm + ':00').toISOString();
    const mk = (id, pid, nom, tipo, hm, puesto) => ({ id, persona_id: pid, nombre: nom, fecha: f, tipo, puesto, ts: ts(hm), anulado: false, bodega: 'B1', cliente: 'Cliente F' });
    const M = [mk(1, 'fa', 'Ana F', 'entrada', '08:00', 'ag'), mk(2, 'fa', 'Ana F', 'salida', '19:00', 'ag'),
      mk(3, 'fs', 'Sup F', 'entrada', '07:55', 'supervisor'), mk(4, 'fs', 'Sup F', 'salida', '17:00', 'supervisor'),
      mk(5, 'fl', 'Lin F', 'entrada', '08:00', 'linea'), mk(6, 'fl', 'Lin F', 'salida', '17:00', 'linea')];
    S.lineasTipo = [{ id: 'tF', nombre: 'Kit F', clienteId: 'kF', prod: 1, apoyo: [], insumos: [], venta: { unidad: 'caja', precio: 0.5, porPallet: 10, costeo: 'unidad', costoUnidad: 0.2 } }];
    S.lineas = [{ id: 'lF', fecha: f, tipoId: 'tF', nombre: 'Kit F', clienteId: 'kF', cliente: 'Cliente F', estado: 'cerrada', inicio: Date.parse(ts('08:00')), fin: Date.parse(ts('17:00')), meta: 10, horas: 8,
      personas: [{ id: 'x', nombre: 'Lin F', personaId: 'fl', desde: Date.parse(ts('08:00')) }], pallets: [{ ts: Date.parse(ts('12:00')), n: 4 }], insumos: [], paros: [] }];
    _cob = { desde: f, hasta: f, marcas: M, cargando: false, tab: 'detalle', fCli: 'kF', fBod: '', fEst: 'sin' };
    const O = operacionPeriodo(), ana = O.filas.find(x => x.pid === 'fa'), lin = O.filas.find(x => x.pid === 'fl');
    r.planilla = ana.cedula === '8-1-1' && ana.sup === 'Sup F' && ana.cliente === 'Cliente F' && lin.maq && lin.venta === 0 && lin.costo === 0;
    const pd = O.rubros.find(x => x.id === 'pd|fa|' + f), ex = O.rubros.find(x => x.id === 'ex|fa|' + f), mq = O.rubros.find(x => x.tipo === 'maquila');
    r.rubros = pd && pd.venta === 44 && pd.costo === 30 && ex && Math.abs(ex.cantidad - 3) < 0.01 && Math.abs(ex.venta - 3 * 44 / 8 * 1.5) < 0.02
      && mq && mq.cantidad === totalPallets(S.lineas[0]) * 10 && mq.venta === rd2(mq.cantidad * 0.5) && mq.costo === rd2(mq.cantidad * 0.2) && !O.rubros.some(x => x.id === 'pd|fl|' + f);
    setNav('cobros'); _cob.marcas = M; await crearProforma(); hideModal('modalProforma');
    const p = S.proformas[0]; r.proforma = p && p.estado === 'revision' && p.items.length === O.rubros.filter(x => x.venta > 0).length && estadoRubros()[pd.id].e === 'revision';
    currentUser = { ...yo, rol: 'cliente', username: 'clif', nombre: 'Cli F' };
    verProforma(p.id); r.sinCostos = !/Costo|Margen/.test(document.getElementById('pfBody').innerText);
    document.querySelector(`#pfBody .pf-it[data-id="${ex.id}"]`).checked = false; await confirmarProforma();
    const E = estadoRubros();
    r.confirma = p.estado === 'aprobada' && E[pd.id].e === 'porfacturar' && E[ex.id].e === 'sin' && pfTotales(p).total === rd2((p.items.filter(i => i.id !== ex.id).reduce((a, i) => a + i.venta, 0)) * 1.07);
    currentUser = yo; setNav('cobros'); _cob.marcas = M;
    // Administrador: registra la factura fiscal (pasa a por cobrar) y los cobros (abono y pago final)
    abrirFactura(p.id); document.getElementById('paNum').value = ''; await guardarFactura(p.id);
    const sinNum = p.estado === 'aprobada' && !document.getElementById('paErr').classList.contains('hidden');
    document.getElementById('paNum').value = 'F-001'; document.getElementById('paFecha').value = '2026-11-20'; document.getElementById('paCred').value = '30'; await guardarFactura(p.id);
    r.factura = sinNum && p.estado === 'facturada' && p.factura.numero === 'F-001' && p.factura.vence === '2026-12-20' && estadoRubros()[pd.id].e === 'facturado';
    const tot = pfTotales(p).total;
    abrirCobro(p.id); document.getElementById('paMonto').value = '10'; document.getElementById('paRef').value = 'ACH-1'; await guardarCobro(p.id);
    const abono = p.estado === 'facturada' && pfSaldo(p) === rd2(tot - 10);
    abrirCobro(p.id); document.getElementById('paMonto').value = String(pfSaldo(p) + 5); document.getElementById('paRef').value = 'ACH-2'; await guardarCobro(p.id);
    const pasado = p.estado === 'facturada' && !document.getElementById('paErr').classList.contains('hidden');
    document.getElementById('paMonto').value = String(pfSaldo(p)); await guardarCobro(p.id);
    r.cobro = abono && pasado && p.estado === 'cobrada' && pfSaldo(p) === 0 && estadoRubros()[pd.id].e === 'cobrado' && p.abonos.length === 2;
    hideModal('modalPfAccion'); await crearProforma(); hideModal('modalProforma');
    r.pendiente = S.proformas.length === 2 && S.proformas[1].items.length === 1 && S.proformas[1].items[0].id === ex.id;
    window.confirm = c0; S.config = cfg0; Object.assign(S, bk); _cob = { desde: null, hasta: null, marcas: [], cargando: false, tab: 'detalle', fCli: '', fBod: '', fEst: 'sin' };
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); setNav('supervisor'); await save();
    return r; });
  ok(fac.apagado, 'planilla y cobros: apagado por omisión (DP World no lo ve)');
  ok(fac.planilla, 'planilla: cédula, cliente y supervisor de la misma bodega; la cuadrilla de maquila no se cobra por día');
  ok(fac.rubros, 'cobros: persona-día con tarifa del cliente, sobretiempo por hora con recargo y maquila por caja costeada por unidad');
  ok(fac.proforma && fac.sinCostos, 'proforma: junta lo sin facturar del cliente y el cliente no ve costos');
  ok(fac.confirma && fac.pendiente, 'proforma: lo aprobado queda por facturar (con ITBMS) y lo no marcado sigue por cobrar en la siguiente');
  ok(fac.factura, 'factura: el administrador registra el número fiscal (obligatorio) y el vencimiento por días de crédito');
  ok(fac.cobro, 'cobro: abonos parciales, no deja pasar el saldo y al completar queda cobrada');

  // Turno por cliente: filtro del supervisor y Mi turno del cliente (básica o avanzada según el administrador)
  const tpc = await page.evaluate(async () => {
    const r = {}, yo = currentUser, cfg0 = { ...S.config }, bk = {}, turno0 = S.turno, act0 = S.tareasActivas, hist0 = S.historial;
    ['clientes', 'usuariosCliente', 'clientesAvanzado', 'solicitudesAvanzado', 'pedidosPersonal'].forEach(k => bk[k] = JSON.parse(JSON.stringify(S[k] || {})));
    S.config.marcajeCliente = true; S.config.pedidosClientes = true; S.config.facturacion = true;
    S.clientes = [{ id: 'kA', nombre: 'Cli A' }, { id: 'kB', nombre: 'Cli B' }]; S.usuariosCliente = { cla: 'kA' }; S.clientesAvanzado = {}; S.solicitudesAvanzado = {};
    const hoy = hoyStr(), ini = Date.now() - 2 * 3600000;
    S.turno = { id: 'tT', fecha: hoy, inicio: ini, equipo: [{ id: 'q1', nombre: 'Uno A', cargo: 'ag', cliente: 'Cli A' }, { id: 'q2', nombre: 'Dos A', cargo: 'ag', cliente: 'Cli A' }, { id: 'q3', nombre: 'Tres B', cargo: 'operador', cliente: 'Cli B' }], tareasDia: [] };
    S.tareasActivas = [{ id: 'ta1', tareaId: 'x', tarea: 'Picking A', clienteId: 'kA', cliente: 'Cli A', colaboradores: [{ id: 'q1', nombre: 'Uno A' }], inicio: ini, fin: null, cantAcum: 50, unidad: 'caja' }];
    S.historial = [];
    S.pedidosPersonal = [{ id: 'pz', clienteId: 'kA', fecha: hoy, lineas: [{ tipo: 'ag', cant: 3, conf: 3 }], estado: 'confirmado', log: [] }];
    setNav('supervisor'); setClienteFiltro('Cli A');
    const R = resumenClientesTurno(), a = R.find(g => g.n === 'Cli A');
    r.filtro = document.querySelectorAll('#equipoList .pc').length === 2 && a.pres === 2 && a.tarea === 1 && a.libre === 1 && a.conf === 3;
    _sel = new Set(['q2']); abrirAsignar(); r.asigna = _asig.cli === 'kA'; hideModal('modalAsignar'); setClienteFiltro('');
    // Cliente: los marcajes llegan filtrados por su nombre
    const ts = h => new Date(Date.now() - h * 3600000).toISOString();
    const M = [{ id: 901, persona_id: 'q1', nombre: 'Uno A', fecha: hoy, tipo: 'entrada', puesto: 'ag', ts: ts(2), cliente: 'Cli A', anulado: false },
      { id: 902, persona_id: 'q3', nombre: 'Tres B', fecha: hoy, tipo: 'entrada', puesto: 'operador', ts: ts(2), cliente: 'Cli B', anulado: false }];
    window.__SRV.marcas.push(...M.map(m => ({ ...m, key: STATE_KEY })));
    currentUser = { ...yo, rol: 'cliente', username: 'cla', nombre: 'Cliente A' };
    setNav('supervisor'); await cargarMiTurno(hoy);
    const txt = () => document.getElementById('cobContent').innerText;
    r.basica = _nav === 'miturno' && /Uno A/.test(txt()) && !/Tres B/.test(txt()) && !/Tareas y productividad/i.test(txt()) && /Solicitar la versión avanzada/i.test(txt());
    await solicitarAvanzado(); r.solicita = !!S.solicitudesAvanzado.kA;
    currentUser = yo; await toggleAvanzado('kA', true); r.activa = avanzadoDe('kA') && !S.solicitudesAvanzado.kA;
    currentUser = { ...yo, rol: 'cliente', username: 'cla', nombre: 'Cliente A' }; setNav('miturno'); await cargarMiTurno(hoy);
    r.avanzada = /Tareas y productividad/i.test(txt()) && /Picking A/.test(txt()) && /Costo del día a tu tarifa/i.test(txt());
    currentUser = yo; window.__SRV.marcas = window.__SRV.marcas.filter(m => m.id !== 901 && m.id !== 902);
    S.config = cfg0; Object.assign(S, bk); S.turno = turno0; S.tareasActivas = act0; S.historial = hist0; _mt = { fecha: null, marcas: [], cargando: false };
    setNav('supervisor'); await save(); renderAll();
    return r; });
  ok(tpc.filtro && tpc.asigna, 'turno por cliente: el supervisor filtra el tablero, ve el resumen frente a lo confirmado y al asignar se propone el cliente');
  ok(tpc.basica && tpc.solicita, 'Mi turno básico: el cliente ve solo su personal, sin tareas, y puede solicitar la versión avanzada');
  ok(tpc.activa && tpc.avanzada, 'Mi turno avanzado: el administrador la enciende por cliente y el cliente ve tareas, productividad y costo del día');

  // Ficha del cliente: tarifa negociada y versión avanzada se editan en el cliente
  const fic = await page.evaluate(async () => {
    const r = {}, cfg0 = { ...S.config }, bk = {}; ['clientes', 'tarifasCliente', 'clientesAvanzado', 'solicitudesAvanzado', 'servicios'].forEach(k => bk[k] = JSON.parse(JSON.stringify(S[k] || {})));
    S.config.facturacion = true; S.config.marcajeCliente = true;
    S.servicios = [{ id: 'sa', nombre: 'Ayudante', puesto: 'ag', costoDia: 30, ventaDia: 40 }, { id: 'so', nombre: 'Operador', puesto: 'operador', costoDia: 36, ventaDia: 55 }];
    S.clientes = [{ id: 'kF', nombre: 'Cli F' }]; S.tarifasCliente = {}; S.clientesAvanzado = {}; S.solicitudesAvanzado = { kF: { fecha: hoyStr(), por: 'X' } };
    openModalCliente('kF');
    r.campos = document.querySelectorAll('#clFicha input[data-s]').length === 2 && !!document.getElementById('clAvz') && /La solicitó/i.test(document.getElementById('clFicha').innerText);
    document.querySelector('#clFicha input[data-s="sa"]').value = '45'; document.getElementById('clAvz').checked = true; await guardarCliente();
    r.guarda = S.tarifasCliente.kF && S.tarifasCliente.kF.sa === 45 && S.tarifasCliente.kF.so === undefined && avanzadoDe('kF') && !S.solicitudesAvanzado.kF && ventaDiaCliente('kF', S.servicios[0]) === 45;
    openModalCliente('kF'); document.querySelector('#clFicha input[data-s="sa"]').value = ''; await guardarCliente();
    r.vuelve = !S.tarifasCliente.kF && ventaDiaCliente('kF', S.servicios[0]) === 40;
    r.tarifasSinCliente = !/Tarifa de venta por cliente/.test(htmlTarifas());
    S.config = cfg0; Object.assign(S, bk); document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); await save();
    return r; });
  ok(fic.campos && fic.guarda && fic.vuelve && fic.tarifasSinCliente, 'ficha del cliente: tarifa negociada por servicio y versión avanzada (vacío vuelve a la general)');

  // Tarifario: el administrador consulta todos o uno; el cliente solo sus precios de venta
  const tar = await page.evaluate(async () => {
    const r = {}, yo = currentUser, cfg0 = { ...S.config }, bk = {}; ['clientes', 'tarifasCliente', 'servicios', 'usuariosCliente', 'lineasTipo'].forEach(k => bk[k] = JSON.parse(JSON.stringify(S[k] || {})));
    Object.assign(S.config, { facturacion: true, horaInicio: '08:00', horaFin: '17:00', horasAlmuerzo: 1, multSobretiempo: 1.5, multSabado: 1, multDomingo: 2 });
    S.servicios = [{ id: 'sa', nombre: 'Ayudante', puesto: 'ag', costoDia: 30, ventaDia: 40 }];
    S.clientes = [{ id: 'kA', nombre: 'Cli A' }, { id: 'kB', nombre: 'Cli B' }]; S.tarifasCliente = { kA: { sa: 48 } }; S.usuariosCliente = { cla: 'kA' };
    S.lineasTipo = [{ id: 'tA', nombre: 'Kit A', clienteId: 'kA', prod: 1, apoyo: [], insumos: [], venta: { unidad: 'caja', precio: 0.5, porPallet: 10, costeo: 'unidad', costoUnidad: 0.2 } },
      { id: 'tB', nombre: 'Kit B', clienteId: 'kB', prod: 1, apoyo: [], insumos: [], venta: { unidad: 'paleta', precio: 30, porPallet: 1, costeo: 'personal' } }];
    r.pestana = tabsDe(CATS.find(c => c.id === 'clientes')).some(x => x[0] === 'tarifario');
    _tarCli = ''; setNav('tarifario'); const todos = document.getElementById('cobContent').innerText;
    r.admin = /Cli A/.test(todos) && /Cli B/.test(todos) && /48\.00/.test(todos) && /negociada/i.test(todos) && /Costo por día/i.test(todos) && /Kit B/.test(todos);
    currentUser = { ...yo, rol: 'cliente', username: 'cla', nombre: 'Cliente A' }; setNav('tarifario');
    const c = document.getElementById('cobContent').innerText;
    r.cliente = _nav === 'tarifario' && /48\.00/.test(c) && /9\.00/.test(c) && /96\.00/.test(c) && /Kit A/.test(c) && !/Kit B|Cli B|Costo|Margen|negociada/i.test(c) && /ITBMS/.test(c);
    currentUser = yo; S.config = cfg0; Object.assign(S, bk); _tarCli = ''; setNav('supervisor'); await save();
    return r; });
  ok(tar.pestana && tar.admin, 'tarifario: el administrador compara todos los clientes (negociada, costo, maquila) desde Clientes y cobros');
  ok(tar.cliente, 'tarifario del cliente: solo sus precios (día, hora extra, domingo) y su maquila, sin costos ni otros clientes');

  // Costos unificados (Door): el motor del turno usa el costo de la ficha de la persona o el de su servicio
  const cu = await page.evaluate(() => {
    const r = {}, cfg0 = { ...S.config }, bk = { servicios: S.servicios, fichas: S.fichas };
    const T = { id: 'tu', fecha: '2026-11-18', inicio: Date.parse('2026-11-18T08:00:00'), fin: Date.parse('2026-11-18T17:00:00'), hpPorPersona: 8,
      equipo: [{ id: 'u1p', nombre: 'Uno', cargo: 'ag' }, { id: 'u2p', nombre: 'Dos', cargo: 'operador' }] };
    S.config.facturacion = false; const dp = calcTurno(T, [], [], T.fin);
    r.dpworld = Math.abs(dp.per.u1p.rate - costoCargo('ag', T.fecha).hora) < 1e-9;
    S.config.facturacion = true; S.servicios = [{ id: 'sa', nombre: 'Ayudante', puesto: 'ag', costoDia: 32, ventaDia: 45 }, { id: 'so', nombre: 'Operador', puesto: 'operador', costoDia: 40, ventaDia: 60 }];
    S.fichas = { u2p: { costoDia: 48 } };
    const k = calcTurno(T, [], [], T.fin), hp = hpRegular();
    r.door = Math.abs(k.per.u1p.rate - 32 / hp) < 1e-9 && Math.abs(k.per.u2p.rate - 48 / hp) < 1e-9;
    S.config = cfg0; Object.assign(S, bk); return r; });
  ok(cu.dpworld && cu.door, 'costos unificados: con facturación el turno usa el costo del servicio o el propio de la persona; DP World, las tarifas por cargo');

  // Estado de cuenta: facturas pagadas, con abono, pendientes y vencidas; el cliente solo ve las suyas
  const ec = await page.evaluate(async () => {
    const r = {}, yo = currentUser, cfg0 = { ...S.config }, bk = {}; ['clientes', 'proformas', 'usuariosCliente'].forEach(k => bk[k] = JSON.parse(JSON.stringify(S[k] || {})));
    S.config.facturacion = true; S.clientes = [{ id: 'kA', nombre: 'Cli A' }, { id: 'kB', nombre: 'Cli B' }]; S.usuariosCliente = { cla: 'kA' };
    const d = n => fechaMenos(hoyStr(), n), it = (id, v) => ({ id, fecha: d(40), desc: 'R ' + id, cantidad: 1, unidad: 'día', precio: v, venta: v, costo: 0 });
    const pf = (id, cli, est, items, fac, abonos) => ({ id, numero: id, clienteId: cli, desde: d(50), hasta: d(40), estado: est, itbms: 0, items, aprobados: items.map(x => x.id), excluidos: [], abonos: abonos || [], factura: fac, log: [] });
    S.proformas = [pf('P1', 'kA', 'cobrada', [it('a', 100)], { numero: 'F1', fecha: d(40), vence: d(10) }, [{ fecha: d(5), monto: 100 }]),
      pf('P2', 'kA', 'facturada', [it('b', 200)], { numero: 'F2', fecha: d(45), vence: d(15) }, [{ fecha: d(3), monto: 50 }]),
      pf('P3', 'kB', 'facturada', [it('c', 300)], { numero: 'F3', fecha: d(2), vence: d(-28) }),
      pf('P4', 'kB', 'aprobada', [it('e', 80)], null), pf('P5', 'kA', 'aprobada', [it('f', 70)], null)];
    r.estados = estadoFactura(S.proformas[0])[2] === 'pagada' && estadoFactura(S.proformas[1])[0] === 'Vencida · con abono' && estadoFactura(S.proformas[2])[0] === 'Pendiente';
    const A = agingDe(facturasDe('')); r.aging = A.d30 === 150 && A.aldia === 300;
    _ec = { cli: '', est: 'todas' }; setNav('estado'); const t = document.getElementById('cobContent').innerText;
    r.admin = /F1/.test(t) && /F2/.test(t) && /F3/.test(t) && /Por cliente/i.test(t) && /Por facturar/i.test(t) && /150\.00/.test(t) && /Total por cobrar/i.test(t) && /P4/.test(t) && /Registrar factura/i.test(t) && tabsDe(CATS.find(c => c.id === 'clientes')).some(x => x[0] === 'estado');
    currentUser = { ...yo, rol: 'cliente', username: 'cla', nombre: 'Cliente A' }; setNav('estado'); const c = document.getElementById('cobContent').innerText;
    r.cliente = _nav === 'estado' && /F1/.test(c) && /F2/.test(c) && !/F3|P4/.test(c) && !/Registrar cobro|Registrar factura/i.test(c) && /150\.00/.test(c) && /70\.00/.test(c) && /220\.00/.test(c) && /P5/.test(c);
    currentUser = yo; S.config = cfg0; Object.assign(S, bk); _ec = { cli: '', est: 'todas' }; setNav('supervisor'); await save();
    return r; });
  ok(ec.estados && ec.aging, 'estado de cuenta: pagada, vencida con abono, pendiente y antigüedad del saldo');

  // Cotizaciones: cliente registrado (portal) y prospecto (respuesta manual); al aceptar se actualiza la tarifa
  const cot = await page.evaluate(async () => {
    const r = {}, yo = currentUser, c0 = window.confirm, p0 = window.prompt, cfg0 = { ...S.config }, bk = {};
    ['clientes', 'tarifasCliente', 'tarifasOrigen', 'servicios', 'usuariosCliente', 'lineasTipo', 'cotizaciones', 'solicitudesCot'].forEach(k => bk[k] = JSON.parse(JSON.stringify(S[k] || (Array.isArray(S[k]) ? [] : {}))));
    window.confirm = () => true; window.prompt = () => 'Por teléfono';
    Object.assign(S.config, { facturacion: true, itbms: 7, horaInicio: '08:00', horaFin: '17:00', horasAlmuerzo: 1, multSobretiempo: 1.5 });
    S.servicios = [{ id: 'sa', nombre: 'Ayudante', puesto: 'ag', costoDia: 30, ventaDia: 40 }];
    S.clientes = [{ id: 'kA', nombre: 'Cli A' }]; S.tarifasCliente = {}; S.usuariosCliente = { cla: 'kA' }; S.cotizaciones = []; S.solicitudesCot = [];
    S.lineasTipo = [{ id: 'tA', nombre: 'Kit A', clienteId: 'kA', prod: 1, apoyo: [], insumos: [], venta: { unidad: 'caja', precio: 0.5, porPallet: 10, costeo: 'unidad', costoUnidad: 0.2 } }];
    // cliente pide una cotización
    currentUser = { ...yo, rol: 'cliente', username: 'cla', nombre: 'Cliente A' }; setNav('cotizaciones'); pedirCotizacion(); document.getElementById('paSol').value = 'Necesito 5 ayudantes por 10 días'; await enviarSolicitudCot();
    r.solicita = S.solicitudesCot.length === 1 && S.solicitudesCot[0].estado === 'pendiente';
    currentUser = yo; setNav('cotizaciones');
    r.verSol = /Necesito 5 ayudantes/.test(document.getElementById('cobContent').innerText);
    editarCotizacion(null, S.solicitudesCot[0].id); _cotEd.titulo = 'Temporada';
    Object.assign(_cotEd.lineas[0], { personas: 5, dias: 10, precio: 50, horasExtra: 4 });
    _cotEd.lineas.push(nuevaLineaCot('maquila', 'kA')); ctMaquila(1, 'tA'); Object.assign(_cotEd.lineas[1], { cant: 1000, precio: 0.6 });
    await guardarCotizacion(true); hideModal('modalProforma');
    const c = S.cotizaciones[0], T = cotTotales(c);
    // 5×10×50 = 2500 + 4 h × (50/8×1.5=9.375) = 37.5 → 2537.5; maquila 600 → 3137.5; costo 1500 + 4×(30/8×1.5)=22.5 + 200 = 1722.5
    r.calculo = c.estado === 'enviada' && !!c.vence && Math.abs(T.sub - 3137.5) < 0.01 && Math.abs(T.costo - 1722.5) < 0.01 && Math.abs(T.total - 3357.13) < 0.01 && S.solicitudesCot[0].estado === 'atendida';
    // el cliente solo la consulta: sin costos y sin botón para aceptar
    currentUser = { ...yo, rol: 'cliente', username: 'cla', nombre: 'Cliente A' }; setNav('cotizaciones');
    verCotizacion(c.id); const doc = document.getElementById('pfBody').innerText;
    r.clienteVe = /Temporada/i.test(doc) && !/Costo estimado|Margen/i.test(doc) && /3,137\.50/.test(doc) && !/Aceptar cotización|Aprobar/i.test(doc) && /respóndele a Door/i.test(doc);
    hideModal('modalProforma'); currentUser = yo; setNav('cotizaciones');
    // el administrador registra el rechazo sin motivo (no deja) y luego la aprueba: pasa al tarifario
    abrirAprobacionCot(c.id, false); document.getElementById('paRef').value = ''; await guardarAprobacionCot(c.id, false); r.sinMotivo = c.estado === 'enviada';
    abrirAprobacionCot(c.id, true); document.getElementById('paVia').value = 'Correo'; document.getElementById('paRef').value = 'correo de Ana'; await guardarAprobacionCot(c.id, true);
    r.acepta = c.estado === 'aceptada' && c.via === 'Correo' && S.tarifasCliente.kA.sa === 50 && S.tarifasOrigen.kA.sa === c.numero && tipoLinea('tA').venta.precio === 0.6 && tipoLinea('tA').venta.cot === c.numero && tipoLinea('tA').venta.costeo === 'unidad';
    _tarCli = 'kA'; setNav('tarifario'); r.tarifario = new RegExp('según ' + c.numero).test(document.getElementById('cobContent').innerText); _tarCli = '';
    // prospecto: al aprobar se crea como cliente con su tarifa, en un solo paso
    editarCotizacion(); ctDestino(''); Object.assign(_cotEd.prospecto, { empresa: 'Nueva SA', contacto: 'Ana' }); _cotEd.titulo = 'Propuesta';
    Object.assign(_cotEd.lineas[0], { personas: 2, dias: 3, precio: 44 }); await guardarCotizacion(true); hideModal('modalProforma');
    const p = S.cotizaciones[1]; r.prospecto = !p.clienteId && p.prospecto.empresa === 'Nueva SA' && p.lineas[0].precio === 44;
    abrirAprobacionCot(p.id, true); await guardarAprobacionCot(p.id, true);
    const k = S.clientes.find(x => x.nombre === 'Nueva SA');
    r.alta = p.estado === 'aceptada' && !!k && p.clienteId === k.id && S.tarifasCliente[k.id].sa === 44 && ventaDiaCliente(k.id, S.servicios[0]) === 44;
    window.confirm = c0; window.prompt = p0; currentUser = yo; S.config = cfg0; Object.assign(S, bk);
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); setNav('supervisor'); await save();
    return r; });
  ok(cot.solicita && cot.verSol && cot.calculo, 'cotización: el cliente la pide; venta (personal, horas extra, maquila), costo, ITBMS y envío con vigencia');
  ok(cot.clienteVe && cot.sinMotivo && cot.acepta && cot.tarifario, 'cotización: el cliente solo la consulta; el administrador la aprueba (el rechazo exige motivo) y pasa al tarifario con su origen');
  ok(cot.prospecto && cot.alta, 'cotización a prospecto: al aprobarla se crea como cliente con su tarifa');
  ok(ec.admin && ec.cliente, 'estado de cuenta: tarjeta y columna por facturar y total por cobrar; el administrador ve todos, el cliente solo lo suyo');
  ok(avs.guarda && avs.filtra, 'avisos: cada interruptor se guarda en el servidor y decide qué avisa (entrada de operador apagada, de supervisor encendida)');
  ok(avs.otro && avs.otroGuarda && avs.botonUsuarios, 'avisos: el administrador elige los avisos de cada usuario desde Usuarios');
  ok(avs.riesgo && avs.mitad && avs.meta && avs.texto && avs.cierre && avs.unaVezServidor, 'avisos de producción: riesgo de no llegar, mitad, meta cumplida y cierre; una sola vez');

  // 9k) Sobretiempo dentro del turno
  const sob = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, c0 = window.confirm, fj0 = window.finJornada; window.confirm = () => true;
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    const orig = { turno: S.turno, act: S.tareasActivas, hist: S.historial, th: S.turnosHistorial }, H = 3600000;
    S.turno = { id: 'tst', fecha: hoyStr(), hora: '08:00', inicio: Date.now() - 8 * H, jornada: 'completa', hpPorPersona: 8, horasProd: 16,
      equipo: [{ id: 's1', nombre: 'Uno Sobre', cargo: 'operador' }, { id: 's2', nombre: 'Dos Sobre', cargo: 'operador' }] };
    S.tareasActivas = []; S.historial = []; setNav('supervisor'); renderAll();
    window.finJornada = () => Date.now() + 10 * 60000;   // la jornada termina en 10 min
    SRV.push = []; _avisados.clear(); _avisosApp = [];
    revisarAlertas();
    const card = _avisosApp.find(a => a.data && a.data.accion === 'sobre');
    r.avisoFin = !!card && /La jornada termina/.test(card.titulo) && SRV.push.some(x => x.body.evento === 'tur_sobre_fin') && /Sobretiempo/.test(document.getElementById('avisosApp').innerHTML);
    // activar: todos vienen marcados; sin motivo no deja
    abrirSobre(); r.preSel = _so.sel.size === 2 && !document.getElementById('modalSobre').classList.contains('hidden');
    _so.sel.delete('s2'); _so.horas = 2; pintarSobre(); await confirmarSobre();
    r.sinMotivo = !(S.turno.sobre || []).length && /motivo/.test(document.getElementById('soErr').textContent);
    document.getElementById('soMotivo').value = 'Carga pendiente'; await confirmarSobre();
    const so = S.turno.sobre[0];
    r.activa = so && so.personas.join() === 's1' && Math.abs(so.hasta - so.inicio - 2 * H) < 1000 && so.inicio > Date.now() && so.motivo === 'Carga pendiente';
    r.barra = !document.getElementById('sobreBar').classList.contains('hidden') && /hasta las/.test(document.getElementById('sobreBar').textContent) && /Sobretiempo/.test(document.querySelector('.pc[data-pid="s1"]').innerHTML) && !/pc-st/.test(document.querySelector('.pc[data-pid="s2"]').innerHTML);
    r.aviso = SRV.push.some(x => x.body.evento === 'tur_sobre' && /Sobretiempo activado/.test(x.body.titulo));
    revisarAlertas(); r.cardSale = !_avisosApp.some(a => a.data && a.data.accion === 'sobre');
    // ampliar 1 h
    const h0 = so.hasta; abrirSobre(); r.modoAmp = _so.modo === 'ampliar'; _so.horas = 1; await confirmarSobre();
    r.amplia = so.hasta === h0 + H && so.amp.length === 1 && SRV.push.some(x => x.body.evento === 'tur_sobre' && /ampliado/.test(x.body.titulo));
    // 15 min antes de que termine: aviso para ampliar
    window.finJornada = () => Date.now() - 3 * H; so.inicio = Date.now() - 3 * H; so.hasta = Date.now() + 10 * 60000; revisarAlertas();
    r.avisoAmp = _avisosApp.some(a => a.data && a.data.accion === 'sobre' && /El sobretiempo termina/.test(a.titulo));
    await terminarSobre(); r.termina = !sobreActivo() && so.terminado > 0;
    // motor: 08:00–20:00 sin almuerzo = 12 h; jornada 8 → 4 h extra; sobretiempo autorizado 17:00–19:00 → 2 h autorizadas, 2 sin autorizar
    const b = new Date('2026-10-20T08:00:00').getTime(), c = { id: 'zz', nombre: 'Test', cargo: 'operador', marcas: [{ tipo: 'entrada', ts: b }, { tipo: 'salida', ts: b + 12 * H }] };
    const T2 = { id: 't2', fecha: '2026-10-20', inicio: b, fin: b + 12 * H, equipo: [c], hpPorPersona: 8, sobre: [{ id: 'x', inicio: b + 9 * H, hasta: b + 11 * H, personas: ['zz'], horas: 2, motivo: 'm' }] };
    const k = calcTurno(T2, [], [], b + 12 * H);
    r.motor = Math.abs(k.per.zz.extra - 4) < 1e-9 && Math.abs(k.extraAut - 2) < 1e-9 && Math.abs(k.extraSinAut - 2) < 1e-9;
    // asistencia: el mismo día queda con 2 h sin autorizar (pantalla y Excel)
    S.turnosHistorial = [T2, ...orig.th]; _asist.desde = '2026-10-20'; _asist.hasta = '2026-10-20';
    _asist.marcas = [{ id: 1, persona_id: 'zz', nombre: 'Test', fecha: '2026-10-20', tipo: 'entrada', puesto: 'operador', ts: new Date(b).toISOString() }, { id: 2, persona_id: 'zz', nombre: 'Test', fecha: '2026-10-20', tipo: 'salida', puesto: 'operador', ts: new Date(b + 12 * H).toISOString() }];
    const R = resumenAsistencia(); r.asist = Math.abs(R[0].extraSin - 2) < 1e-6 && /sin aut/.test(buildAsistenciaSection());
    exportarAsistencia(); const dia = window.__xlsx.w.s.slice(-2)[0][1]; r.excel = dia[0].includes('Extra sin autorizar') && dia[1][dia[0].indexOf('Extra sin autorizar')] === 2 && dia[1][dia[0].indexOf('Extra autorizado')] === 2;
    // catálogo de avisos
    r.catalogo = AVISOS_CAT.some(g => g.items.some(i => i[0] === 'tur_sobre')) && avisosDeRol('admin').tur_sobre && avisosDeRol('supervisor').tur_sobre_fin;
    _misAvisos = { ent_op: true }; r.nuevoSigueRol = avisoOn('tur_sobre') === avisosDeRol(currentUser.rol).tur_sobre;
    _misAvisos = null; _asist.marcas = []; _asist.desde = null;
    S.turno = orig.turno; S.tareasActivas = orig.act; S.historial = orig.hist; S.turnosHistorial = orig.th; window.finJornada = fj0; _avisosApp = []; pintarAvisosApp();
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    await save(); renderAll(); window.confirm = c0; return r; });
  ok(sob.avisoFin, 'sobretiempo: 15 min antes del fin de jornada avisa para activarlo (tarjeta y aviso)');
  ok(sob.preSel && sob.sinMotivo && sob.activa && sob.aviso && sob.cardSale, 'sobretiempo: se eligen personas y horas, motivo obligatorio; empieza al fin de la jornada y avisa');
  ok(sob.barra, 'sobretiempo: franja en el turno y marca en la tarjeta de quienes se quedan');
  ok(sob.modoAmp && sob.amplia && sob.avisoAmp && sob.termina, 'sobretiempo: se amplía (con aviso), avisa antes de terminar y se puede terminar');
  ok(sob.motor && sob.asist && sob.excel, 'sobretiempo: extra autorizado vs sin autorizar en el costo, la asistencia y el Excel');
  ok(sob.catalogo && sob.nuevoSigueRol, 'sobretiempo: avisos en el catálogo; un aviso nuevo sigue lo de su rol');

  // 9l) Correcciones: reapertura, plantillas, domingo, arrancar línea, unidad caja
  const fx = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, c0 = window.confirm, a0 = window.alert; let alerta = ''; window.confirm = () => true; window.alert = m => { alerta = m; };
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    const orig = { turno: S.turno, act: S.tareasActivas, hist: S.historial, th: S.turnosHistorial, sol: S.solicitudes, pl: S.plantillas };
    // reapertura: con un turno abierto no se aprueba (no se pierde el turno)
    const cerrado = { id: 'tc1', fecha: hoyStr(), hora: '07:00', inicio: Date.now() - 9 * 3600000, fin: Date.now() - 3600000, estado: 'cerrado', equipo: [{ id: 'c1', nombre: 'Juan Pérez', cargo: 'operador' }], historial: [] };
    S.turnosHistorial = [cerrado, ...orig.th]; S.solicitudes = [];
    const abierto = { id: 'tab', fecha: hoyStr(), hora: '14:00', inicio: Date.now(), equipo: [], horasProd: 0 }; S.turno = abierto; S.tareasActivas = []; S.historial = [];
    // el supervisor pide la reapertura desde su vista (lista de turnos cerrados)
    S.turno = null; renderTurnosCerrados(); r.lista = /Pedir reapertura/.test(document.getElementById('turnosCerradosList').innerHTML);
    SRV.push = []; prepSolReap('tc1'); document.getElementById('reapMotivo').value = 'Faltó cerrar una tarea'; await enviarSolicitud();
    r.pide = S.solicitudes.length === 1 && cerrado.estado === 'solicitud_pendiente' && SRV.push.some(x => x.body.evento === 'tur_reap') && /Reapertura pedida/.test(document.getElementById('turnosCerradosList').innerHTML);
    S.turno = abierto; prepAprobar(S.solicitudes[0].id); r.advierte = /Hay un turno abierto/.test(document.getElementById('aprobInfo').innerHTML);
    await resolverSolicitud(true);
    r.noBorra = S.turno && S.turno.id === 'tab' && S.solicitudes[0].estado === 'pendiente' && /Ciérralo antes/.test(alerta) && S.turnosHistorial.some(t => t.id === 'tc1');
    hideModal('modalAprobarReap');
    S.turno = null; prepAprobar(S.solicitudes[0].id); await resolverSolicitud(true);
    r.aprueba = S.turno && S.turno.id === 'tc1' && !S.turnosHistorial.some(t => t.id === 'tc1');
    // plantillas: el botón abre la ventana; «Usar» aplica jornada, personas (entre quienes marcaron) y tareas
    S.turno = null; S.turnosHistorial = orig.th; S.solicitudes = orig.sol;
    const pres = personasMarcadas(); const elegido = pres[0];
    S.plantillas = [{ id: 'pl1', nombre: 'CNP estándar', jornada: 'media', activa: true, colabs: [{ id: elegido.id, nombre: elegido.nombre }], tareas: [{ tareaId: 't1', tarea: 'Descargue', clienteId: 'k1', cliente: 'CERNAC', cantEsperada: 40, horasEsperadas: 2, unidad: 'pallet' }] }];
    openModalPlantilla(); r.ventana = !document.getElementById('modalPlantilla').classList.contains('hidden') && /CNP estándar/.test(document.getElementById('plantillasList').innerHTML) && document.getElementById('plantillaGuardarSec').classList.contains('hidden');
    await iniciarDesdePlantilla('pl1'); await new Promise(res => setTimeout(res, 50));
    const sel = [...document.querySelectorAll('#colabChips .chip.selected')].map(c => c.dataset.id);
    r.aplica = document.querySelector('#jornadaChips .chip.selected').dataset.jornada === 'media' && sel.length === 1 && sel[0] === elegido.id && /Plantilla «CNP estándar»/.test(document.getElementById('colabChipsHint').textContent);
    await abrirTurno(); r.tareas = S.turno && S.turno.plantillaId === 'pl1' && (S.turno.tareasDia || []).length === 1 && S.turno.tareasDia[0].tarea === 'Descargue' && S.turno.jornada === 'media';
    // con turno abierto: guardar el turno como plantilla
    openModalPlantilla(); r.guardarVisible = !document.getElementById('plantillaGuardarSec').classList.contains('hidden') && /Agregar sus tareas/.test(document.getElementById('plantillasList').innerHTML);
    document.getElementById('plantillaNombre').value = 'Desde turno'; await guardarPlantilla();
    const nueva = S.plantillas.find(x => x.nombre === 'Desde turno'); r.guarda = nueva && nueva.tareas.length === 1 && nueva.colabs.length === S.turno.equipo.length;
    hideModal('modalPlantilla'); hideModal('modalToolbox'); document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    // domingo (jornada 0 h): las horas no son extra; un día pasado sin salida tampoco suma extra
    const dom = '2026-11-01', H = 3600000, b = new Date(dom + 'T08:00:00').getTime();
    const d1 = diaAsistencia([{ tipo: 'entrada', ts: b }, { tipo: 'salida', ts: b + 6 * H }], dom);
    const d2 = diaAsistencia([{ tipo: 'entrada', ts: new Date('2026-10-28T08:00:00').getTime() }, { tipo: 'salida_almuerzo', ts: new Date('2026-10-28T20:00:00').getTime() }], '2026-10-28');
    r.domingo = d1.extra === 0 && d1.descanso && Math.abs(d1.horas - 6) < 1e-9 && d1.tarde === 0 && d2.extra === 0 && d2.incompleto;
    // arrancar línea: sin meta o sin cuadrilla el botón queda deshabilitado y con el motivo
    const l = nuevaLinea(S.lineasTipo[0], 0, 8); S.lineas.push(l); abrirLinea(l.id);
    const btn = [...document.querySelectorAll('#lineaBody button')].find(x => /Arrancar línea/.test(x.textContent));
    r.arrancar = btn && btn.disabled && /meta del día/.test(document.getElementById('lmArrancar').textContent) && getComputedStyle(btn).opacity < 0.6;
    document.getElementById('lmMeta').value = '10'; lineaMetaHoras(); r.arrancarMotivo = /al menos una persona de las que marcaron/.test(document.getElementById('lmArrancar').textContent);
    hideModal('modalLinea'); S.lineas = S.lineas.filter(x => x.id !== l.id);
    // catálogo: unidad «caja»
    r.caja = [...document.querySelectorAll('#tcUnidad option')].some(o => o.value === 'caja');
    S.turno = orig.turno; S.tareasActivas = orig.act; S.historial = orig.hist; S.turnosHistorial = orig.th; S.solicitudes = orig.sol; S.plantillas = orig.pl;
    await save(); renderAll(); window.confirm = c0; window.alert = a0; return r; });
  ok(fx.lista && fx.pide, 'reapertura: el supervisor la pide desde su vista (turnos cerrados recientes) y al admin le llega el aviso');
  ok(fx.advierte && fx.noBorra && fx.aprueba, 'reapertura: con un turno abierto no se aprueba (avisa y no lo borra); sin turno abierto sí');
  ok(fx.ventana && fx.aplica && fx.tareas, 'plantillas: el botón abre la ventana; «Usar» aplica jornada, personas que marcaron y tareas del día');
  ok(fx.guardarVisible && fx.guarda, 'plantillas: con turno abierto se suman sus tareas o se guarda el turno como plantilla');
  ok(fx.domingo, 'asistencia: domingo (jornada 0 h) y días pasados sin salida no suman extra');
  ok(fx.arrancar && fx.arrancarMotivo, 'línea: «Arrancar línea» deshabilitado (se ve gris) mientras falte la meta o la cuadrilla, con el motivo');
  ok(fx.caja, 'catálogo de tareas: unidad «caja»');

  // 9m) Personal de contingente (supervisor) y tutorial de primera sesión
  const ct = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, u = currentUser, sup = SRV.users.find(x => x.rol === 'supervisor');
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    // como supervisor: alta de contingente desde el menú
    SRV.sessions[SESSION.token] = sup.id; currentUser = { id: sup.id, nombre: sup.nombre, username: sup.username, rol: 'supervisor' }; pintarMenu();
    r.menu = [...document.querySelectorAll('#dpwItems .dpw-item')].some(x => /Personal/.test(x.textContent) && /contingente/i.test(x.textContent)) && tabsDe(CATS.find(c => c.id === 'personal')).some(x => /contingente/i.test(x[1]));
    SRV.push = []; await altaContingente();
    r.modal = /contingente/i.test(document.getElementById('peTitulo').textContent) && !document.getElementById('peContInfo').classList.contains('hidden') && document.getElementById('peActivoRow').classList.contains('hidden');
    document.getElementById('peNombre').value = 'Carlos Contingente'; document.getElementById('peCedula').value = '8-777-0001'; _pePuesto = 'operador'; await guardarPersona();
    const p = SRV.personal.find(x => x.nombre === 'Carlos Contingente');
    r.guarda = p && p.contingente && p.creado_por === sup.username && p.activo && SRV.push.some(x => x.body.evento === 'per_alta');
    // el supervisor no edita personas ya registradas
    openModalPersona(p.id); document.getElementById('peNombre').value = 'Otro'; document.getElementById('peCedula').value = '8-777-0002'; await guardarPersona();
    r.noEdita = /Solo puedes dar de alta personas nuevas/.test(document.getElementById('peErr').textContent) && SRV.personal.find(x => x.id === p.id).nombre === 'Carlos Contingente';
    hideModal('modalPersona');
    // como administrador: aparece marcado como contingente
    SRV.sessions[SESSION.token] = u.id; currentUser = u; pintarMenu(); await cargarPersonal();
    r.admin = /Contingente/.test(buildPersonalSection()) && /alta por super/.test(buildPersonalSection());
    // tutorial: se muestra la primera vez, recorre las tarjetas y queda como visto
    localStorage.removeItem(TUT_KEY()); r.pendiente = tutorialPendiente();
    iniciarTutorial(); const n = _tour.pasos.length;
    r.tarjeta = !document.getElementById('tour').classList.contains('hidden') && /Bienvenido/.test(document.querySelector('.tour-card').textContent) && n >= 8;
    pasoTutorial(1); r.resalta = /Menú/.test(document.querySelector('.tour-card h3').textContent) && !document.querySelector('.tour-hole').classList.contains('sin');
    let vistos = new Set(); for (let k = 0; k < n; k++) { vistos.add(document.querySelector('.tour-card h3').textContent); pasoTutorial(1); }
    r.admin_pasos = ['Personal y marcaje', 'Asistencia y planilla', 'Usuarios'].every(t => vistos.has(t));
    cerrarTutorial(); r.visto = !tutorialPendiente() && document.getElementById('tour').classList.contains('hidden') && _nav === 'supervisor';
    r.menuTut = [...document.querySelectorAll('#dpwItems *')].some(x => /Ver tutorial/.test(x.textContent));
    return r; });
  ok(ct.menu && ct.modal && ct.guarda, 'contingente: el supervisor da de alta desde el menú; queda como contingente con su nombre y avisa al admin');
  ok(ct.noEdita, 'contingente: el supervisor no puede editar personas ya registradas');
  ok(ct.admin, 'contingente: el administrador lo ve marcado como «Contingente» y quién lo dio de alta');
  ok(ct.pendiente && ct.tarjeta && ct.resalta && ct.admin_pasos, 'tutorial: primera sesión con tarjetas que resaltan cada parte (según el perfil)');
  ok(ct.visto && ct.menuTut, 'tutorial: al terminar no vuelve a salir; se repite desde «Ver tutorial»');

  // 9n) Teléfono sin registrar para avisos: aviso en la app; el admin ve quién tiene teléfono registrado
  const reg = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV; _avisosApp = []; _pushOk = false; setNav('supervisor');
    revisarRegistroAvisos();
    r.card = _avisosApp.some(a => a.key === 'avisos|equipo') && /Este teléfono no recibe avisos/.test(document.getElementById('avisosApp').textContent) && /Activar avisos/.test(document.getElementById('avisosApp').textContent);
    tocarAviso(0); await new Promise(res => setTimeout(res, 80)); r.abre = !document.getElementById('modalAvisos').classList.contains('hidden'); hideModal('modalAvisos');
    _pushOk = true; revisarRegistroAvisos(); r.sale = !_avisosApp.some(a => a.key === 'avisos|equipo');
    SRV.subs = [{ endpoint: 'https://push.example/a', usuario_id: 'u2', key: STATE_KEY }];
    await refreshUsuarios(); const html = _usuarios.map(u => u.username + ':' + equiposTxt(u)).join('|');
    r.usuarios = /super:.*avisos en 1 teléfono/.test(html) && /admin:.*sin teléfono para avisos/.test(html);
    SRV.subs = []; _pushOk = false; _avisosApp = []; pintarAvisosApp(); return r; });
  ok(reg.card && reg.abre && reg.sale, 'avisos: si este teléfono no está registrado, la app lo dice y lleva a activarlos; se quita al registrarse');
  ok(reg.usuarios, 'avisos: en Usuarios el admin ve quién tiene teléfono registrado y quién no');

  // 9o) Personal marcado sin turno abierto: aviso a los 15 min (también desde la tablet de marcaje); el kiosco no quita el registro de avisos
  const st2 = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, H = 3600000, orig = { turno: S.turno, lineas: S.lineas }, ij0 = window.inicioJornadaTs; window.inicioJornadaTs = () => 0;   // sin límite de hora de inicio: no depende de la hora en que corre
    SRV.push = []; _avisados.clear(); _avisosApp = []; S.turno = null; S.lineas = []; setNav('supervisor');
    mkTmp('tmp_s1', 'Pedro Sinturno', 'operador', 'entrada', 0.5 * H); mkTmp('tmp_s2', 'Lia Linea', 'linea', 'entrada', 0.4 * H); mkTmp('tmp_s3', 'Recien Llega', 'ag', 'entrada', 0.05 * H);
    await cargarPersonal(); await cargarMarcas(); revisarSinTurno();
    const ev = SRV.push.find(x => x.body.evento === 'tur_sin_abrir');
    r.aviso = !!ev && /2 personas marcaron y están sin turno/.test(ev.body.titulo) && /Pedro/.test(ev.body.cuerpo) && /Lia/.test(ev.body.cuerpo) && !/Recien/.test(ev.body.cuerpo);
    r.card = _avisosApp.some(a => a.data && a.data.accion === 'abrir') && /Abrir turno/.test(document.getElementById('avisosApp').textContent);
    revisarSinTurno(); r.unaVez = SRV.push.filter(x => x.body.evento === 'tur_sin_abrir').length === 1;
    const k = _avisosApp.findIndex(a => a.data && a.data.accion === 'abrir'); pintarAvisosApp(); tocarAviso(_avisosVista.findIndex(v => v.data && v.data.accion === 'abrir'));
    await new Promise(res => setTimeout(res, 50)); r.abre = !document.getElementById('modalAbrirTurno').classList.contains('hidden'); hideModal('modalAbrirTurno');
    // con turno abierto y línea en marcha, ya no avisa
    S.turno = orig.turno; S.lineas = [{ id: 'lx', estado: 'corriendo', fecha: hoyStr(), personas: [], pallets: [] }]; r.calla = !sinTurnoAhora();
    // el kiosco no quita el registro de avisos de este equipo
    SRV.calls.length = 0; window.confirm = () => true; await activarKiosco(); r.kioscoNoQuita = !SRV.calls.includes('ch_push_unsubscribe');
    kioscoAdmin('salir'); document.getElementById('apPass').value = 'secreto1'; await confirmarAdminPass();
    r.catalogo = avisosDeRol('supervisor').tur_sin_abrir && avisosDeRol('admin').tur_sin_abrir;
    S.lineas = orig.lineas; window.inicioJornadaTs = ij0; await limpiarTmp(); _avisosApp = []; pintarAvisosApp(); return r; });
  ok(st2.aviso && st2.card && st2.unaVez && st2.abre, 'sin turno: quienes marcaron hace 15 min o más sin turno (o línea) generan aviso y tarjeta «Abrir turno»; una vez por tramo');
  ok(st2.calla && st2.kioscoNoQuita && st2.catalogo, 'sin turno: con turno/línea en marcha no avisa; el modo marcaje ya no quita el registro de avisos del equipo');

  // 9p) Horario base: lo marcado antes de las 8:00 no cuenta; avisos obligatorios; turno sin cerrar; sin tarea no aplica a supervisores
  const hb = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, H = 3600000, f = '2026-10-20', at = hm => new Date(f + 'T' + hm + ':00').getTime();
    const d = diaAsistencia([{ tipo: 'entrada', ts: at('07:30') }, { tipo: 'salida_almuerzo', ts: at('12:00') }, { tipo: 'regreso_almuerzo', ts: at('13:00') }, { tipo: 'salida', ts: at('17:00') }], f);
    r.antes = Math.abs(d.horas - 8) < 1e-9 && d.extra === 0 && d.tarde === 0;
    const c = { id: 'zz', nombre: 'T', cargo: 'operador', marcas: [{ tipo: 'entrada', ts: at('07:20') }, { tipo: 'salida', ts: at('16:00') }] };
    const k = calcTurno({ fecha: f, inicio: at('07:20'), fin: at('16:00'), equipo: [c], hpPorPersona: 8 }, [], [], at('16:00'));
    r.motor = Math.abs(k.per.zz.pagadasH - 8) < 1e-9;
    // obligatorios: el supervisor no los puede apagar
    r.oblig = avisoObligatorio('supervisor', 'tur_libre') && avisoObligatorio('admin', 'tur_sin_abrir') && !avisoObligatorio('responsable', 'tur_libre');
    const sup = SRV.users.find(u => u.rol === 'supervisor'); _usuarios = SRV.users.map(u => ({ id: u.id, nombre: u.nombre, username: u.username, rol: u.rol }));
    await abrirAvisos(sup.id); const sw = document.querySelector('#avBody input[data-av="tur_libre"]');
    r.switch = sw.checked && sw.disabled && /Obligatorio para este perfil/.test(document.getElementById('avBody').textContent); hideModal('modalAvisos');
    _misAvisos = { tur_libre: false }; r.avisoOn = avisoOn('tur_libre'); _misAvisos = null;
    // turno abierto después de la salida, sin sobretiempo
    const orig = { turno: S.turno, act: S.tareasActivas }, fj0 = window.finJornada;
    S.turno = { id: 'tsc', fecha: hoyStr(), hora: '08:00', inicio: Date.now() - 10 * H, equipo: [{ id: 'u9', nombre: 'Sup Uno', cargo: 'supervisor' }, { id: 'o9', nombre: 'Op Uno', cargo: 'operador' }], hpPorPersona: 8, horasProd: 16 };
    S.tareasActivas = []; window.finJornada = () => Date.now() - 45 * 60000; SRV.push = []; _avisados.clear(); _avisosApp = [];
    const ij0 = window.inicioJornadaTs; window.inicioJornadaTs = () => 0; S.config.alertaLibreMin = 0.001; revisarAlertas(); S.config.alertaLibreMin = 15; window.inicioJornadaTs = ij0;
    r.sinCerrar = SRV.push.some(x => x.body.evento === 'tur_sin_cerrar') && _avisosApp.some(a => a.data && a.data.accion === 'cerrar');
    r.supSinTarea = !_avisosApp.some(a => a.data && a.data.accion === 'libre' && a.data.pid === 'u9') && _avisosApp.some(a => a.data && a.data.accion === 'libre' && a.data.pid === 'o9');
    S.turno = orig.turno; S.tareasActivas = orig.act; window.finJornada = fj0; _avisosApp = []; pintarAvisosApp(); return r; });
  ok(hb.antes && hb.motor, 'horario: lo marcado antes de las 8:00 no cuenta en horas ni en el pago (7:30–17:00 con almuerzo = 8 h)');
  ok(hb.oblig && hb.switch && hb.avisoOn, 'avisos obligatorios para admin y supervisores (sin turno, sin tarea, tareas largas, pendientes, fin de jornada, turno sin cerrar)');
  ok(hb.sinCerrar && hb.supSinTarea, 'turno abierto después de la salida avisa para cerrarlo; «sin tarea» no aplica a supervisores');

  // 9q) Uso correcto de la línea: pallets sin registrar y línea pasada de sus horas; obligatorios del encargado de línea
  const ul = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, H = 3600000, orig = S.lineas;
    const l = { id: 'lu', nombre: 'Inserto', estado: 'corriendo', fecha: hoyStr(), meta: 40, horas: 2, prod: 1, inicio: Date.now() - 3 * H, personas: [], pallets: [Date.now() - 40 * 60000], insumos: [], paros: [] };
    S.lineas = [l]; SRV.push = []; _avisados.clear(); _avisosApp = [];
    revisarAlertasLineas();
    const ev = SRV.push.map(x => x.body.evento);
    r.sinReg = ev.includes('lin_sin_registro') && _avisosApp.some(a => a.key.startsWith('sinreg|'));
    r.sinCerrar = ev.includes('lin_sin_cerrar') && _avisosApp.some(a => a.key.startsWith('lcierre|'));
    l.pallets.push(Date.now()); revisarAlertasLineas(); r.seQuita = !_avisosApp.some(a => a.key.startsWith('sinreg|'));
    l.paroActivo = { id: 'p1', causa: 'Falla', inicio: Date.now() - 60 * 60000 }; l.pallets.pop(); r.paroNo = !claveSinRegistro(l); delete l.paroActivo;
    r.oblig = ['lin_paro', 'lin_insumo', 'lin_riesgo', 'lin_sin_registro', 'lin_sin_cerrar', 'tur_sin_abrir'].every(e => avisoObligatorio('responsable', e) && avisoObligatorio('supervisor', e)) && !avisoObligatorio('responsable', 'tur_libre');
    S.lineas = orig; _avisosApp = []; pintarAvisosApp(); return r; });
  ok(ul.sinReg && ul.seQuita && ul.paroNo, 'línea: 30 min sin registrar pallets (sin paro) avisa; se quita al registrar; en paro no');
  ok(ul.sinCerrar && ul.oblig, 'línea: abierta más allá de sus horas avisa; avisos de línea obligatorios para supervisor y encargado de línea');

  // 9r) Bodegas: se eligen al marcar; el turno, las tareas, el filtro del supervisor, las líneas y los reportes las muestran
  const bod = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, c0 = window.confirm; window.confirm = () => true;
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    r.config = bodegas().join('|') === 'Bodega 1 CLP|Bodega 2 MSL';
    await rpc('ch_personal_upsert', { p_token: SESSION.token, p_key: STATE_KEY, p_id: 'tmp_b1', p_nombre: 'Bea Bodega', p_cedula: '8-555-0001', p_puesto: 'operador', p_activo: true });
    await rpc('ch_personal_upsert', { p_token: SESSION.token, p_key: STATE_KEY, p_id: 'tmp_b2', p_nombre: 'Beto Bodega', p_cedula: '8-555-0002', p_puesto: 'operador', p_activo: true });
    await cargarPersonal(); await activarKiosco();
    // al marcar la entrada pide la bodega
    abrirMarca('tmp_b1'); r.pide = !document.getElementById('mmBodegaField').classList.contains('hidden') && document.querySelectorAll('#mmBodegas .chip').length === 2;
    _marca.bodega = ''; document.getElementById('mmCedula').value = '8-555-0001'; await confirmarMarca();
    r.obliga = /Elige en qué bodega/.test(document.getElementById('mmErr').textContent) && !SRV.marcas.some(m => m.persona_id === 'tmp_b1');
    setMarcaBodega('Bodega 2 MSL'); await confirmarMarca(); await new Promise(res => setTimeout(res, 30));
    const mk = SRV.marcas.find(m => m.persona_id === 'tmp_b1'); r.guarda = mk && mk.bodega === 'Bodega 2 MSL' && /Bodega 2 MSL/.test(document.getElementById('kiOkSub').textContent);
    abrirMarca('tmp_b2'); setMarcaBodega('Bodega 1 CLP'); document.getElementById('mmCedula').value = '8-555-0002'; await confirmarMarca(); await new Promise(res => setTimeout(res, 30));
    // la próxima vez propone la última bodega
    await cargarMarcas(); abrirMarca('tmp_b1'); hideModal('modalMarca');
    kioscoAdmin('salir'); document.getElementById('apPass').value = 'secreto1'; await confirmarAdminPass();
    // en el turno: cada persona con su bodega; filtro del supervisor
    await cargarMarcas(); setNav('supervisor'); renderEquipo();
    const e1 = S.turno.equipo.find(c => c.id === 'tmp_b1'), e2 = S.turno.equipo.find(c => c.id === 'tmp_b2');
    r.equipo = e1 && e1.bodega === 'Bodega 2 MSL' && e2 && e2.bodega === 'Bodega 1 CLP' && /Bodega 2 MSL/.test(document.querySelector('.pc[data-pid="tmp_b1"]').textContent);
    r.filtroUI = /Todas/.test(document.getElementById('bodegaFiltro').textContent) && /Bodega 1 CLP/.test(document.getElementById('bodegaFiltro').textContent);
    setBodegaFiltro('Bodega 2 MSL');
    r.filtra = !!document.querySelector('.pc[data-pid="tmp_b1"]') && !document.querySelector('.pc[data-pid="tmp_b2"]');
    selLibres(); r.selFiltro = _sel.has('tmp_b1') && !_sel.has('tmp_b2');
    // la tarea toma la bodega de la persona; se puede mandar a la otra
    _sel = new Set(['tmp_b1']); abrirAsignar(); r.asigBodega = _asig.bodega === 'Bodega 2 MSL' && !document.getElementById('asigBodegaField').classList.contains('hidden');
    setAsigBodega('Bodega 1 CLP'); elegirTarea('t1'); await new Promise(res => setTimeout(res, 50));
    const ta = S.tareasActivas.find(t => t.colaboradores.some(c => c.id === 'tmp_b1'));
    r.tarea = ta && ta.bodega === 'Bodega 1 CLP';
    // con el filtro en Bodega 2, Bea ya no aparece: está trabajando en Bodega 1
    renderEquipo(); r.mueve = !document.querySelector('.pc[data-pid="tmp_b1"]');
    setBodegaFiltro('Bodega 1 CLP'); r.mueve = r.mueve && !!document.querySelector('.pc[data-pid="tmp_b1"]') && /en Bodega 1 CLP/.test(document.querySelector('.pc[data-pid="tmp_b1"]').textContent);
    setBodegaFiltro('');
    // reportes
    await liberar(['tmp_b1']); hideModal('modalCantidad'); S.historial.forEach(h => h.cantPend = false);
    exportExcel(null); const det = window.__xlsx.w.s.find(x => x[0] === 'Detalle Tareas')[1]; const ib = det[0].indexOf('Bodega');
    r.excel = ib >= 0 && det.some(x => x[ib] === 'Bodega 1 CLP');
    await cargarAsistencia(hoyStr(), hoyStr()); exportarAsistencia(); const dia = window.__xlsx.w.s.find(x => x[0] === 'Asistencia diaria')[1];
    r.asist = dia[0].includes('Bodega') && dia.some(x => x[1] === 'Bea Bodega' && x[dia[0].indexOf('Bodega')] === 'Bodega 2 MSL');
    S.turno.equipo = S.turno.equipo.filter(c => !c.id.startsWith('tmp_')); SRV.personal = SRV.personal.filter(x => !x.id.startsWith('tmp_')); SRV.marcas = SRV.marcas.filter(x => !x.persona_id.startsWith('tmp_'));
    await cargarPersonal(); await cargarMarcas(); setNav('supervisor'); window.confirm = c0; await save(); return r; });
  ok(bod.config && bod.pide && bod.obliga && bod.guarda, 'bodega: al marcar la entrada se elige la bodega (obligatoria) y queda en el marcaje');
  ok(bod.equipo && bod.filtroUI && bod.filtra && bod.selFiltro, 'bodega: en el turno cada persona muestra su bodega; el supervisor filtra el tablero por bodega');
  ok(bod.asigBodega && bod.tarea && bod.mueve, 'bodega: la tarea toma la bodega de la persona y se puede ejecutar en otra; el filtro la sigue');
  ok(bod.excel && bod.asist, 'bodega: Excel de tareas y de asistencia con la bodega');

  // 9s) Cierre de turno con personal sin marcar salida: aviso, confirmación, salida por cierre, notificación y reporte
  const ci = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, H = 3600000, a0 = window.alert; let alerta = ''; window.alert = m => { alerta = m; };
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    const orig = { turno: S.turno, act: S.tareasActivas, hist: S.historial, th: S.turnosHistorial.length };
    mkTmp('tmp_c1', 'Carla Cierre', 'operador', 'entrada', 3 * H); mkTmp('tmp_c2', 'Cesar Cierre', 'ag', 'entrada', 3 * H); mkTmp('tmp_c2', 'Cesar Cierre', 'ag', 'salida', 0.5 * H);
    await cargarPersonal(); await cargarMarcas();
    S.turno = { id: 'tci', fecha: hoyStr(), hora: '08:00', inicio: Date.now() - 3 * H, hpPorPersona: 8, horasProd: 16, equipo: [{ id: 'tmp_c1', nombre: 'Carla Cierre', cargo: 'operador', marcaje: true }, { id: 'tmp_c2', nombre: 'Cesar Cierre', cargo: 'ag', marcaje: true }] };
    S.turno.marcasAplicadas = Object.fromEntries(SRV.marcas.filter(m => !m.persona_id.startsWith('tmp_c')).map(m => [m.id, 1]));   // solo la gente de esta prueba
    S.tareasActivas = []; S.historial = []; aplicarMarcasAlTurno(); SRV.push = []; _avisados.clear();
    prepCerrarTurno();
    const box = document.getElementById('cTurnoSalidas').textContent;
    r.aviso = /1 persona no ha marcado su salida/.test(box) && /Carla Cierre/.test(box) && !/Cesar/.test(box) && /Salida por cierre de turno sin marcaje/.test(box);
    document.getElementById('justCausa').value = 'otro';
    await confirmarCierreTurno(); r.pideConfirmar = !!S.turno && /Confirma que se retiran/.test(alerta);
    document.getElementById('cTurnoRetiro').checked = true; await confirmarCierreTurno();
    const sal = SRV.marcas.find(m => m.persona_id === 'tmp_c1' && m.tipo === 'salida');
    r.salida = !S.turno && sal && sal.motivo === 'Salida por cierre de turno sin marcaje' && sal.push_enviado && !SRV.marcas.some(m => m.persona_id === 'tmp_c2' && m.tipo === 'salida' && m.motivo);
    r.noActivo = estadoMarca('tmp_c1').estado === 'salio';
    r.notif = SRV.push.some(x => x.body.evento === 'tur_cierre_sin_marca' && /Carla Cierre/.test(x.body.cuerpo));
    const tc = S.turnosHistorial[S.turnosHistorial.length - 1]; const ec = tc.equipo.find(e => e.id === 'tmp_c1'); r.horasTurno = ec.salidaPorCierre && ec.marcas.some(m => m.tipo === 'salida');
    // reporte de asistencia
    await cargarAsistencia(hoyStr(), hoyStr()); const R = resumenAsistencia(), oc = R.find(o => o.id === 'tmp_c1');
    r.reporte = oc && oc.cierres === 1 && /Salida por cierre/.test(buildAsistenciaSection());
    exportarAsistencia(); const dia = window.__xlsx.w.s.find(x => x[0] === 'Asistencia diaria')[1]; const obs = dia[0].indexOf('Observaciones');
    r.excel = dia.some(x => x[1] === 'Carla Cierre' && /Salida por cierre de turno sin marcaje/.test(x[obs]));
    // una entrada de otro día sin salida (más de 20 h) ya no cuenta como presente
    mkTmp('tmp_c3', 'Viejo Abierto', 'operador', 'entrada', 30 * H); const mv = SRV.marcas.find(m => m.persona_id === 'tmp_c3'); mv.fecha = fechaMenos(hoyStr(), 1);
    await cargarPersonal(); await cargarMarcas(); r.viejo = estadoMarca('tmp_c3').estado === 'fuera' && !!estadoMarca('tmp_c3').sinSalida;
    r.oblig = avisoObligatorio('supervisor', 'tur_cierre_sin_marca') && avisoObligatorio('responsable', 'tur_cierre_sin_marca');
    S.turnosHistorial.splice(orig.th); S.turno = orig.turno; S.tareasActivas = orig.act; S.historial = orig.hist; _asist.marcas = []; _asist.desde = null;
    window.alert = a0; await limpiarTmp(); document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden')); await save(); renderAll(); return r; });
  ok(ci.aviso && ci.pideConfirmar, 'cierre: avisa quiénes no marcaron salida y pide confirmar que se retiran');
  ok(ci.salida && ci.noActivo && ci.horasTurno, 'cierre: registra «Salida por cierre de turno sin marcaje» a la hora del cierre; nadie queda activo sin turno');
  ok(ci.notif && ci.oblig, 'cierre: notifica al admin y supervisores (aviso obligatorio)');
  ok(ci.reporte && ci.excel, 'cierre: Asistencia y Excel muestran la salida por cierre');
  ok(ci.viejo, 'marcaje: una entrada de otro día sin salida ya no cuenta como presente');

  // 9i) El turno solo se inicia con personal que marcó entrada
  const tm = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, a0 = window.alert; let alerta = ''; window.alert = m => { alerta = m; };
    const orig = { turno: S.turno, act: S.tareasActivas, hist: S.historial }, marcas = SRV.marcas;
    S.turno = null; document.getElementById('tFecha').value = hoyStr(); document.getElementById('tHora').value = '07:00';
    SRV.marcas = []; await cargarMarcas(); prepModalTurno();
    r.bloqueado = document.getElementById('btnAbrirTurno').disabled && document.querySelectorAll('#colabChips .chip').length === 0 && /Nadie ha marcado/.test(document.getElementById('colabChipsHint').textContent);
    await abrirTurno(); r.noAbre = !S.turno && /nadie ha marcado/.test(alerta);
    SRV.marcas = marcas.filter(m => m.puesto !== 'supervisor'); await cargarMarcas(); prepModalTurno();
    r.sinSup = !document.getElementById('btnAbrirTurno').disabled && /Ningún supervisor ha marcado hoy: el turno inicia igual/.test(document.getElementById('colabChipsHint').textContent);
    await abrirTurno(); r.sinSup = r.sinSup && !!S.turno; S.turno = null;
    SRV.marcas = marcas; await cargarMarcas(); prepModalTurno();
    const chips = [...document.querySelectorAll('#colabChips .chip')];
    r.soloMarcados = chips.length === personasMarcadas().length && chips.length > 0 && chips.every(c => c.classList.contains('selected')) && !chips.some(c => c.dataset.id === 'c2');
    r.habilitado = !document.getElementById('btnAbrirTurno').disabled;
    await abrirTurno(); r.abre = !!S.turno && chips.every(c => S.turno.equipo.some(e => e.id === c.dataset.id)) && S.turno.equipo.every(e => e.marcaje);
    hideModal('modalAbrirTurno'); document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    S.turno = orig.turno; S.tareasActivas = orig.act; S.historial = orig.hist; await save(); window.alert = a0; renderAll(); return r; });
  ok(tm.sinSup, 'turno: sin supervisor marcado se inicia igual (solo se indica)');
  ok(tm.bloqueado && tm.noAbre, 'turno: sin nadie marcado no se puede iniciar (botón deshabilitado y aviso)');
  ok(tm.soloMarcados && tm.habilitado && tm.abre, 'turno: solo ofrece y arranca con quienes marcaron entrada');

  const resp = await page.evaluate(() => { const u = currentUser; currentUser = { ...u, rol: 'responsable' }; setNav('supervisor'); pintarMenu();
    const r = { vista: !document.getElementById('viewLineas').classList.contains('hidden') && document.getElementById('viewSupervisor').classList.contains('hidden') };
    currentUser = u; setNav('supervisor'); return r; });
  ok(resp.vista, 'rol Responsable de línea: solo entra al módulo de líneas');

  // 10) Sesión persistente
  await page.reload(); await page.waitForTimeout(700);
  ok(await page.isVisible('#appScreen'), 'al recargar no pide login (sesión guardada)');
  ok(errors.length === 0, 'sin errores JS (' + errors.join(' | ') + ')');

  // 11) Supervisor no ve Insights
  const salir = await page.evaluate(() => { const c0 = window.confirm; let pregunto = ''; window.confirm = m => { pregunto = m; return false; }; pedirSalir(); const sigue = !!SESSION; window.confirm = c0; return { pregunto: /deja de recibir los avisos/.test(pregunto), sigue }; });
  const sup = await page.evaluate(() => { const tc = { id: 'tsup', nombre: 'Supervisión', prod: 2, unidad: 'pallet', efic: 85 }; S.tareasCat.push(tc); normalizeS();
    const r = !pideCantidad({ tareaId: 'tsup', tarea: 'Supervisión' }) && tc.sinProd === true && tc.prod === 0; S.tareasCat = S.tareasCat.filter(t => t.id !== 'tsup'); return r; });
  ok(sup, 'supervisión: nunca pide cantidad esperada (aunque esté configurada con productividad)');
  ok(salir.pregunto && salir.sigue, 'salir: avisa que el teléfono deja de recibir avisos y no cierra si se cancela');
  await page.evaluate(() => doLogout()); await page.waitForTimeout(300);
  await page.fill('#loginUser', 'super'); await page.fill('#loginPass', 'secreto2');
  await page.click('#loginBtn'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => ![...document.querySelectorAll('.dpw-item')].some(b => b.textContent.includes('Insights'))), 'supervisor no ve Insights en el menú');
  ok(await page.evaluate(() => document.getElementById('adminKPI').style.display !== 'flex'), 'supervisor no ve costos');
  const rsup = await page.evaluate(() => {
    const tab = CATS.find(c => c.id === 'productividad'), T = tabsDe(tab).map(x => x[0]);
    irTab('ins:exportar'); const box = document.getElementById('repBox');
    const R = construirReportes(null, {});
    return { tab: T.length === 1 && T[0] === 'ins:exportar', ve: !!box && box.querySelectorAll('.rep-lista .chip').length === 9,
      sinCostos: !R.some(r => (r.filas[0] || []).some(c => /costo|\(\$\)|pagado|perdido/i.test(c))) && R.some(r => r.nombre === 'Horas por cliente') && !/\$/.test(box.querySelector('thead').textContent) };
  });
  ok(rsup.tab && rsup.ve, 'supervisor: entra a Reportes (en Productividad solo ve esa pestaña)');
  ok(rsup.sinCostos, 'supervisor: los reportes salen sin costos (horas por cliente y por colaborador)');

  // 12) TV: solo con sesión de administrador
  const tv = await newPage(browser, { viewport: { width: 1600, height: 900 } });
  await tv.page.goto(BASE + '?tv=1'); await tv.page.waitForTimeout(800);
  ok(await tv.page.isVisible('#loginScreen') && await tv.page.isHidden('#dashboardOverlay') && await tv.page.isVisible('#tvLoginAviso'), 'TV sin sesión: pide usuario y no muestra datos');
  ok(await tv.page.evaluate(() => !S.turno && !(S.colaboradores || []).length && typeof window.__SRV.calls === 'object' && !window.__SRV.calls.includes('ch_tv_state')), 'TV sin sesión: no pide datos al servidor');
  // un supervisor no entra a la TV: vuelve a la app normal
  const tvs = await newPage(browser, { viewport: { width: 1200, height: 800 } });
  await tvs.page.goto(BASE + '?tv=1&datos=prueba'); await tvs.page.waitForTimeout(500);
  tvs.page.on('dialog', d => d.accept());
  await tvs.page.fill('#loginUser', 'super'); await tvs.page.fill('#loginPass', 'secreto2'); await tvs.page.click('#loginBtn'); await tvs.page.waitForTimeout(1200);
  const supTv = await tvs.page.evaluate(() => { pintarMenu(); return { menu: [...document.querySelectorAll('#dpwItems *')].some(x => /Vista TV/.test(x.textContent)), app: !document.getElementById('appScreen').classList.contains('hidden') }; });
  ok(!/tv=1/.test(tvs.page.url()) && supTv.app && !supTv.menu, 'TV: un supervisor no entra; vuelve a la app normal y no ve «Vista TV» en el menú');
  await tvs.ctx.close();
  await tv.page.fill('#loginUser', 'admin'); await tv.page.fill('#loginPass', 'secreto1'); await tv.page.click('#loginBtn'); await tv.page.waitForTimeout(1200);
  ok(await tv.page.isVisible('#dashboardOverlay'), 'TV con sesión de administrador: abre el dashboard');
  const tvc = await tv.page.evaluate(async () => { setTvMode('analytics'); const html = document.getElementById('dashboardContent').innerHTML;
    return { sinTab: !document.getElementById('tvTabAnalytics'), sigueVivo: _tvMode === 'live' && !/Costo/.test(html) }; });
  ok(tvc.sinTab && tvc.sigueVivo, 'TV: en la pantalla de la bodega no aparece Analytics ni costos');
  await tv.page.screenshot({ path: SHOTS + '/04_tv.png' });
  const tvl = await tv.page.evaluate(async () => {
    const v = window.__SRV.rows.ctrl_horas_test.value, hoy = fechaLocal(new Date()), t0 = Date.now() - 2 * 3600000;
    v.lineas = [{ id: 'tvl1', fecha: hoy, tipoId: 'x', nombre: 'Inserto botella', cliente: 'CERNAC', meta: 40, horas: 8, prod: 0.5, apoyo: [], estado: 'corriendo', inicio: t0, responsable: 'Super Visor',
      personas: [{ id: 'a', nombre: 'Pedro Gil', puesto: 'pallets', pallets: [t0 + 1, t0 + 2, t0 + 3, t0 + 4, t0 + 5], desde: t0 }, { id: 'b', nombre: 'Rosa Cajas', puesto: 'Armado de cajas', pallets: [], desde: t0 }] },
      { id: 'tvl2', fecha: '2001-01-01', nombre: 'Vieja', estado: 'cerrada', meta: 1, horas: 8, personas: [] }];
    window.__SRV.rows.ctrl_horas_test.version++; await reload(); setTvMode('lineas');
    const html = document.getElementById('dashboardContent').innerHTML;
    const r = { llega: lineasHoy().length === 1, total: /<b>5<\/b><span>\/ 40 pallets/.test(html), marca: /tvl-mark/.test(html), rank: /2 personas/.test(html) && !document.querySelector('.tvl-rank'), necesario: /Ritmo necesario/.test(html) };
    // sin turno regular: la TV muestra las líneas sola
    v.turno = null; window.__SRV.rows.ctrl_horas_test.version++; await reload(); setTvMode('live'); r.solo = /tvl-big/.test(document.getElementById('dashboardContent').innerHTML);
    return r; });
  ok(tvl.llega && tvl.total && tvl.marca && tvl.rank && tvl.necesario, 'TV · Líneas: total contra la meta (pallets que estaban por persona pasan al total), marca de dónde debería ir, ritmo necesario y cantidad de personas');
  ok(tvl.solo, 'TV · Líneas: sin turno regular, muestra las líneas en marcha');
  const tv2 = await newPage(browser, { viewport: { width: 1600, height: 900 } });
  await tv2.page.goto(BASE + '?tv=1&vista=lineas'); await tv2.page.waitForTimeout(500);
  await tv2.page.fill('#loginUser', 'admin'); await tv2.page.fill('#loginPass', 'secreto1'); await tv2.page.click('#loginBtn'); await tv2.page.waitForTimeout(1000);
  ok(await tv2.page.evaluate(() => _tvMode === 'lineas' && /Sin líneas de producción hoy|tvl-big/.test(document.getElementById('dashboardContent').innerHTML)), 'TV · Líneas: se abre directo con ?vista=lineas');
  await tv2.ctx.close();
  ok(tv.errors.length === 0, 'TV sin errores JS (' + tv.errors.join(' | ') + ')');

  await browser.close();
  console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
