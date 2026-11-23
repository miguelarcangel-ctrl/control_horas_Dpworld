# Control de Horas — DP World Panamá

App de una sola página (`index.html`) para turnos, tareas, costos y productividad de la bodega.

## Acceso y datos
- **Login** contra Supabase con contraseñas cifradas (tabla `ch_usuarios`). Sesión de 30 días por equipo.
- La base solo responde a funciones `ch_*` (ver `supabase/migrations`). La llave pública ya no da acceso a la tabla.
- **Guardado con versión**: si dos personas guardan a la vez, la app integra ambos cambios en vez de sobrescribir.
- **Sin conexión**: guarda en el equipo y sincroniza al volver.

## Pantallas
- `index.html` — app (administrador, supervisor y responsable de línea).
- Menú por **categorías**: Operación del día (turno, líneas, pedidos, Vista TV) · Personal (personal —unifica el antiguo maestro de colaboradores—, asistencia y horas, planilla, contingente, marcaje en tablet) · Productividad y costos (resumen, por tarea, por persona, líneas, costos por cliente, histórico, exportar) · Clientes y cobros (clientes, cobros y proformas, servicios y tarifas) · Configuración (tareas, líneas y maquila, plantillas, horario y recargos, usuarios) · Ayuda. Cada categoría abre su pantalla con pestañas arriba y recuerda la última usada. Ya no hay pantalla «Insights».
- `index.html?tv=1` o `dashboard.html` — Vista TV **solo para el administrador**: pide usuario y únicamente entra el perfil admin
  (la sesión queda guardada 30 días en esa pantalla). Otro perfil vuelve a la app normal. La pantalla de la bodega no muestra
  Analytics ni costos; Analytics solo lo ve el administrador desde la app (menú → Operación del día → Vista TV). No hay lectura de datos sin sesión.
- Tablet de marcaje: la activa el administrador (menú → Marcaje en esta tablet).
- Agrega `?datos=prueba` a cualquier URL para trabajar sobre una copia de ensayo (sale el aviso **MODO PRUEBA**).

## Cálculo de costos (motor único `calcTurno`)
- Se cuentan **horas-persona**: 2 personas × 1 h = 2 h.
- Tarifa/hora = tarifa diaria × factor de carga ÷ horas productivas de la jornada; sábado y domingo aplican su recargo.
- Pagado = base del turno + sobretiempo · Productivo = horas trabajadas + sobretiempo · Perdido = horas ociosas.
- El almuerzo no consume horas productivas (ya está descontado de la jornada).
- Tarifas, jornada y recargos se editan en **Configuración → Horario y recargos**.
