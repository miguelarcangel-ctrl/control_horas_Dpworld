# Plan Mejoras Auditoría — App Control de Horas DP World

28-nov-2026 · Miguel Charris

> Documento para Claude Code. Las secciones de diagnóstico dan contexto; lo que se ejecuta está en **Cómo tener más espacio** e **Instrucciones para Claude Code** (al final).

## Resumen ejecutivo

**Calificación global: 7.3 / 10 frente a su propósito** (controlar horas-persona, tareas, costos y productividad de la cuadrilla en tiempo real). Es una herramienta de operación seria: el motor de costos es correcto y tiene pruebas, maneja dos bodegas, marcaje en tablet, líneas de producción, avisos obligatorios y trabajo sin conexión. Lo que la frena no es lo que hace, sino **cómo se encuentra y cómo se lee**: un menú largo y plano, cuatro definiciones distintas de "eficiencia" y una arquitectura de datos que tiene techo.

- **Fortaleza principal:** la pantalla Turno. En un vistazo el supervisor ve quién está sin tarea (en rojo, con cronómetro), quién trabaja, en qué y para qué cliente.
- **Debilidad principal:** el menú del administrador tiene 36 entradas y el del supervisor 21, de las cuales 16 son reportes.
- **Riesgo técnico principal:** todo el estado vive en un solo registro JSON que se reenvía completo en cada guardado.
- **Mayor oportunidad:** pasar de *medir horas* a *gestionar desempeño*.

