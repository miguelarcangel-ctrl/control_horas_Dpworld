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
  ok(x.length === 9, 'Excel con 9 hojas: ' + x.join(', '));

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
  const x2 = await page.evaluate(() => window.__xlsx.w.s.slice(-9).map(s => s[1][0]));
  ok(x2[0].includes('Tipo de tiempo') && x2[1].includes('Horas sin registrar') && x2[4].includes('% productivo'), 'Excel: columnas de tiempos y nombre en Excel');

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
    const c = cuadrilla(40, 0.5, 8, S.lineasTipo[0].apoyo);
    r.calc = c.pal === 10 && c.ap === 3 && c.total === 13;
    // planificar otro día de la semana: no aparece hoy
    const d = new Date(); d.setDate(d.getDate() + 6); const otroDia = fechaLocal(d);
    abrirPlanLinea(fechaManana()); r.chips = document.querySelectorAll('#plDias .chip').length === 7;
    setPlanFecha(otroDia); document.getElementById('plTipo').value = 'lt1'; document.getElementById('plMeta').value = '40'; calcPlanLinea();
    r.calcTxt = /13 personas/.test(document.getElementById('plCalc').textContent);
    document.getElementById('plPersonas').value = '11'; calcPlanLinea();
    r.inversa = /8 paletizan\) alcanzas 32 pallets/.test(document.getElementById('plCalc').textContent);
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
    const add = async (n, puesto) => { document.getElementById('lmNombre').value = n; document.getElementById('lmPuesto').value = puesto; await agregarPersonaLinea(); };
    await add('Pedro Temporal', 'pallets'); await add('María Externa', 'pallets'); await add('pedro temporal', 'pallets'); await add('Rosa Cajas', 'Armado de cajas'); await add('Tito Etiquetas', 'Etiquetado');
    r.nombres = paletizadores(l).map(p => p.nombre).join('|') === 'Pedro Temporal|María Externa' && deApoyo(l).map(p => p.puesto).join('|') === 'Armado de cajas|Etiquetado' && !S.colaboradores.some(x => x.nombre === 'Pedro Temporal');
    r.recuerda = S.nombresLinea.includes('Tito Etiquetas');
    await arrancarLinea();
    r.corre = l.estado === 'corriendo' && l.responsable === 'Admin Prueba' && !S.turno;
    const [p1, p2] = paletizadores(l);
    await sumarPallet(p1.id, 1); await sumarPallet(p1.id, 1); await sumarPallet(p1.id, 1); await sumarPallet(p2.id, 1); await sumarPallet(p1.id, -1);
    r.pallets = p1.pallets.length === 2 && p2.pallets.length === 1 && totalPallets(l) === 3 && !document.getElementById('lineaBody').innerHTML.includes("sumarPallet('" + deApoyo(l)[0].id);
    r.bloque = /3<\/b> \/ 20 pallets/.test(document.getElementById('lineasList').innerHTML) && /2 paletizan · 2 apoyo/.test(document.getElementById('lineasList').innerHTML);
    hideModal('modalLinea');
    // vuelve el turno regular: la línea sigue en marcha, se ve en el resumen y los operadores pueden apoyarla
    S.turno = turnoGuardado; S.tareasActivas = []; renderAll();
    r.resumen = !document.getElementById('secLineas').classList.contains('hidden') && /Inserto botella/.test(document.getElementById('lineasTurno').innerHTML);
    _sel = new Set(['c1']); abrirAsignar(); r.chipLinea = !document.getElementById('asigLineaField').classList.contains('hidden');
    setAsigLinea(l.id); elegirTarea('t1'); await new Promise(res => setTimeout(res, 50));
    const ta = S.tareasActivas.find(t => t.lineaId === l.id); if (ta) ta.inicio = Date.now() - 2 * 3600000;
    r.apoyoOp = ta && Math.abs(apoyoOperadores(l.id).total - 2) < 0.05 && /línea Inserto botella/.test(document.getElementById('equipoList').innerHTML);
    // cerrar el turno regular no cierra la línea
    await liberar(['c1']); hideModal('modalCantidad'); S.historial.forEach(h => h.cantPend = false);
    r.independiente = l.estado === 'corriendo';
    abrirLinea(l.id); await (async () => { const c0 = window.confirm; window.confirm = () => true; await cerrarLinea(); window.confirm = c0; })(); hideModal('modalLinea');
    r.cierre = l.estado === 'cerrada' && l.fin > 0;
    exportExcel(null);
    const hojas = window.__xlsx.w.s.slice(-4, -2), lr = hojas[0][1].find(x => x[1] === 'Inserto botella');
    const det = window.__xlsx.w.s.slice(-9)[0][1]; const cols = det[0];
    r.excel = lr && lr[5] === 3 && lr[7] === 4 && lr[8] === 2 && lr[9] === 2 && Math.abs(lr[14] - 2) < 0.05 && det.some(x => x[cols.indexOf('Apoyo a línea')] === 'Inserto botella');
    r.insights = /Horas operadores/.test(buildLineasSection());
    return r; });
  ok(ln.migra, 'línea: las líneas y planes anteriores se migran solos al módulo propio');
  ok(ln.calc && ln.calcTxt && ln.inversa, 'línea: cuadrilla = paletizan + apoyo (10 + 3 = 13); con 11 personas, 8 paletizan → 32 pallets');
  ok(ln.chips && ln.otroDia && ln.futura, 'línea: se planifica cualquier día; la futura no se arranca antes de su fecha');
  ok(ln.hoy && ln.corre, 'línea: funciona sin turno regular abierto y guarda quién está a cargo');
  ok(ln.nombres && ln.recuerda, 'línea: nombres escritos con su puesto, sin duplicados, recordados');
  ok(ln.pallets && ln.bloque, 'línea: +1 / −1 pallet a quien paletiza; el apoyo no tiene contador');
  ok(ln.resumen && ln.chipLinea && ln.apoyoOp, 'línea: resumen en el turno; tarea de operador marcada como apoyo a la línea (2 h)');
  ok(ln.independiente && ln.cierre, 'línea: su ciclo es propio (se cierra con su botón, no con el turno)');
  ok(ln.excel && ln.insights, 'línea: Excel e Insights con pallets, cuadrilla y horas de operadores de apoyo');
  // 9f) Paros e insumos de línea
  const pi = await page.evaluate(async () => {
    const r = {}, H = 3600000, t0 = Date.now() - 4 * H;
    const c0 = window.confirm; window.confirm = () => true;
    S.lineasTipo[0].insumos = [{ nombre: 'Cajas', unidad: 'unid', porPallet: 84 }, { nombre: 'Stretch', unidad: 'rollo', porPallet: 0.1 }];
    const l = nuevaLinea(S.lineasTipo[0], 20, 8); S.lineas.push(l);
    r.snap = l.insumos.length === 2 && l.insumos[0].porPallet === 84;
    l.personas.push({ id: 'pp1', nombre: 'Uno', puesto: 'pallets', pallets: [], desde: null });
    abrirLinea(l.id); await arrancarLinea(); l.inicio = t0; l.personas[0].desde = t0;
    for (let k = 0; k < 4; k++) await sumarPallet('pp1', 1);
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
    await guardarSobrante(l.insumos[0].id, '250'); await cerrarLinea();
    const e2 = estadoInsumo(l.insumos[0], l);
    r.cierre = l.estado === 'cerrada' && !l.paroActivo && l.paros.length === 2 && e2.real === 350 && e2.dif === 14 && Math.round(e2.difPct) === 4;
    hideModal('modalLinea');
    exportExcel(null); const hs = window.__xlsx.w.s.slice(-2);
    r.excel = hs[0][0] === 'Paros de línea' && hs[0][1].some(x => x[2] === 'Falta de insumo' && x[5] === 30) && hs[1][0] === 'Insumos de línea' && hs[1][1].some(x => x[2] === 'Cajas' && x[9] === 350 && x[10] === 14);
    const ins = buildLineasSection(); r.insights = /Falta de insumo/.test(ins) && /Consumo real/.test(ins);
    // causas configurables
    openModalCausas(); addCausa('Lluvia'); await guardarCausas(); r.causas = causasParo().includes('Lluvia');
    window.confirm = c0; return r; });
  ok(pi.snap && pi.boton, 'paros/insumos: la línea copia los insumos del tipo; botón Registrar paro');
  ok(pi.enParo && pi.reanuda, 'paro: la línea queda en paro con su causa y nota hasta Reanudar');
  ok(pi.avisoParo && pi.avisoSeQuita, 'paro: aviso si pasa de 15 min (lleva a la línea) y se quita al reanudar');
  ok(pi.metricas, 'paro: 30 min de paro en 4 h → 87.5% corriendo');
  ok(pi.alcanza && pi.agota && pi.avisoInsumo && pi.alcanzaMas, 'insumos: esperado = pallets × estándar; alcanza para N pallets; aviso de insumo por agotarse');
  ok(pi.cierre, 'insumos: consumo real = entregado − sobrante y diferencia; cerrar la línea termina el paro abierto');
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
    const marcar = async (pid, ced, tipo, puesto) => { abrirMarca(pid); if (tipo) _marca.tipo = tipo; if (puesto) _marca.puesto = puesto; document.getElementById('mmCedula').value = ced; await confirmarMarca(); await new Promise(res => setTimeout(res, 20)); };
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
    abrirMarca('c1'); r.accAlm = [...document.querySelectorAll('#mmAcciones button')].map(b => b.dataset.t).join() === 'regreso_almuerzo,salida'; hideModal('modalMarca');
    await marcar('c1', '8-111-1111', 'regreso_almuerzo'); r.regreso = !actDe('c1');
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
    // aviso de llegada para el supervisor (no en la tablet)
    const nuevo = { id: 999, persona_id: sara, nombre: 'Sara Supervisora', fecha: hoyStr(), tipo: 'entrada', puesto: 'supervisor', ts: new Date().toISOString() };
    avisarMarcas([nuevo]); r.aviso = /Llegó Sara Supervisora/.test(document.getElementById('toast').textContent);
    hideModal('modalAsist'); setNav('supervisor'); window.confirm = c0; return r; });
  ok(mk.dup && mk.cifrada, 'marcaje: alta de personal; cédula repetida rechazada; la cédula no viaja con los datos de la app');
  ok(mk.kiosco, 'marcaje: la tablet queda en modo quiosco con el personal que tiene cédula');
  ok(mk.soloEntrada && mk.cedulaMala && mk.ok, 'marcaje: ofrece solo lo que corresponde, propone la posición, rechaza cédula incorrecta y confirma en grande');
  ok(mk.turno && mk.linea, 'marcaje: operador y supervisor al tablero del turno; la persona de línea a la cuadrilla disponible');
  ok(mk.almuerzo && mk.accAlm && mk.regreso && mk.salida, 'marcaje: almuerzo pone la pausa, el regreso la quita y la salida cierra su día en el tablero');
  ok(mk.secuencia, 'marcaje: el servidor rechaza marcajes fuera de secuencia');
  ok(mk.salirMal && mk.salirBien, 'marcaje: salir del modo quiosco pide la contraseña del administrador');
  ok(mk.pagadas && mk.tarde, 'marcaje: horas pagadas desde el marcaje (9 h = 8 + 1 extra); tardanza con tolerancia');
  ok(mk.planilla && mk.sinMotivo && mk.correccion && mk.excel, 'asistencia: resumen del período, corrección solo con motivo (queda quién) y Excel de 3 hojas');
  ok(mk.aviso, 'marcaje: aviso de llegada al supervisor/administrador');

  // 9h) Notificaciones push de llegada
  const pu = await page.evaluate(async () => {
    const r = {}, c0 = window.confirm; window.confirm = () => true; const SRV = window.__SRV;
    SRV.push = []; await activarKiosco();
    const ivan = 'p_push'; await rpc('ch_personal_upsert', { p_token: SESSION.token, p_key: STATE_KEY, p_id: ivan, p_nombre: 'Iván Push', p_cedula: '8-999-0001', p_puesto: 'operador', p_activo: true }); await cargarPersonal();
    abrirMarca(ivan); document.getElementById('mmCedula').value = '8-999-0001'; await confirmarMarca(); await new Promise(res => setTimeout(res, 30));
    const m = SRV.marcas.find(x => x.persona_id === ivan && x.tipo === 'entrada');
    r.pide = SRV.push.some(x => x.name === 'push-marcaje' && x.body.accion === 'marca' && x.body.marcaId === m.id) && m.push_enviado;
    const n = SRV.push.length; abrirMarca(ivan); _marca.tipo = 'salida_almuerzo'; document.getElementById('mmCedula').value = '8-999-0001'; await confirmarMarca(); await new Promise(res => setTimeout(res, 30));
    r.soloEntrada = SRV.push.length === n;
    r.unaVez = (await funcionPush({ accion: 'marca', token: SESSION.token, key: STATE_KEY, marcaId: m.id })).enviados === 0;
    r.tabletNoRecibe = !(await suscribirPush());
    kioscoAdmin('salir'); document.getElementById('apPass').value = 'secreto1'; await confirmarAdminPass();
    r.sinPermiso = avisosEstado() !== 'granted' ? !(await suscribirPush()) : true;
    r.sw = /addEventListener\('push'/.test(await (await fetch('sw.js')).text());
    // solo admin y supervisor registran su celular
    const t = SESSION.token, u = currentUser; currentUser = { ...u, rol: 'responsable' }; SRV.users.find(x => x.id === u.id).rol = 'responsable';
    r.permiso = (await rpc('ch_push_subscribe', { p_token: t, p_key: STATE_KEY, p_endpoint: 'https://push.example/x', p_p256dh: 'a', p_auth: 'b' }).catch(e => e.message)) === 'PERMISO';
    SRV.users.find(x => x.id === u.id).rol = 'admin'; currentUser = u;
    window.confirm = c0; return r; });
  ok(pu.pide && pu.soloEntrada && pu.unaVez, 'push: la tablet pide el aviso en cada entrada (no en el almuerzo) y no se repite');
  ok(pu.tabletNoRecibe && pu.sinPermiso, 'push: la tablet de marcaje y los equipos sin permiso no se registran');
  ok(pu.sw && pu.permiso, 'push: el service worker muestra el aviso con la app cerrada; solo admin y supervisor registran su celular');

  // 9i) El turno solo se inicia con personal que marcó entrada
  const tm = await page.evaluate(async () => {
    const r = {}, SRV = window.__SRV, a0 = window.alert; let alerta = ''; window.alert = m => { alerta = m; };
    const orig = { turno: S.turno, act: S.tareasActivas, hist: S.historial }, marcas = SRV.marcas;
    S.turno = null; document.getElementById('tFecha').value = hoyStr(); document.getElementById('tHora').value = '07:00';
    SRV.marcas = []; await cargarMarcas(); prepModalTurno();
    r.bloqueado = document.getElementById('btnAbrirTurno').disabled && document.querySelectorAll('#colabChips .chip').length === 0 && /Nadie ha marcado/.test(document.getElementById('colabChipsHint').textContent);
    await abrirTurno(); r.noAbre = !S.turno && /nadie ha marcado/.test(alerta);
    SRV.marcas = marcas; await cargarMarcas(); prepModalTurno();
    const chips = [...document.querySelectorAll('#colabChips .chip')];
    r.soloMarcados = chips.length === personasMarcadas().length && chips.length > 0 && chips.every(c => c.classList.contains('selected')) && !chips.some(c => c.dataset.id === 'c2');
    r.habilitado = !document.getElementById('btnAbrirTurno').disabled;
    await abrirTurno(); r.abre = !!S.turno && chips.every(c => S.turno.equipo.some(e => e.id === c.dataset.id)) && S.turno.equipo.every(e => e.marcaje);
    hideModal('modalAbrirTurno'); document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    S.turno = orig.turno; S.tareasActivas = orig.act; S.historial = orig.hist; await save(); window.alert = a0; renderAll(); return r; });
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
  const tvl = await tv.page.evaluate(async () => {
    const v = window.__SRV.rows.ctrl_horas_test.value, hoy = fechaLocal(new Date()), t0 = Date.now() - 2 * 3600000;
    v.lineas = [{ id: 'tvl1', fecha: hoy, tipoId: 'x', nombre: 'Inserto botella', cliente: 'CERNAC', meta: 40, horas: 8, prod: 0.5, apoyo: [], estado: 'corriendo', inicio: t0, responsable: 'Super Visor',
      personas: [{ id: 'a', nombre: 'Pedro Gil', puesto: 'pallets', pallets: [t0 + 1, t0 + 2, t0 + 3, t0 + 4, t0 + 5], desde: t0 }, { id: 'b', nombre: 'Rosa Cajas', puesto: 'Armado de cajas', pallets: [], desde: t0 }] },
      { id: 'tvl2', fecha: '2001-01-01', nombre: 'Vieja', estado: 'cerrada', meta: 1, horas: 8, personas: [] }];
    await reload(); setTvMode('lineas');
    const html = document.getElementById('dashboardContent').innerHTML;
    const r = { llega: S.lineas.length === 1, total: /<b>5<\/b><span>\/ 40 pallets/.test(html), marca: /tvl-mark/.test(html), rank: /Pedro/.test(html) && !/Rosa/.test(document.querySelector('.tvl-rank')?.innerHTML || ''), necesario: /Ritmo necesario/.test(html) };
    // sin turno regular: la TV muestra las líneas sola
    v.turno = null; await reload(); setTvMode('live'); r.solo = /tvl-big/.test(document.getElementById('dashboardContent').innerHTML);
    return r; });
  ok(tvl.llega && tvl.total && tvl.marca && tvl.rank && tvl.necesario, 'TV · Líneas: total contra la meta, marca de dónde debería ir, ritmo necesario y ranking de quienes paletizan');
  ok(tvl.solo, 'TV · Líneas: sin turno regular, muestra las líneas en marcha');
  const tv2 = await newPage(browser, { viewport: { width: 1600, height: 900 } });
  await tv2.page.goto(BASE + '?tv=1&vista=lineas'); await tv2.page.waitForTimeout(800);
  ok(await tv2.page.evaluate(() => _tvMode === 'lineas' && /Sin líneas de producción hoy|tvl-big/.test(document.getElementById('dashboardContent').innerHTML)), 'TV · Líneas: se abre directo con ?vista=lineas');
  await tv2.ctx.close();
  ok(tv.errors.length === 0, 'TV sin errores JS (' + tv.errors.join(' | ') + ')');

  await browser.close();
  console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
