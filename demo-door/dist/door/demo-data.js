// ═══════════════════════════════════════════════════════════════
// Prototipo Door Logistic · Control de Horas
// Se carga después de mock_supabase.js (servidor simulado en el navegador). Llena la demostración con datos
// ficticios —personal, clientes, tareas, turnos, líneas y marcajes de las últimas dos semanas y del día de hoy—
// y guarda lo que el visitante haga en su propio navegador. Al día siguiente la demostración se renueva sola.
// Nada sale del navegador: no hay base de datos ni datos reales.
// ═══════════════════════════════════════════════════════════════
(function(){
  const SRV = window.__SRV, H = 3600000, MIN = 60000, KEY = 'door_demo_v8', SKEY = 'ctrl_horas';
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const at = (f, h, m) => { const [y, mo, d] = f.split('-').map(Number); return new Date(y, mo - 1, d, h, m || 0, 0, 0).getTime(); };
  const NOW = Date.now(), HOY = dstr(new Date(NOW));
  let s0 = 20261121; const rnd = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  let seq = 0; const uid = p => (p || 'd') + (++seq).toString(36) + 'x' + Math.floor(rnd() * 1e6).toString(36);

  // ── Reiniciar: ?reiniciar en la dirección o el botón de la franja de demostración
  function borrarTodo(){
    try { Object.keys(localStorage).filter(k => k === KEY || k === '__mock_sess' || /^ch_/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  }
  if (/[?&]reiniciar\b/.test(location.search)) { borrarTodo(); history.replaceState(null, '', location.pathname); }

  // ── Catálogos
  const USERS = [
    { id: 'u1', username: 'admin', nombre: 'Administrador Demo', rol: 'admin', pass: 'demo123', activo: true },
    { id: 'u2', username: 'supervisor', nombre: 'Roberto Sánchez', rol: 'supervisor', pass: 'demo123', activo: true },
    { id: 'u3', username: 'linea', nombre: 'Daniela Pinzón', rol: 'responsable', pass: 'demo123', activo: true },
    // Clientes de Door: cada uno entra con su propia sesión y pide el personal del día siguiente
    { id: 'u4', username: 'cliente', nombre: 'Laura Méndez', rol: 'cliente', pass: 'demo123', activo: true },
    { id: 'u5', username: 'atlantico', nombre: 'Carlos Ríos', rol: 'cliente', pass: 'demo123', activo: true }
  ];
  const USUARIOS_CLIENTE = { cliente: 'k1', atlantico: 'k2' };
  // Planilla y cobros: tarifas negociadas por cliente (venta por persona por día) y cédulas ficticias para la planilla
  const TARIFAS_CLIENTE = { k1: { ag: 45, operador: 58 }, k2: { linea: 38 } };
  // Estado de cuenta de ejemplo: proformas de quincenas anteriores ya facturadas (una pagada, una con abono, una vencida)
  // y una aprobada por facturar. Sus rubros son resúmenes con id propio: no chocan con lo que se genera del período actual.
  function proformasDemo(){
    const dia = n => dstr(new Date(NOW - n * 24 * H)), ts = n => NOW - n * 24 * H;
    const it = (id, fecha, desc, cantidad, unidad, precio) => ({ id: 'hist|' + id, tipo: 'personal', fecha, desc, cantidad, unidad, precio, venta: Math.round(cantidad * precio * 100) / 100, costo: 0 });
    const pf = (id, num, cli, d0, d1, items, extra, log) => Object.assign({ id, numero: num, clienteId: cli, desde: dia(d0), hasta: dia(d1), estado: 'facturada', itbms: 7, creada: ts(d1 - 1),
      items, aprobados: items.map(x => x.id), excluidos: [], vistoCliente: true, abonos: [], log }, extra);
    const fac = (num, n, cred) => ({ numero: num, fecha: dia(n), vence: dia(n - cred), credito: cred, por: 'Administrador Demo', ts: ts(n) });
    const L = (u, a, n) => ({ t: dia(n) + ' 10:00', u, a });
    return [
      pf('pfh1', 'PF-0001', 'k1', 75, 61, [it('a1', dia(61), 'Operador de equipo · 60 días-persona', 60, 'día', 58), it('a2', dia(61), 'Ayudante general · 24 días-persona', 24, 'día', 45), it('a3', dia(61), 'Sobretiempo · 18 h', 18, 'h', 9.06)],
        { estado: 'cobrada', factura: fac('0001-00004380', 58, 30), abonos: [{ fecha: dia(27), monto: 5053.70, forma: 'Transferencia / ACH', ref: 'ACH 551209', por: 'Administrador Demo', ts: ts(27) }] },
        [L('Laura Méndez · Importadora Istmo', 'Confirmó 3 de 3 rubros', 60), L('Administrador Demo', 'Registró la factura 0001-00004380', 58), L('Administrador Demo', 'Registró el cobro final $5,053.70', 27)]),
      pf('pfh2', 'PF-0002', 'k1', 45, 31, [it('b1', dia(31), 'Operador de equipo · 66 días-persona', 66, 'día', 58), it('b2', dia(31), 'Ayudante general · 30 días-persona', 30, 'día', 45), it('b3', dia(31), 'Maquila · Etiquetado de importación', 48000, 'unidades', 0.03)],
        { factura: fac('0001-00004431', 28, 30), abonos: [{ fecha: dia(6), monto: 3000, forma: 'Cheque', ref: 'CHQ 1187', por: 'Administrador Demo', ts: ts(6) }] },
        [L('Laura Méndez · Importadora Istmo', 'Confirmó 3 de 3 rubros', 30), L('Administrador Demo', 'Registró la factura 0001-00004431', 28), L('Administrador Demo', 'Registró un abono $3,000.00', 6)]),
      pf('pfh3', 'PF-0003', 'k2', 75, 61, [it('c1', dia(61), 'Personal de línea / maquila · 190 días-persona', 190, 'día', 38), it('c2', dia(61), 'Supervisor · 12 días-persona', 12, 'día', 70)],
        { factura: fac('0001-00004382', 57, 30) },
        [L('Carlos Ríos · Distribuidora Atlántico', 'Confirmó 2 de 2 rubros', 59), L('Administrador Demo', 'Registró la factura 0001-00004382', 57)]),
      pf('pfh4', 'PF-0004', 'k3', 30, 16, [it('d1', dia(16), 'Ayudante general · 40 días-persona', 40, 'día', 42), it('d2', dia(16), 'Maquila · Empaque promocional', 6200, 'cajas', 0.42)],
        { estado: 'aprobada', aprobada: ts(14) }, [L('Comercial Bahía Azul', 'Confirmó 2 de 2 rubros', 14)]),
      pf('pfh5', 'PF-0005', 'k1', 30, 16, [it('e1', dia(16), 'Operador de equipo · 54 días-persona', 54, 'día', 58), it('e2', dia(16), 'Ayudante general · 22 días-persona', 22, 'día', 45)],
        { estado: 'aprobada', aprobada: ts(13) }, [L('Laura Méndez · Importadora Istmo', 'Confirmó 2 de 2 rubros', 13)])
    ];
  }
  const CLIENTES = [
    { id: 'k1', nombre: 'Importadora Istmo' }, { id: 'k2', nombre: 'Distribuidora Atlántico' },
    { id: 'k3', nombre: 'Comercial Bahía Azul' }, { id: 'k4', nombre: 'Farmacéutica del Canal' }
  ];
  const tc = (id, nombre, prod, unidad, clase) => ({ id, nombre, prod, unidad, efic: 85, clase: clase || 'productiva', desc: '' });
  const TAREAS = [
    tc('t1', "Descargue de contenedor 40'", 35, 'pallet'), tc('t2', "Carga de contenedor 40'", 32, 'pallet'),
    tc('t3', 'Picking por caja', 120, 'caja'), tc('t4', 'Recepción y ubicación', 40, 'pallet'),
    tc('t5', 'Despacho a camión', 30, 'pallet'), tc('t6', 'Inventario cíclico', 60, 'pallet'),
    tc('t7', 'Etiquetado de cajas', 260, 'caja'), tc('t8', 'Supervisión', 0, 'hora', 'apoyo'),
    tc('t9', 'Orden y limpieza', 0, 'hora', 'apoyo')
  ];
  const T = id => TAREAS.find(t => t.id === id), C = id => CLIENTES.find(c => c.id === id);
  const TIPOS = [
    // venta: cómo se cobra la maquila (por caja, unidad, paleta o bulto) y cómo se costea (por unidad o por el personal de la línea)
    { id: 'lt1', nombre: 'Empaque promocional', clienteId: 'k3', prod: 0.5, apoyo: [], excel: null, venta: { unidad: 'caja', precio: 0.42, porPallet: 48, costeo: 'personal', costoUnidad: 0 },
      insumos: [{ nombre: 'Cajas', unidad: 'unid', porPallet: 48 }, { nombre: 'Stretch', unidad: 'rollo', porPallet: 0.08 }] },
    { id: 'lt2', nombre: 'Etiquetado de importación', clienteId: 'k1', prod: 0.45, apoyo: [], excel: null, venta: { unidad: 'unidad', precio: 0.03, porPallet: 960, costeo: 'unidad', costoUnidad: 0.018 },
      insumos: [{ nombre: 'Etiquetas', unidad: 'unid', porPallet: 960 }, { nombre: 'Stretch', unidad: 'rollo', porPallet: 0.08 }] },
    { id: 'lt3', nombre: 'Kitting farmacéutico', clienteId: 'k4', prod: 0.35, apoyo: [], excel: null, venta: { unidad: 'paleta', precio: 38, porPallet: 1, costeo: 'personal', costoUnidad: 0 },
      insumos: [{ nombre: 'Cajas', unidad: 'unid', porPallet: 40 }, { nombre: 'Insertos', unidad: 'unid', porPallet: 480 }] }
  ];
  const BOD = ['Bodega Principal', 'Bodega 2'];
  const CONFIG = { horaInicio: '08:00', horaFin: '17:00', horasAlmuerzo: 1, multSobretiempo: 1.25, horasSabado: 4, multSabado: 1, horasDomingo: 0, multDomingo: 2,
    tarifaOperador: 4.5, tarifaAG: 3.75, tarifaSupervisor: 7, factorCarga: 1.07, alertaLibreMin: 15, alertaTareaH: 3, alertaParoMin: 15, toleranciaMin: 5, bodegas: BOD,
    pedidosClientes: true, pedidoCorte: '15:00', marcajeCliente: true, facturacion: true, itbms: 7 };

  // Personal ficticio (cédula de prueba para todos: 1234)
  const per = (id, nombre, puesto) => ({ key: SKEY, id, nombre, cedula: '1234', puesto_def: puesto, activo: true, contingente: false, creado_por: 'admin', creado: new Date(NOW - 40 * 24 * H).toISOString() });
  const PERSONAL = [
    per('p01', 'Roberto Sánchez', 'supervisor'), per('p02', 'Marisol Herrera', 'supervisor'), per('p03', 'Daniela Pinzón', 'responsable'),
    per('p04', 'Luis Batista', 'operador'), per('p05', 'Kevin Rodríguez', 'operador'), per('p06', 'José Castillo', 'operador'),
    per('p07', 'Edwin Moreno', 'operador'), per('p08', 'Ricardo Vega', 'operador'), per('p09', 'Omar Quintero', 'operador'),
    per('p10', 'Félix Araúz', 'ag'), per('p11', 'Javier Núñez', 'ag'), per('p12', 'Carlos Mendieta', 'ag'),
    per('p13', 'Ana Cedeño', 'linea'), per('p14', 'María González', 'linea'), per('p15', 'Yesenia Ortega', 'linea'),
    per('p16', 'Katherine Ríos', 'linea'), per('p17', 'Lourdes Samaniego', 'linea'), per('p18', 'Diana Caballero', 'linea'),
    per('p19', 'Gisela Pérez', 'linea'), per('p20', 'Andrea Montenegro', 'linea'), per('p21', 'Rosa Villarreal', 'linea'),
    per('p22', 'Melissa Barría', 'linea'), per('p23', 'Yaritza Delgado', 'linea'), per('p24', 'Elena Jaén', 'linea'),
    per('p25', 'Paola Guerra', 'linea'), per('p26', 'Itzel Bonilla', 'linea')
  ];
  const P = id => PERSONAL.find(p => p.id === id);
  const CARGO = { operador: 'operador', ag: 'ag', supervisor: 'supervisor' };
  const TURNO_IDS = ['p01', 'p02', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10', 'p11', 'p12'];
  const LINEA_IDS = ['p13', 'p14', 'p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22', 'p23', 'p24', 'p25', 'p26'];
  const bodegaDe = id => (['p02', 'p07', 'p08', 'p12'].includes(id) ? BOD[1] : BOD[0]);
  // Cliente para el que trabaja cada persona (lo elige al marcar la entrada)
  const clienteDe = id => (LINEA_IDS.includes(id) ? 'Distribuidora Atlántico' : ['p10', 'p11', 'p12'].includes(id) ? 'Comercial Bahía Azul' : 'Importadora Istmo');

  // ── Marcajes
  function marca(pid, fecha, tipo, ts, extra){
    const p = P(pid), m = Object.assign({ id: ++SRV.marcaSeq, key: SKEY, persona_id: pid, nombre: p.nombre, fecha, tipo, puesto: p.puesto_def,
      ts: new Date(ts).toISOString(), por: 'admin', anulado: false, motivo: null, corregido_por: null, corregido_en: null, bodega: bodegaDe(pid), cliente: clienteDe(pid), push_enviado: true }, extra || {});
    SRV.marcas.push(m); return m;
  }
  const copiaMarcas = (pid, fecha) => SRV.marcas.filter(m => m.persona_id === pid && m.fecha === fecha && !m.anulado)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).map(m => ({ id: m.id, tipo: m.tipo, ts: Date.parse(m.ts), anulado: false }));
  const miembro = (pid, fecha) => ({ id: pid, nombre: P(pid).nombre, cargo: CARGO[P(pid).puesto_def], marcaje: true, bodega: bodegaDe(pid), cliente: clienteDe(pid), marcas: copiaMarcas(pid, fecha) });

  // ── Tareas del turno (mismos campos que guarda la app al cerrar una actividad)
  function tarea(tid, kid, cols, ini, fin, cantFactor){
    const t = T(tid), c = C(kid), durH = (fin - ini) / H;
    const cant = t.prod > 0 && cantFactor != null ? Math.max(1, Math.round(t.prod * durH * cantFactor)) : 0;
    const realProd = cant > 0 ? cant / durH : 0;
    return { id: uid('h'), tareaId: t.id, tarea: t.nombre, clienteId: c.id, cliente: c.nombre, colaboradores: cols, inicio: ini, fin, durH,
      cant, unidad: t.unidad, prod: t.prod, efic: t.prod > 0 && cant > 0 ? realProd / t.prod * 100 : null, realProd, nota: '', por: 'supervisor', porFin: 'supervisor',
      bodega: cols[0].bodega, excel: null, lineaId: null, tdId: null };
  }
  const almuerzo = (col, ini, fin) => ({ id: uid('al'), tareaId: '_almuerzo', tarea: 'Almuerzo', clienteId: null, cliente: 'Interno', colaboradores: [col], inicio: ini, fin,
    durH: (fin - ini) / H, prod: 0, unidad: '', sinProd: true, isEspecial: true, causa: 'almuerzo', por: 'marcaje', porFin: 'supervisor', cant: 0, realProd: 0, efic: null, nota: '' });
  // Plan del día por grupo: [personas, [[tarea, cliente, desde (h), hasta (h)], …]]
  const PLAN = [
    [['p04', 'p10'], [['t1', 'k1', 8, 12], ['t5', 'k2', 13, 17]]],
    [['p05', 'p06'], [['t4', 'k1', 8, 10.5], ['t6', 'k3', 10.5, 12], ['t3', 'k2', 13, 17]]],
    [['p07', 'p11'], [['t3', 'k2', 8, 12], ['t7', 'k1', 13, 17]]],
    [['p08', 'p12'], [['t2', 'k3', 8, 11], ['t9', 'k3', 11, 12], ['t5', 'k4', 13, 17]]],
    [['p09'], [['t6', 'k4', 8, 12], ['t4', 'k4', 13, 17]]],
    [['p01'], [['t8', 'k1', 8, 12], ['t8', 'k1', 13, 17]]],
    [['p02'], [['t8', 'k2', 8, 12], ['t8', 'k2', 13, 17]]]
  ];
  const hm = (f, h) => at(f, Math.floor(h), Math.round((h % 1) * 60));

  // ── Líneas
  function linea(tipo, letra, fecha, pids, ini, fin, avance, opts){
    opts = opts || {}; const meta = Math.round(tipo.prod * 8 * pids.length);
    const corre = !fin, hasta = corre ? NOW : fin, alm = [];
    let almAct = null;
    const l12 = at(fecha, 12), l13 = at(fecha, 13);
    if (hasta > l13) alm.push({ id: uid('la'), inicio: l12, fin: l13, por: 'linea', porFin: 'linea', personas: pids });
    else if (hasta > l12) almAct = { id: uid('la'), inicio: l12, por: 'linea', personas: pids };
    // pallets repartidos en el tiempo trabajado (sin el almuerzo), al ritmo indicado
    const trab = Math.max(0, Math.min(hasta, at(fecha, 17)) - ini - (hasta > l13 ? H : hasta > l12 ? hasta - l12 : 0));
    const n = Math.max(0, Math.round(meta * avance * trab / (8 * H)));
    const pallets = []; let t = ini;
    const paso = trab / Math.max(1, n);
    for (let k = 0; k < n; k++) { t += paso * (0.75 + rnd() * 0.5); if (t > l12 && t < l13) t += H; pallets.push(Math.min(Math.round(t), hasta - MIN)); }
    pallets.sort((a, b) => a - b);
    const ins = tipo.insumos.map(i => { const ent = Math.ceil(i.porPallet * (n + 6) / (i.porPallet < 1 ? 0.5 : 10)) * (i.porPallet < 1 ? 0.5 : 10);
      return { id: uid('in'), nombre: i.nombre, unidad: i.unidad, porPallet: i.porPallet, entregas: n ? [{ q: ent, ts: ini + 10 * MIN, por: 'linea' }] : [],
        sobrante: corre ? null : Math.max(0, +(ent - i.porPallet * n * (1 + rnd() * 0.03)).toFixed(2)) }; });
    const paros = opts.paro ? [{ id: uid('pa'), causa: opts.paro, nota: '', inicio: at(fecha, 15, 10), fin: at(fecha, 15, 35), por: 'linea', porFin: 'linea' }] : [];
    return { id: uid('l'), fecha, letra, tipoId: tipo.id, nombre: tipo.nombre, clienteId: tipo.clienteId, cliente: C(tipo.clienteId).nombre, prod: tipo.prod, apoyo: [],
      insumos: ins, meta, horas: 8, excel: null, estado: corre ? 'corriendo' : 'cerrada', bodega: BOD[0],
      personas: pids.map(pid => ({ id: uid('lp'), desde: ini, nombre: P(pid).nombre, personaId: pid })), pallets, inicio: ini, fin: fin || null,
      por: 'linea', porInicio: 'linea', porFin: corre ? undefined : 'linea', responsable: 'Daniela Pinzón', paros, almuerzos: alm, almuerzoActivo: almAct,
      cierreCuadrilla: corre ? undefined : 'salida' };
  }

  // ── Un día completo y cerrado
  function diaCerrado(f, k){
    const ap = {}, equipo = [], hist = [];
    const sobre = k % 4 === 1 ? ['p04', 'p10', 'p08'] : [];
    TURNO_IDS.forEach(pid => {
      const e = at(f, 7, 48 + ri(0, 14)), sal = sobre.includes(pid) ? at(f, 19, ri(0, 6)) : at(f, 17, ri(0, 8));
      [marca(pid, f, 'entrada', e), marca(pid, f, 'salida_almuerzo', at(f, 12, ri(0, 2)), { por: 'supervisor', motivo: 'Almuerzo registrado en el turno' }),
       marca(pid, f, 'regreso_almuerzo', at(f, 13, ri(0, 2)), { por: 'supervisor', motivo: 'Regreso de almuerzo registrado en el turno' }), marca(pid, f, 'salida', sal)].forEach(m => ap[m.id] = 1);
    });
    LINEA_IDS.concat(['p03']).forEach(pid => {
      marca(pid, f, 'entrada', at(f, 7, 45 + ri(0, 16)));
      if (pid === 'p03') { marca(pid, f, 'salida', at(f, 17, 10)); return; }
      marca(pid, f, 'salida_almuerzo', at(f, 12, 0), { por: 'linea', motivo: 'Almuerzo de la línea' });
      marca(pid, f, 'regreso_almuerzo', at(f, 13, 0), { por: 'linea', motivo: 'Regreso del almuerzo de la línea' });
    });
    TURNO_IDS.forEach(pid => equipo.push(miembro(pid, f)));
    const col = pid => equipo.find(c => c.id === pid);
    PLAN.forEach(([pids, pasos]) => {
      const cols = pids.map(col);
      pasos.forEach(([tid, kid, d, h]) => hist.push(tarea(tid, kid, cols, hm(f, d), hm(f, h), 0.78 + rnd() * 0.32)));
      cols.forEach(c => hist.push(almuerzo(c, at(f, 12), at(f, 13))));
      if (sobre.some(p => pids.includes(p))) hist.push(tarea('t5', 'k2', cols.filter(c => sobre.includes(c.id)), at(f, 17), at(f, 19), 0.9 + rnd() * 0.15));
    });
    // Líneas del día: A y B siempre, C dos días por semana
    const lt = [TIPOS[0], TIPOS[1], TIPOS[2]], conC = k % 3 === 0;
    const grupos = conC ? [LINEA_IDS.slice(0, 5), LINEA_IDS.slice(5, 10), LINEA_IDS.slice(10)] : [LINEA_IDS.slice(0, 7), LINEA_IDS.slice(7)];
    const lineas = grupos.map((g, i) => linea(lt[i], 'ABC'[i], f, g, at(f, 8), at(f, 17), 0.82 + rnd() * 0.3, { paro: i === 1 && k % 2 === 0 ? 'Falta de insumo' : null }));
    lineas.forEach(l => l.personas.forEach(p => marca(p.personaId, f, 'salida', at(f, 17, 0), { por: 'linea', motivo: 'Salida con la línea ' + l.letra + ' · ' + l.nombre, corregido_por: 'linea', corregido_en: new Date(at(f, 17)).toISOString() })));
    const turno = { id: uid('t'), fecha: f, hora: '08:00', inicio: at(f, 8), fin: Math.max(...TURNO_IDS.map(pid => Date.parse(SRV.marcas.filter(m => m.persona_id === pid && m.fecha === f && m.tipo === 'salida')[0].ts))),
      equipo: TURNO_IDS.map(pid => miembro(pid, f)), jornada: 'completa', hpPorPersona: 8, horasProd: TURNO_IDS.length * 8, estado: 'cerrado', historial: hist,
      toolboxDone: true, tareasDia: [], marcasAplicadas: ap, justCausa: '', justNota: '',
      sobre: sobre.length ? [{ id: uid('so'), inicio: at(f, 17), hasta: at(f, 19), horas: 2, motivo: 'Despacho urgente', personas: sobre, por: 'supervisor', porNombre: 'Roberto Sánchez', creado: at(f, 16, 40), amp: [] }] : [] };
    return { turno, lineas };
  }

  // ── El día de hoy, en vivo hasta este momento
  function diaHoy(){
    const f = HOY, ap = {};
    const ini = Math.min(at(f, 8), NOW - 2.5 * H);
    const off = ini - at(f, 8);                       // si se abre muy temprano, el día se corre para que haya algo que ver
    const t = h => hm(f, h) + off;
    const presentes = TURNO_IDS.filter(pid => pid !== 'p12');           // Carlos Mendieta no vino hoy
    presentes.forEach(pid => { const e = pid === 'p11' ? t(8) + 22 * MIN : t(7.8) + ri(0, 14) * MIN; ap[marca(pid, f, 'entrada', e).id] = 1; });
    const enAlm = NOW > t(12), volvio = NOW > t(13);
    if (enAlm) presentes.forEach(pid => { ap[marca(pid, f, 'salida_almuerzo', t(12), { por: 'supervisor', motivo: 'Almuerzo registrado en el turno' }).id] = 1;
      if (volvio) ap[marca(pid, f, 'regreso_almuerzo', t(13), { por: 'supervisor', motivo: 'Regreso de almuerzo registrado en el turno' }).id] = 1; });
    LINEA_IDS.concat(['p03']).forEach(pid => marca(pid, f, 'entrada', t(7.75) + ri(0, 16) * MIN));
    if (enAlm) LINEA_IDS.forEach(pid => { marca(pid, f, 'salida_almuerzo', t(12), { por: 'linea', motivo: 'Almuerzo de la línea' });
      if (volvio) marca(pid, f, 'regreso_almuerzo', t(13), { por: 'linea', motivo: 'Regreso del almuerzo de la línea' }); });
    const equipo = presentes.map(pid => miembro(pid, f)), col = pid => equipo.find(c => c.id === pid);
    const hist = [], activas = [];
    PLAN.forEach(([pids, pasos]) => {
      const cols = pids.filter(p => presentes.includes(p)).map(col); if (!cols.length) return;
      const libre = pids.includes('p09');                             // Omar quedó sin tarea hace 25 min: aviso de persona sin tarea
      const seg = pasos.map(([tid, kid, d, h]) => [tid, kid, t(d), t(h)]);
      seg.forEach(([tid, kid, a, b]) => {
        if (b <= NOW) hist.push(tarea(tid, kid, cols, a, b, 0.8 + rnd() * 0.3));
        else if (a <= NOW) {
          if (libre && NOW - a > 30 * MIN) { hist.push(tarea(tid, kid, cols, a, NOW - 25 * MIN, 0.85)); return; }
          const tt = T(tid), c = C(kid);
          activas.push({ id: uid('ac'), tareaId: tt.id, tarea: tt.nombre, clienteId: c.id, cliente: c.nombre, colaboradores: cols, inicio: a, fin: null, nota: '', prod: tt.prod, unidad: tt.unidad,
            cantAcum: 0, tdId: null, lineaId: null, bodega: cols[0].bodega, por: 'supervisor' });
        }
      });
      if (enAlm) cols.forEach(c => { if (volvio) hist.push(almuerzo(c, t(12), t(13)));
        else activas.push({ id: uid('aa'), tareaId: '_almuerzo', tarea: 'Almuerzo', clienteId: null, cliente: 'Interno', colaboradores: [c], inicio: t(12), fin: null, prod: 0, unidad: '', sinProd: true, isEspecial: true, causa: 'almuerzo', por: 'supervisor' }); });
    });
    // si alguien quedó con dos actividades a la vez (almuerzo en curso), solo queda el almuerzo
    const enAlmuerzo = new Set(activas.filter(a => a.causa === 'almuerzo').flatMap(a => a.colaboradores.map(c => c.id)));
    const act = activas.filter(a => a.causa === 'almuerzo' || !a.colaboradores.some(c => enAlmuerzo.has(c.id)));
    const turno = { id: uid('t'), fecha: f, hora: '08:00', inicio: ini, equipo, jornada: 'completa', hpPorPersona: 8, horasProd: presentes.length * 8,
      toolboxDone: true, tareasDia: [], marcasAplicadas: ap, ultCliente: 'k1' };
    // Líneas de hoy: A a buen ritmo, B por debajo de la meta (aviso de productividad en riesgo); mañana, una planificada
    const lineas = [linea(TIPOS[0], 'A', f, LINEA_IDS.slice(0, 7), ini, null, 1.04), linea(TIPOS[1], 'B', f, LINEA_IDS.slice(7), ini + 15 * MIN, null, 0.78)];
    const man = new Date(NOW + 24 * H); while ([0].includes(man.getDay())) man.setDate(man.getDate() + 1);
    const plan = linea(TIPOS[2], 'A', dstr(man), [], null, null, 0); Object.assign(plan, { estado: 'pendiente', inicio: null, fin: null, personas: [], pallets: [], almuerzos: [], almuerzoActivo: null, meta: 24, porInicio: undefined, responsable: undefined, insumos: plan.insumos.map(i => ({ ...i, entregas: [], sobrante: null })) });
    return { turno, historial: hist, tareasActivas: act, lineas: lineas.concat([plan]) };
  }

  function sembrar(){
    SRV.users = JSON.parse(JSON.stringify(USERS));
    SRV.personal = JSON.parse(JSON.stringify(PERSONAL));
    SRV.marcas = []; SRV.marcaSeq = 0; SRV.prefs = {}; SRV.subs = []; SRV.eventos = new Set(); SRV.push = [];
    const dias = []; const d = new Date(NOW); d.setHours(12, 0, 0, 0);
    while (dias.length < 10) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) dias.push(dstr(d)); }
    dias.reverse();
    const hist = [], lineas = [];
    dias.forEach((f, k) => { const r = diaCerrado(f, k); hist.push(r.turno); lineas.push(...r.lineas); });
    const h = diaHoy();
    // Pedidos de personal de los clientes: uno respondido de ayer y los de mañana por confirmar
    const diaMas = n => { const x = new Date(NOW); x.setDate(x.getDate() + n); return dstr(x); };
    const hm = t => dstr(new Date(t)) + ' ' + pad(new Date(t).getHours()) + ':' + pad(new Date(t).getMinutes());
    const ped = (id, cli, fecha, lineas, extra, log) => Object.assign({ id, clienteId: cli, fecha, inicio: '08:00', fin: '17:00', lineas, lugar: '', notas: '',
      estado: 'pendiente', creado: NOW - 3 * H, porUsuario: '', fueraHora: false, respuesta: '', vistoCliente: true, log }, extra);
    const pedidosPersonal = [
      // Los de hoy, confirmados ayer: en «Pedidos de clientes» se comparan con quienes marcaron para cada cliente
      ped('ph1', 'k1', HOY, [{ tipo: 'operador', cant: 6, conf: 6 }, { tipo: 'supervisor', cant: 2, conf: 2 }], { estado: 'confirmado', lugar: 'Bodega 1', creado: NOW - 26 * H },
        [{ t: hm(NOW - 26 * H), u: 'Laura Méndez · Importadora Istmo', a: 'Pidió 8 personas' }, { t: hm(NOW - 25 * H), u: 'Roberto Sánchez', a: 'Confirmó las 8 personas' }]),
      ped('ph2', 'k2', HOY, [{ tipo: 'linea', cant: 16, conf: 15 }], { estado: 'parcial', lugar: 'Líneas de maquila', creado: NOW - 27 * H, respuesta: 'Podemos cubrir 15 personas' },
        [{ t: hm(NOW - 27 * H), u: 'Carlos Ríos · Distribuidora Atlántico', a: 'Pidió 16 personas' }, { t: hm(NOW - 25 * H), u: 'Roberto Sánchez', a: 'Confirmó 15 de 16 personas' }]),
      ped('pp1', 'k1', diaMas(-1), [{ tipo: 'ag', cant: 6, conf: 6 }, { tipo: 'operador', cant: 2, conf: 2 }], { estado: 'confirmado', lugar: 'Bodega 1 · recepción', creado: NOW - 30 * H },
        [{ t: hm(NOW - 30 * H), u: 'Laura Méndez · Importadora Istmo', a: 'Pidió 8 personas' }, { t: hm(NOW - 28 * H), u: 'Roberto Sánchez', a: 'Confirmó las 8 personas' }]),
      ped('pp2', 'k2', diaMas(1), [{ tipo: 'linea', cant: 10, conf: 0 }, { tipo: 'supervisor', cant: 1, conf: 0 }], { lugar: 'Línea de empaque', notas: 'Maquila de kits promocionales, se necesita experiencia en empaque', creado: NOW - 2 * H },
        [{ t: hm(NOW - 2 * H), u: 'Carlos Ríos · Distribuidora Atlántico', a: 'Pidió 11 personas' }]),
      ped('pp3', 'k3', diaMas(1), [{ tipo: 'ag', cant: 4, conf: 0 }], { inicio: '07:00', fin: '15:00', lugar: 'Patio de contenedores', creado: NOW - 1 * H },
        [{ t: hm(NOW - 1 * H), u: 'Comercial Bahía Azul', a: 'Pidió 4 personas' }])
    ];
    const state = { colaboradores: [], tareasCat: TAREAS, clientes: CLIENTES, config: CONFIG, pedidosPersonal, usuariosCliente: USUARIOS_CLIENTE,
      tarifasCliente: TARIFAS_CLIENTE, servicios: [], proformas: proformasDemo(),
      // Cotizaciones de ejemplo: una enviada a Importadora Istmo (la puede aceptar en su portal), una aceptada y un pedido de Atlántico
      cotizaciones: [
        { id: 'cq1', numero: 'COT-0001', clienteId: 'k1', prospecto: null, titulo: 'Inventario de fin de año', servicio: 'Conteo físico de la bodega del 15 al 20 de diciembre, dos turnos.',
          vigencia: 15, notas: 'Incluye equipo de protección personal.', itbms: 7, estado: 'enviada', fecha: dstr(new Date(NOW - 2 * 24 * H)), vence: dstr(new Date(NOW + 13 * 24 * H)), enviada: NOW - 2 * 24 * H, creada: NOW - 3 * 24 * H, vistoCliente: false,
          lineas: [{ id: 'l1', tipo: 'personal', srvId: 'ag', personas: 12, dias: 6, horasExtra: 24, precio: 44 }, { id: 'l2', tipo: 'personal', srvId: 'supervisor', personas: 1, dias: 6, horasExtra: 0, precio: 70 }],
          log: [{ t: dstr(new Date(NOW - 2 * 24 * H)) + ' 09:00', u: 'Administrador Demo', a: 'La envió al portal del cliente' }] },
        { id: 'cq2', numero: 'COT-0002', clienteId: null, prospecto: { empresa: 'Logística del Pacífico', contacto: 'Mario Arosemena', correo: 'compras@ejemplo.pa', telefono: '6000-0000' },
          titulo: 'Personal de carga para bodega nueva', servicio: '', vigencia: 15, notas: '', itbms: 7, estado: 'borrador', fecha: dstr(new Date(NOW)), creada: NOW - 3600000,
          lineas: [{ id: 'l3', tipo: 'personal', srvId: 'operador', personas: 4, dias: 20, horasExtra: 0, precio: 58 }, { id: 'l4', tipo: 'otro', desc: 'Transporte de personal', cant: 20, unidad: 'día', precio: 35, costoU: 25 }],
          log: [{ t: dstr(new Date(NOW)) + ' 08:00', u: 'Administrador Demo', a: 'Creó la cotización' }] }],
      solicitudesCot: [{ id: 'sc1', clienteId: 'k2', fecha: dstr(new Date(NOW - 24 * H)), por: 'Carlos Ríos', texto: 'Necesitamos cotizar una segunda línea de maquila para kits navideños, 8 personas por 3 semanas.', estado: 'pendiente' }],
      clientesAvanzado: { k1: true }, solicitudesAvanzado: {},   // Importadora Istmo ve Mi turno avanzado; Atlántico, el básico
      fichas: Object.fromEntries(PERSONAL.map((p, i) => [p.id, { cedula: '8-' + (700 + i * 13) + '-' + (1200 + i * 377) }])), lineasTipo: TIPOS, lineas: lineas.concat(h.lineas),
      turnosHistorial: hist, solicitudes: [], turnosProgramados: [], rutinas: [], plantillas: [], temaHSE: [], causasParo: [], lineasPlan: [], nombresLinea: [],
      turno: h.turno, historial: h.historial, tareasActivas: h.tareasActivas };
    SRV.rows = { [SKEY]: { value: state, version: 1 } };
  }

  // ── Guardar y recuperar la demostración de este navegador
  function guardar(){
    try { localStorage.setItem(KEY, JSON.stringify({ dia: HOY, rows: SRV.rows, users: SRV.users, personal: SRV.personal, marcas: SRV.marcas, marcaSeq: SRV.marcaSeq,
      prefs: SRV.prefs, subs: SRV.subs, eventos: [...(SRV.eventos || [])] })); } catch (e) { console.warn('Demo: no se pudo guardar', e); }
  }
  let previo = null; try { previo = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (previo && previo.dia === HOY && previo.rows && previo.rows[SKEY]) {
    Object.assign(SRV, { rows: previo.rows, users: previo.users, personal: previo.personal, marcas: previo.marcas, marcaSeq: previo.marcaSeq,
      prefs: previo.prefs || {}, subs: previo.subs || [], eventos: new Set(previo.eventos || []) });
  } else {
    if (previo) { borrarTodo(); SRV.sessions = {}; }          // demostración de otro día: empieza de nuevo
    sembrar(); guardar();
  }
  SRV.offline = false;

  // Cada llamada al «servidor» guarda la demostración
  const crear = window.supabase.createClient;
  window.supabase.createClient = function(){
    const c = crear.apply(this, arguments), rpc = c.rpc, inv = c.functions.invoke;
    c.rpc = async (fn, args) => { const r = await rpc(fn, args); if (!/^ch_(get_state|version|me|marcajes|personal_list|list_users|avisos_get|check_pass)$/.test(fn)) guardar(); return r; };
    // Avisos push: en la demostración se muestran dentro de la app (no hay servidor de notificaciones)
    c.functions.invoke = async (name, opt) => { const b = (opt && opt.body) || {};
      if (b.accion === 'clave') return { data: null, error: { message: 'En la demostración los avisos se ven dentro de la app' } };
      return inv(name, opt); };
    return c;
  };
  // Pestañas abiertas a la vez (por ejemplo, la Vista TV): cuando otra guarda, esta lee lo nuevo
  window.addEventListener('storage', e => {
    if (e.key !== KEY || !e.newValue) return;
    try { const s = JSON.parse(e.newValue); Object.assign(SRV, { rows: s.rows, users: s.users, personal: s.personal, marcas: s.marcas, marcaSeq: s.marcaSeq }); } catch (_) {}
  });

  // ── Franja de demostración (abajo a la izquierda): aclara que los datos son ficticios y permite reiniciar
  window.doorDemoReiniciar = function(){
    if (!confirm('¿Reiniciar la demostración? Se borra lo que hayas cambiado y vuelven los datos de ejemplo.')) return;
    borrarTodo(); location.href = location.pathname;
  };
  document.addEventListener('DOMContentLoaded', () => {
    // Sin servidor de notificaciones: no se insiste en activar los avisos del teléfono (los avisos se ven dentro de la app)
    if (typeof window.revisarRegistroAvisos === 'function') window.revisarRegistroAvisos = function(){};
    const b = document.createElement('div'); b.className = 'door-demo-tag';
    b.innerHTML = '<span>Demostración · datos ficticios</span><button type="button" onclick="doorDemoReiniciar()">Reiniciar</button>';
    document.body.appendChild(b);
  });
})();