Método: revisión del repositorio `control_horas_Dpworld` (28-nov-2026, PR #94), app levantada con el simulador de pruebas, recorrido como administrador y supervisor en celular (400 px) y PC (1440 px).

## Calificación por dimensión

| Dimensión | Nota (1–10) | Peso |
| --- | --- | --- |
| Funcionalidad | 9.0 | 20% |
| Productividad operativa | 8.0 | 15% |
| Estética y línea gráfica | 7.5 | 5% |
| Exactitud de cálculos | 7.0 | 15% |
| Uso en celular | 7.0 | 10% |
| Seguridad | 7.0 | 5% |
| Gestión de personal | 6.5 | 5% |
| Intuitividad | 6.5 | 10% |
| Menú y navegación | 6.0 | 10% |
| Escalabilidad de datos | 5.0 | 5% |
| **Global ponderada** | **7.3** | |

## Funcionalidad

**Lo que hace bien**

- Motor único de costos (`calcTurno`) con horas-persona, recargo sábado/domingo y sobretiempo; las pruebas validan montos al centavo.
- Separa productivo, apoyo, no productivo y **sin registrar**.
- Marcaje en tablet con cédula cifrada, salida automática al día siguiente y corrección con motivo y autor.
- Dos bodegas en una misma vista (filtro CLP / MSL).
- Avisos obligatorios que no se pueden apagar.
- Guardado con versión e integración de cambios simultáneos.
- Modo sin conexión con sincronización al volver.

**Brechas encontradas**

| Brecha | Dónde se ve | Impacto |
| --- | --- | --- |
| Cuatro "eficiencias" distintas | Turno: Efic. 54% (dólares, turno actual) · Resumen: Eficiencia 80% (dólares, histórico) y Productivo 68% (horas) · Por tarea / Por persona: Eficiencia contra el estándar del catálogo | Alto |
| Resumen sin filtro de fechas | Productividad y costos → Resumen | Alto |
| "Turno en tiempo real" repetido | Turno y Resumen | Medio |
| 16 reportes con selector duplicado | Menú + desplegable "Reporte" dentro | Medio |
| Pantallas vacías sin acción | Líneas: "Primero crea los tipos de línea en Configuración" sin botón | Bajo |
| Supervisor no ve Personal ni Asistencia | Su menú solo tiene acciones y reportes | Medio |
| El estándar existe en el catálogo pero no se ve al asignar | Modal Nueva tarea | Alto |

## Menú y submenú

Admin 36 filas, supervisor 21; en celular se ven unas 15 a la vez. Propuesta: 15 y 8 filas sin quitar funciones.

**Diagnóstico**

1. Reportería pesa el 44% del menú (16 de 36), con seis nombres casi iguales sobre líneas.
2. Productividad y costos son 5 pantallas del mismo dato con distinto corte.
3. Todos los grupos salen abiertos.
4. No hay título de pantalla ni ruta.
5. "Clientes y cobros" tiene una sola fila cuando la facturación está apagada.
6. El grupo "Personal" del supervisor solo tiene dos acciones.

**Menú propuesto**

| Rol | Grupo | Filas (contenido) |
| --- | --- | --- |
| Admin | En vivo | Turno · Líneas · Vista TV |
| Admin | Personal | Fichas del personal · Asistencia y horas · Marcaje en tablet |
| Admin | Indicadores | **Una** pantalla con pestañas Resumen / Tarea / Persona / Cliente / Histórico y filtro de fechas |
| Admin | Reportes | **Una** fila que abre un catálogo en 5 bloques: Asistencia (3) · Tareas y turnos (2) · Costos (2) · Producción (3) · Líneas (6) |
| Admin | Clientes | Clientes (y Cobros, Cotizaciones, Estado de cuenta solo con facturación encendida) |
| Admin | Configuración | Catálogos (tareas, líneas, cargos en pestañas) · Plantillas · Horario y recargos · Usuarios · **Uso de la app** |
| Admin | Ayuda | Avisos · Tutorial |
| Supervisor | Mi turno | Turno · Líneas (si tiene) |
| Supervisor | Mi gente | Asistencia de hoy y de la semana (solo su bodega) · Dar de alta · Marcaje en tablet |
| Supervisor | Reportes | Catálogo filtrado a los que usa |
| Supervisor | Ayuda | Avisos · Tutorial |

Reglas: grupos plegados salvo el actual; título "Grupo › Pantalla" en la cinta; en celular barra inferior Turno · Gente · Reportes · Avisos; buscador en el menú.

## Estética, intuitividad y amigabilidad

| # | Hallazgo | Pantalla | Arreglo |
| --- | --- | --- | --- |
| 1 | En celular la cinta corta "CONTROL DE HORAS" y "EQUIPO" sale como "EQ…" | Turno (400 px) | Subtítulo más corto; botones de Equipo a segunda fila |
| 2 | Aviso "Este teléfono no recibe avisos" ocupa ~100 px en cada pantalla | Todas | Una vez y luego punto en Avisos |
| 3 | Cinco botones de colores distintos en el banner | Turno | Un primario (+ Tarea) y el resto en "Más" |
| 4 | Rojo de estado no uniforme | Turno | Mismo rojo de estado en toda la app |
| 5 | Tablas en mayúsculas con espaciado ancho | Resumen, Reportes | Mayúsculas solo en títulos |
| 6 | Pantallas casi vacías en PC | Horario y recargos, Personal | Personal como tabla con búsqueda, cargo, bodega, estado y última asistencia |
| 7 | Textos de ayuda largos | Personal, Turno | Una línea + "¿Cómo funciona?" |
| 8 | Estado vacío sin botón | Líneas | Botón "Crear tipo de línea" |
| 9 | Al asignar no se ve la meta | Nueva tarea | "Meta: 20 pallets/h · esperado 160 en 8 h" |
| 10 | Tutorial de 15 tarjetas | Inicio | Por rol (supervisor: 5) |

## Seguridad, datos y arquitectura

| Riesgo | Detalle | Prioridad |
| --- | --- | --- |
| Todo en un solo registro JSON | Una fila de `kv_store`; cada guardado reenvía el estado completo | Se controla con Uso de la app (T1), E1–E2 y compactación (T2–T3). No migrar a tablas propias |
| El supervisor descarga costos | `ch_get_state` entrega tarifas y costos a cualquier sesión | Media |
| Marcaje con cédula | Permite marcar por otro | Media-alta |
| Sin bloqueo por intentos | Solo 0.6 s de espera por intento fallido | Media |
| Sesión de 30 días | Tablet compartida entra como el último usuario | Media |
| Archivo de 8,880 líneas | Mitigado por 1,652 líneas de pruebas | Media |

## Visión de experto: producción, productividad y gestión de personal

**Productividad y producción**

1. **Estándares por tarea y cliente.** El catálogo ya tiene producción objetivo y % de eficiencia por tarea, y las líneas muestran "ritmo vs. objetivo". Falta estándar por cliente, meta visible al asignar y % de cumplimiento con color al cerrar.
2. **Horas ganadas vs. horas usadas.** Cantidad ÷ estándar = horas ganadas; Rendimiento = ganadas ÷ pagadas. Unifica las cuatro "eficiencias".
3. **Causa del tiempo sin registrar.** Las pausas y paros ya tienen causa; el tiempo sin registrar no. Pedirla en un toque y hacer Pareto mensual.
4. **OEE en líneas.** Disponibilidad × rendimiento × calidad.
5. **Costo por unidad por cliente y mes.** Ya existe por tarea; falta el corte por cliente y mes.
6. **Planificación de personal por volumen** con DP Bridge / Last Mile, partiendo del dimensionador existente.

**Gestión de personal**

1. Ficha de desempeño por persona (semana y mes).
2. Matriz de habilidades y certificaciones que bloquee asignaciones sin certificación vigente.
3. Límite legal de sobretiempo: según MITRADEL, máximo 3 h extra al día y 9 a la semana; el excedente se paga con 75% de recargo (https://mitradel.gob.pa/wp-content/uploads/2019/12/Bolet%C3%ADn.pdf). Validar con RR. HH. el multiplicador 1.5× configurado.
4. Marcaje confiable con PIN o foto.
5. Ausentismo y rotación.
6. Indicadores del supervisor: % de horas registradas y tiempo de respuesta a "sin tarea".
7. Reconocimiento visible en la Vista TV (sin costos).

## Pantalla nueva: Uso de la app

En **Configuración → Uso de la app**, solo administrador, filtro 7 / 30 días, botón Excel, sin costos. El aviso actual de 4 MB enlaza aquí.

| Bloque | Qué muestra | De dónde sale |
| --- | --- | --- |
| Espacio | MB usados frente al umbral de 4 MB (barra verde/ámbar desde 70%/roja desde 90%); qué parte pesa más; crecimiento de 30 días y "al ritmo actual llegas al umbral en N semanas"; tamaño de los meses archivados (E2) | Tamaño del estado y columna nueva `bytes` en `ch_kv_historial` |
| Adopción | Por usuario: último ingreso, días activos y guardados en 7 y 30 días, equipo (celular, tablet, PC). Marcajes en tablet por día | `ch_kv_historial` (usuario, fecha, agente) y `ch_marcajes` |
| Calidad del registro | % de horas registradas sobre pagadas por día y por supervisor; turnos con cantidades pendientes; salidas automáticas | `calcTurno` sobre el histórico y `ch_marcajes` |

## Cómo tener más espacio

**Hoy no hay urgencia: el estado real pesa 0.12 MB (3% de 4 MB).** Medido en Supabase el 28-nov-2026: 7 turnos cerrados desde el 9-nov (6.5 KB promedio, 13.7 KB el más pesado) y 44 líneas desde el 6-nov (1.5 KB cada una). Al ritmo actual (~5–6 KB por día) se llegaría a 4 MB en unos 20 meses; con turno diario en las dos bodegas, en unos 10.

**De dónde sale el límite.** Los 4 MB son un aviso de la propia app, no un límite de Supabase (la base completa pesa 16 MB). Los topes reales son:

1. **Respaldo sin conexión** en `localStorage` con dos copias (`base` y `local`). Ese almacén tiene ~5 MB, así que **por encima de ~2.5 MB el respaldo falla en silencio**.
2. **Cada guardado sube el estado completo** (ya van 2,012 guardados).

**Solución: separar lo caliente de lo archivado, sin crear tablas nuevas** (se sigue usando `kv_store`, en varias llaves):

| Llave | Contiene | Tamaño esperado | Se carga |
| --- | --- | --- | --- |
| `ctrl_horas` | Configuración, catálogos, clientes, turno y líneas en curso, mes actual | < 300 KB siempre | Al entrar, como hoy |
| `ctrl_horas_arch_AAAA-MM` | Turnos y líneas cerrados de ese mes, comprimidos | 30–80 KB por mes | Solo al abrir reportes o indicadores de ese mes |

**Tareas de espacio (ejecutar después de T1 y antes de T2)**

| Tarea | Qué hacer | Dónde | Criterio de aceptación |
| --- | --- | --- | --- |
| E1 · Respaldo sin tope | Mover el respaldo sin conexión de `localStorage` a IndexedDB y guardar una sola copia más la versión | `save`, `reload`, arranque (~l. 1997–2079) | Respaldo simulado de 20 MB se guarda y recupera; prueba "sin conexión" existente en verde |
| E2 · Archivo mensual | Al iniciar cada mes (o con botón en Uso de la app) mover turnos y líneas cerrados de meses anteriores a `ctrl_horas_arch_AAAA-MM`, comprimidos con `CompressionStream('gzip')` en base64. Funciones nuevas `ch_get_archivo` y `ch_save_archivo` (admin y supervisor); `ch_key_ok` acepta `ctrl_horas_arch_\d{4}-\d{2}`. Reportes e Indicadores cargan los meses del filtro y los guardan en memoria durante la sesión. **Antes del primer movimiento: respaldo en `ch_respaldos`** | Migración nueva, `normalizeS`, motor de reportes, Uso de la app | Mismos totales antes y después; llave caliente < 300 KB; Vista TV, líneas y marcaje sin cambios (solo leen lo vigente) |

Con E1 y E2, T4 (resumir turnos antiguos) deja de hacer falta: no se pierde detalle nunca.

## Instrucciones para Claude Code

Repositorio: `miguelarcangel-ctrl/control_horas_Dpworld`. Leer `CLAUDE.md` y `README.md` y seguir sus reglas: español, línea gráfica del skill `.claude/skills/linea-grafica/` (sin íconos ni emojis, tema claro y oscuro), avisos obligatorios (`AVISOS_OBLIG` y `OBLIG` deben coincidir), una rama y un PR por tarea, pruebas (`node tests/run_tests.js`) y vista previa de Vercel en verde antes de fusionar. Cada tarea agrega sus pruebas a `tests/run_tests.js`.

**No hacer:** migrar el estado de `kv_store` a tablas propias ni cambiar cómo se guarda el JSON fuera de lo que piden E1 y E2. No editar `dpw/dpw-shell.*` aquí: el kit se cambia en HubApp y se copia.

**Principio rector: presupuesto de 4 MB**

Hoy cada tarea cerrada copia el nombre de la tarea, el del cliente, cada colaborador completo (id, nombre, cargo), la ficha `excel`, `realProd` y `efic`; cada turno cerrado guarda su equipo con las marcas y todo su historial, y nada se poda. El 30-oct-2026 hubo que borrar 39 turnos por espacio (ver `20261030_ch_respaldos.sql`). Primero se mide, luego se compacta, y después se agregan funciones que no suman bytes.

Reglas de datos:

1. **Nada nuevo en el JSON si puede vivir en una tabla del servidor que ya existe** (`ch_personal`, `ch_marcajes`, `ch_kv_historial`) o calcularse al mostrar.
2. **Guardar ids, no copias.** En una tarea cerrada, colaboradores = lista de ids (y el cargo solo si difiere del catálogo).
3. **No guardar lo que se recalcula** (`realProd`, `efic`, `excel`, totales). Excepción: montos congelados del cierre (`costoPagado`, `costoProductivo`, `costoPerdido`) y el estándar vigente (`prod`).
4. **No guardar vacíos:** sin `null`, `false`, `""`, `[]` ni `{}`.
5. **Preferencias de pantalla** en `localStorage`, nunca en el estado.
6. **Compatibilidad:** `normalizeS` lee el formato viejo y el compacto.
7. **Presupuesto medido:** prueba con un turno de referencia (15 personas, 40 tareas) que falla si supera la meta fijada en T2. Cada PR indica cuántos bytes suma o resta.

**Orden de ejecución:** T1 → E1 → E2 → T2 → T3 → T5…T17 (T4 queda descartada si E2 se completa).

| Tarea | Qué hacer | Dónde | Efecto en datos | Criterio de aceptación |
| --- | --- | --- | --- | --- |
| T1 · Uso de la app | Pantalla descrita arriba, con desglose de bytes por bloque y por turno. Migración aditiva: columna `bytes int` en `ch_kv_historial` (llenada en `ch_save_state` con `octet_length(p_value::text)`) y función `ch_uso(p_token, p_key, p_dias)` solo admin | `supabase/migrations/2026xxxx_uso.sql`, `CATS` (Configuración), `tests/mock_supabase.js` | 0 en el JSON | Solo admin la ve; `checkTamañoS` enlaza aquí |
| T2 · Compactar al cerrar | Formato compacto de las reglas 2–4 al cerrar tarea y turno (marcas del equipo solo con tipo y hora). Reportes recalculan lo quitado | Cierre de tarea (~l. 4817), `cerrarTurno` (~l. 4952), `normalizeS`, reportes | Resta: meta ≥ 50% menos por turno (fijar con lo medido en T1) | Mismos montos y reportes; prueba de presupuesto en verde |
| T3 · Compactar lo existente | Pasar el histórico actual al formato compacto. **Antes: respaldo en `ch_respaldos` y confirmación del dueño** | Acción de admin en Uso de la app | Resta | Totales por turno idénticos; respaldo creado |
| T4 · Resumen de turnos antiguos | **Descartada si E2 está hecha.** Solo con confirmación del dueño | — | — | — |
| T5 · Un solo rendimiento | "Rendimiento = horas ganadas ÷ horas pagadas" en banner, Resumen, Por tarea y Por persona; "% productivo" para horas; "eficiencia" deja de usarse para dólares | `calcTurno`, banner (~l. 3244), tablas (~l. 4049 y ~4062) | 0 | Cada indicador con una línea que lo explica; pruebas de montos en verde |
| T6 · Filtro de fechas | Hoy / 7 / 30 días / mes / rango en Productividad y costos (carga meses archivados de E2) | `ins:resumen`, `prodTareas`, `prodPersonas`, `costosCli`, `historico` | 0 (`localStorage`) | El filtro recalcula todo |
| T7 · Menú compacto | Menú propuesto; Reportes en una fila con catálogo; "Indicadores" con pestañas; sin selector duplicado; título "Grupo › Pantalla" | `CATS`, `pintarMenu`, `pintarCatBar` (hoy desactivada con `if(true…)`) | 0 | Admin ≤ 16 filas, supervisor ≤ 8; pruebas `irA` actualizadas |
| T8 · Supervisor: Mi gente | Asistencia de hoy y de la semana de su bodega, solo lectura, sin cédula ni costos | Nueva clave en `CATS`; lee `ch_marcajes` | 0 | No ve costos ni otra bodega |
| T9 · Meta al asignar | "Meta X u/h · esperado Y en Z h para N personas"; al cerrar, % de cumplimiento con color (≥85 verde, 70–84 ámbar, <70 rojo) | `prepModalTarea`, modal de cierre (`eficRow`) | 0 | Visible en celular sin desplazar |
| T10 · Arreglos de celular | Cinta sin cortes a 400 px; "Equipo" completo; aviso de notificaciones una vez; banner con un primario y "Más"; estado vacío de Líneas con botón | Turno, cinta, Líneas | 0 | Capturas a 400 px sin textos cortados |
| T11 · Tablas legibles | Mayúsculas solo en títulos; Personal como tabla con búsqueda | CSS, `ins:personal` | 0 | Sin cambios de datos |
| T12 · Tutorial por rol | Supervisor 5 tarjetas; el resto en Ayuda | `iniciarTutorial` | 0 | ≤ 5 pasos para supervisor |
| T13 · Seguridad | Filtrar costos/tarifas de `ch_get_state` para supervisor; bloqueo 15 min tras 5 intentos fallidos; PIN de 4 dígitos opcional | Migración nueva; `ch_get_state`, `ch_login`, `ch_marcar`, `ch_linea_login`, `ch_operador_login` | 0 en el JSON | Supervisor sin tarifas; 6.º intento bloqueado |
| T14 · Causa del tiempo sin registrar | Causa en un toque al atender "Sin tarea" y al cerrar turno; Pareto mensual | Aviso `tur_libre`, cierre de turno, Reportes | Tope 1 KB por turno: `[persona, minutos, código de 3 letras]` | Cada hora sin registrar tiene causa o "sin causa" |
| T15 · Estándar por cliente y costo por unidad | Estándar opcional por cliente; reporte costo por unidad por cliente y mes | Catálogo de tareas, Reportes | Mínimo | Totales cuadran con Por tarea |
| T16 · Límite de sobretiempo | Aviso al acercarse a 3 h extra/día o 9/semana. **Confirmar con el dueño el 1.5× antes de tocar montos** | Avisos, `calcTurno` | 0 | Aviso 30 min antes |
| T17 · Ficha de desempeño y certificaciones | Ficha por persona calculada al mostrar; certificaciones con vencimiento en `ch_personal`; bloqueo de asignación con certificación vencida | Personal, catálogo, migración en `ch_personal` | 0 en el JSON | Bloqueo con motivo visible |

Al terminar cada tarea, dejar en el PR una captura en celular y en PC con datos de prueba (`?datos=prueba`), con la marca de DP World.
