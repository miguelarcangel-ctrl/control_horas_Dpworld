# Plan Adecuación Door

Plan acordado con el dueño el 28/11/2026. **No se ejecuta hasta que el dueño lo pida** con «ejecutar Plan Adecuación Door» (o una fase: «ejecutar Plan Adecuación Door, fase 1»).

Objetivo: que las mejoras hechas en el Control de Horas de DP World y lo construido para Door (facturación, cobros, cotizaciones) convivan sin duplicidades, y luego agregar el comprobante de pago para el empleado.

## Decisiones ya tomadas
- **Comprobante de pago: solo el monto bruto.** Door tiene personal en planilla y eventual: en la ficha de cada persona se marca su **tipo de vinculación** (planilla / eventual). El comprobante lo muestra y, para los de planilla, aclara: «Monto bruto: los descuentos de ley se aplican en la planilla oficial».
- **Acceso del empleado: cédula + PIN de 4 dígitos.** Opción «Ingresar como colaborador» en el login (junto a «Ingresar como línea / operador»), desde su propio celular; nunca en la tablet de marcaje.
- **Período: semanal.** El administrador revisa y **publica** la semana; recién entonces el empleado la ve.

## Pendiente del dueño (bloquea la fase 2, punto 2)
- **Paletas compartidas en una línea:** cómo se reparten para el pago cuando varias personas trabajan en la misma línea. Opciones: **según las horas de cada uno en la línea** (como ya atribuye el reporte «Producción por línea y cuadrilla», PR #83) o **en partes iguales**. El dueño lo está investigando; preguntarle antes de calcular el pago por paleta.

## Fase 1 · Unificar (sin duplicidades entre DP World y Door)
Se detectaron al comparar `main` después de los PR #61 a #94 con lo hecho para Door (PR #47 a #60).

1. **Un solo costo de línea.** Hoy el tipo de línea tiene el costo de DP World (`t.costo`: monto y UdM por persona, paleta o caja; `costoLinea`) y, en Door, «cómo se costea la maquila» (`t.venta.costeo` por personal o por unidad, `costoUnidad`). Queda solo el de DP World; Door agrega únicamente la **venta** (`t.venta`: precio y unidad de cobro). Ese mismo costo por paleta será la **tarifa de pago por paleta** del comprobante.
2. **Unidad de conteo.** La línea ya puede contarse en paletas o unidades (PR #85). Si se cuenta en unidades, se cobra sin convertir; la conversión «unidades de cobro por paleta» solo se pide cuando se cuenta en paletas y se cobra por caja o unidad.
3. **Un solo catálogo de personal.** Los **Cargos** de DP World (costo por día, PR #78) más una columna de **venta por día** que aparece cuando la facturación está encendida. «Servicios y tarifas» deja de duplicar el costo; la tarifa negociada por cliente, el tarifario, los rubros y las cotizaciones leen del mismo catálogo.
4. **Asistencia y planilla en una sola pestaña.** Hoy «Asistencia y horas» y «Planilla» muestran casi lo mismo, y la planilla de Door probablemente **no toma los ajustes del administrador por persona y día** (PR #88). Unificar en «Asistencia y planilla»: cédula, cliente, bodega, supervisor, horas con ajustes y, para el administrador con facturación, costo y venta. De ahí salen también los comprobantes.
5. **Una sola reportería de líneas.** Quedarse con la Reportería de DP World (producción diaria, por línea y por cuadrilla, con costo; PR #76 a #84) y sumarle venta y margen de Door cuando la facturación está encendida; quitar «Productividad y costos → Líneas» si queda duplicada.
6. **Migración de datos de Door.** Pasar servicios, tarifas por cliente (`S.tarifasCliente`, `S.tarifasOrigen`), maquila (`t.venta`) y fichas de personas a la estructura unificada sin perder nada; actualizar `demo-door/door/demo-data.js` y las pruebas.

## Fase 2 · Comprobante de pago
1. **PIN del colaborador:** lo crea la primera vez o lo asigna el administrador; el administrador puede reiniciarlo. En producción, cifrado en el servidor como la cédula.
2. **Cálculo semanal:**
   - Ayudante y operador: por horas de entrada a salida (sin almuerzo, sin lo marcado antes de la hora de inicio), con los ajustes del administrador, sobretiempo y recargos de sábado y domingo; tarifa de pago = costo del cargo (o costo propio de la persona) por hora.
   - Línea: paletas (o unidades) × tarifa de pago de la línea, repartidas según la regla que defina el dueño.
3. **Publicación:** el administrador revisa la semana, corrige en Asistencia y planilla y la **publica**; sin publicar, el empleado no ve nada.
4. **Vista del colaborador:** bruto, detalle por día (entrada, salida, horas, paletas, monto), tipo de vinculación y descarga en PDF.
5. **Reclamo:** «No estoy de acuerdo con este día» le llega al administrador (pieza de reclamos de `piezas-comunes`).
6. Pruebas automáticas, recorrido en el navegador, prototipo de Door actualizado y publicación según `CLAUDE.md`.
