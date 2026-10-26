# Control de Horas — DP World Panamá

App de una sola página (`index.html`) para turnos, tareas, costos y productividad de la bodega.

## Acceso y datos
- **Login** contra Supabase con contraseñas cifradas (tabla `ch_usuarios`). Sesión de 30 días por equipo.
- La base solo responde a funciones `ch_*` (ver `supabase/migrations`). La llave pública ya no da acceso a la tabla.
- **Guardado con versión**: si dos personas guardan a la vez, la app integra ambos cambios en vez de sobrescribir.
- **Sin conexión**: guarda en el equipo y sincroniza al volver.

## Pantallas
- `index.html` — app (supervisor / admin).
- `index.html?tv=1` o `dashboard.html` — Dashboard TV de solo lectura, sin login.
- Agrega `?datos=prueba` a cualquier URL para trabajar sobre una copia de ensayo (sale el aviso **MODO PRUEBA**).

## Cálculo de costos (motor único `calcTurno`)
- Se cuentan **horas-persona**: 2 personas × 1 h = 2 h.
- Tarifa/hora = tarifa diaria × factor de carga ÷ horas productivas de la jornada; sábado y domingo aplican su recargo.
- Pagado = base del turno + sobretiempo · Productivo = horas trabajadas + sobretiempo · Perdido = horas ociosas.
- El almuerzo no consume horas productivas (ya está descontado de la jornada).
- Tarifas, jornada y recargos se editan en **Insights → Configuración**.
