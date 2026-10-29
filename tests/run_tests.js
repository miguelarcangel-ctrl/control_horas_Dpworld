// Pruebas end-to-end de Control de Horas contra el simulador local
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const BASE = 'http://localhost:8765/index.html';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
// Navegación por el menú desplegable (línea gráfica común): abre el menú y elige la sección
const irA = async (page, label) => { await page.click('.dpw-burger'); await page.click(`.dpw-item:has-text("${label}")`); };
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

  // 4) Insights + usuarios desde servidor
  await irA(page, 'Insights'); await page.waitForTimeout(500);
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
  ok(x.length === 7, 'Excel con 7 hojas: ' + x.join(', '));

  // 9) Configuración con tarifas
  await irA(page, 'Insights'); await page.evaluate(() => openConfig()); await page.waitForTimeout(200);
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
  const av = await page.evaluate(() => { _avisados.clear(); _avisosApp = []; pintarAvisosApp(); const ok15 = (revisarAlertas(), [..._avisados].some(k => k.startsWith('libre|'))); S.config.alertaLibreMin = 0.001; revisarAlertas(); S.config.alertaLibreMin = 15; if (ok15) return {}; return { libre: [..._avisados].some(k => k.startsWith('libre|')), toast: document.getElementById('avisosApp').textContent }; });
  ok(av.libre && /sin tarea/i.test(av.toast), 'aviso: persona sin tarea pasado el umbral (y no antes)');
  ok(await page.evaluate(() => { const n = _avisados.size; revisarAlertas(); return _avisados.size === n; }), 'aviso: no se repite el mismo aviso');
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
  const x2 = await page.evaluate(() => window.__xlsx.w.s.slice(-7).map(s => s[1][0]));
  ok(x2[0].includes('Tipo de tiempo') && x2[1].includes('Horas sin registrar') && x2[4].includes('% productivo'), 'Excel: columnas de tiempos y nombre en Excel');

  // 9e) Líneas de producción: control de cantidades; nombres fuera del maestro; paletizan + apoyo; planificar cualquier día
  const ln = await page.evaluate(async () => {
    const r = {};
    S.lineasTipo = [{ id: 'lt1', nombre: 'Inserto botella', clienteId: 'k1', prod: 0.5, apoyo: [{ nombre: 'Armado de cajas', cant: 2 }, { nombre: 'Etiquetado', cant: 1 }], excel: null }];
    const c = cuadrilla(40, 0.5, 8, S.lineasTipo[0].apoyo);
    r.calc = c.pal === 10 && c.ap === 3 && c.total === 13;
    // planificar el jueves de la semana próxima (cualquier día): no aparece hoy
    const d = new Date(); d.setDate(d.getDate() + 6); const otroDia = fechaLocal(d);
    abrirPlanLinea(fechaManana()); r.chips = document.querySelectorAll('#plDias .chip').length === 7;
    setPlanFecha(otroDia); document.getElementById('plTipo').value = 'lt1'; document.getElementById('plMeta').value = '40'; calcPlanLinea();
    r.calcTxt = /13 personas/.test(document.getElementById('plCalc').textContent) && /10 que paletizan/.test(document.getElementById('plCalc').textContent);
    document.getElementById('plPersonas').value = '11'; calcPlanLinea();
    r.inversa = /8 paletizan\) alcanzas 32 pallets/.test(document.getElementById('plCalc').textContent);
    await guardarPlanLinea();
    r.otroDia = (S.turno.lineas || []).length === 0 && S.lineasPlan.some(p => p.fecha === otroDia) && /Planificadas/.test(document.getElementById('lineasPlanTurno').innerHTML);
    // agregar una para hoy: aparece en el tablero
    abrirPlanLinea(S.turno.fecha); setPlanFecha(S.turno.fecha); document.getElementById('plTipo').value = 'lt1'; document.getElementById('plMeta').value = '20'; document.getElementById('plHoras').value = '8';
    await guardarPlanLinea();
    const l = S.turno.lineas[0]; r.hoy = !!l && l.estado === 'pendiente' && document.querySelectorAll('#lineasList .lb').length === 1;
    // nombres escritos (no están en el maestro), con su puesto
    abrirLinea(l.id);
    const add = async (n, puesto) => { document.getElementById('lmNombre').value = n; document.getElementById('lmPuesto').value = puesto; await agregarPersonaLinea(); };
    await add('Pedro Temporal', 'pallets'); await add('María Externa', 'pallets'); await add('pedro temporal', 'pallets'); await add('Rosa Cajas', 'Armado de cajas'); await add('Tito Etiquetas', 'Etiquetado');
    r.nombres = paletizadores(l).map(p => p.nombre).join('|') === 'Pedro Temporal|María Externa' && deApoyo(l).map(p => p.puesto).join('|') === 'Armado de cajas|Etiquetado' && !S.colaboradores.some(x => x.nombre === 'Pedro Temporal');
    r.recuerda = S.nombresLinea.includes('Tito Etiquetas');
    await arrancarLinea();
    r.corre = l.estado === 'corriendo' && !('costoPallet' in l && l.costoPallet);
    const [p1, p2] = paletizadores(l);
    await sumarPallet(p1.id, 1); await sumarPallet(p1.id, 1); await sumarPallet(p1.id, 1); await sumarPallet(p2.id, 1); await sumarPallet(p1.id, -1);
    const apoyoSinBoton = !document.getElementById('lineaBody').innerHTML.includes("sumarPallet('" + deApoyo(l)[0].id);
    r.pallets = p1.pallets.length === 2 && p2.pallets.length === 1 && totalPallets(l) === 3 && apoyoSinBoton;
    r.bloque = /3<\/b> \/ 20 pallets/.test(document.getElementById('lineasList').innerHTML) && /2 paletizan · 2 apoyo/.test(document.getElementById('lineasList').innerHTML);
    document.getElementById('lmNombre').value = 'Juana Refuerzo'; document.getElementById('lmPuesto').value = 'pallets'; await agregarPersonaLinea();
    r.tarde = paletizadores(l).length === 3 && l.personas[l.personas.length - 1].desde > l.inicio - 1;
    hideModal('modalLinea');
    S.turno.lineas.push(nuevaLinea(S.lineasTipo[0], 10, 8)); cerrarLineasDelTurno(Date.now());
    r.cierre = S.turno.lineas.length === 1 && l.estado === 'cerrada' && l.fin > 0;
    exportExcel(null);
    const hojas = window.__xlsx.w.s.slice(-2), lr = hojas[0][1].find(x => x[1] === 'Inserto botella'), pr = hojas[1][1].filter(x => x[1] === 'Inserto botella');
    r.excel = lr && lr[5] === 3 && lr[8] === 3 && lr[9] === 2 && !hojas[0][1][0].some(h => /costo/i.test(h)) && pr.length === 5 && pr.some(x => x[4] === 'Etiquetado' && x[5] === '');
    r.insights = /Inserto botella/.test(buildLineasSection()) && !/costo/i.test(buildLineasSection());
    return r; });
  ok(ln.calc && ln.calcTxt, 'línea: cuadrilla = paletizan (40 ÷ (0.5 × 8) = 10) + apoyo (3) = 13');
  ok(ln.inversa, 'línea: con 11 personas, 8 paletizan y alcanzan 32 pallets');
  ok(ln.chips && ln.otroDia, 'línea: se planifica cualquier día (accesos a 7 días) y no aparece hoy');
  ok(ln.hoy, 'línea: agregada hoy aparece como bloque en el tablero');
  ok(ln.nombres && ln.recuerda, 'línea: nombres escritos con su puesto (paletiza o apoyo), sin duplicados, recordados');
  ok(ln.corre, 'línea: arranca, sin costo (solo cantidades)');
  ok(ln.pallets && ln.bloque, 'línea: +1 / −1 pallet a quien paletiza; el apoyo no tiene contador; el bloque muestra total, meta y cuadrilla');
  ok(ln.tarde, 'línea: se puede sumar alguien a mitad');
  ok(ln.cierre, 'línea: al cerrar el turno se cierra la que corre y se descarta la no arrancada');
  ok(ln.excel && ln.insights, 'línea: Excel e Insights con pallets, paletizan y apoyo, sin costo');
  ok(await page.evaluate(() => { const f = S.turno.fecha, ls = S.turno.lineas; const otro = S.lineasPlan.find(p => p.fecha > f); S.turno.fecha = otro.fecha; S.turno.lineas = [];
    const ok1 = traerLineasPlanificadas() && S.turno.lineas.length === 1 && S.turno.lineas[0].meta === 40 && S.turno.lineas[0].apoyo.length === 2;
    const ok2 = !traerLineasPlanificadas(); S.turno.fecha = f; S.turno.lineas = ls; return ok1 && ok2; }), 'línea: la planificada aparece sola en el turno de ese día (una vez), con sus puestos de apoyo');

  // 10) Sesión persistente
  await page.reload(); await page.waitForTimeout(700);
  ok(await page.isVisible('#appScreen'), 'al recargar no pide login (sesión guardada)');
  ok(errors.length === 0, 'sin errores JS (' + errors.join(' | ') + ')');

  // 11) Supervisor no ve Insights
  await page.evaluate(() => doLogout()); await page.waitForTimeout(300);
  await page.fill('#loginUser', 'super'); await page.fill('#loginPass', 'secreto2');
  await page.click('#loginBtn'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => ![...document.querySelectorAll('.dpw-item')].some(b => b.textContent.includes('Insights'))), 'supervisor no ve Insights en el menú');
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
