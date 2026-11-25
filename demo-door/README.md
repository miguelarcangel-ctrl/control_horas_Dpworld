# Prototipo Control de Horas · Door Logistic

Demostración de la app de Control de Horas con la marca de Door Logistic, para que la prueben antes de una venta.

- **No usa base de datos:** el "servidor" corre dentro del navegador (`tests/mock_supabase.js`) con datos ficticios (`door/demo-data.js`). No se conecta a Supabase ni toca datos de DP World.
- Cada visitante tiene su propia copia, guardada en su navegador. Al día siguiente se renueva sola, y la franja «Demostración · Reiniciar» la vuelve al inicio.
- Usuarios: `admin`, `supervisor` y `linea`, y los clientes `cliente` (Importadora Istmo) y `atlantico` (Distribuidora Atlántico), todos con contraseña `demo123`.
- **Pedidos de personal:** cada cliente entra con su sesión y pide el personal del día siguiente (tipo, cantidad, horario, lugar). Door (administrador o supervisor) lo confirma total o parcial, o lo rechaza con motivo, en «Pedidos de clientes». El cliente solo ve los pedidos de su empresa. Se enciende con `pedidosClientes` en la configuración; en la app de DP World está apagado.
- **Cliente del día en el marcaje:** al marcar la entrada en la tablet, cada persona elige para qué cliente trabaja ese día (primero salen los clientes con pedido confirmado para hoy). Se ve en la tablet, en el tablero del turno, en Asistencia (con corrección y Excel) y en «Pedidos de clientes», que compara por cliente cuántos marcaron frente a cuántos se confirmaron. Se enciende con `marcajeCliente`; en DP World está apagado. En Supabase necesita la migración `20261122_cliente_marcaje.sql` (no aplicada: hoy solo lo usa el prototipo). En el marcaje de la tablet, la cédula de todo el personal es `1234`.

## Regenerar

```
python3 demo-door/build.py
```

Toma el `index.html` actual de la app, le aplica el logo, los colores y los textos de Door y deja el sitio listo en `demo-door/dist/`. Hay que volver a correrlo cuando cambie la app, para que el prototipo tenga las mejoras nuevas.

## Publicación

Proyecto de Vercel aparte, conectado a este repositorio con directorio raíz `demo-door/dist`. El proyecto de DP World no muestra esta carpeta: `vercel.json` en la raíz la redirige al inicio. (Un `.vercelignore` en la raíz dejaba vacío también al proyecto de Door.)

## Planilla, cobros y proformas
- **Servicios y tarifas** (administrador): costo y venta general por persona por día de cada servicio (ayudante, operador, verificador, supervisor, personal de línea…) y, en cada tipo de línea, cómo se vende la maquila (unidad, caja, paleta o bulto) y cómo se costea (por unidad o por el personal de la línea).
- **Estado de cuenta** (administrador, Clientes y cobros → Estado de cuenta; cliente, «Mi estado de cuenta»): facturas pagadas, con abono, pendientes y vencidas (días vencida), facturado, pagado, saldo y vencido, antigüedad del saldo (al día, 1–30, 31–60, 61–90, más de 90), pagos de cada factura y lo aprobado por facturar. El administrador ve todos los clientes o uno, registra cobros desde ahí y exporta a Excel; ambos imprimen o guardan en PDF. La demostración trae facturas de ejemplo (pagada, con abono, vencida y una por facturar).
- **Costos unificados:** con la facturación encendida, Productividad y costos usa los mismos costos que la planilla y los cobros (costo propio de la persona o el de su servicio). Las tarifas por cargo de Horario y recargos solo aplican a DP World.
- **Tarifarios** (administrador, Clientes y cobros → Tarifarios): consulta de precios. Todos los clientes juntos (venta general y negociada, costo, maquila con su costeo) o uno solo (por día, hora extra, sábado, domingo, margen) y las condiciones (jornada, sobretiempo, recargos, ITBMS, crédito, hora límite de pedidos). Excel e impresión. El **cliente** tiene «Mi tarifario» con solo sus precios de venta y su maquila, para imprimir o guardar en PDF.
- **Planilla** (administrador y supervisor): por día y persona, cédula, servicio, cliente, bodega, dónde trabajó, entrada, almuerzo, salida, horas, extra y **supervisor** (quien marcó como supervisor ese día en esa bodega; si no hubo, se marca). Vistas por persona, por cliente (con margen) y por supervisor. Excel.
- **Cobros y proformas** (administrador): los rubros por cobrar salen solos de los marcajes y las líneas (persona-día, sobretiempo y maquila). Filtro sin facturar / en revisión / facturado. «Generar proforma» por cliente y período.
- **Mis proformas** (cliente): marca con check lo que aprueba y confirma; lo no marcado sigue sin facturar para cobrarse después. Puede generar la proforma del período. Nunca ve costos.
- **Camino de cada proforma:** en revisión del cliente → **aprobada · por facturar** (bandeja del administrador, con número en el menú) → **facturada · por cobrar** (el administrador registra el número de factura fiscal, la fecha y los días de crédito; el cliente lo ve) → **cobrada** (se registran los pagos con fecha, monto, forma y referencia; acepta abonos). Saldo por cobrar y vencido por cliente; el cliente ve lo que tiene por pagar.
- Se enciende con `facturacion`. Todo vive en el navegador del prototipo; en producción, costos, cédulas y el filtro por cliente deben ir en el servidor.

## Turno por cliente
- **Supervisor y administrador:** en el turno, filtro por cliente (chips con las personas presentes) y un resumen por cliente: confirmadas por pedido, presentes, en tarea, libres, en pausa, salieron, horas del día y supervisor. Al asignar tarea con el filtro puesto, se propone ese cliente.
- **Cliente · Mi turno (básica):** su personal del día (o de otro día): llegaron frente a confirmadas, trabajando ahora, horas, entrada, estado y supervisor, y sus líneas de producción con avance.
- **Cliente · Mi turno (avanzada):** además, qué hace cada persona en este momento, tareas con horas-persona, cantidad y productividad frente al estándar, horas en pausas y el costo del día a su tarifa. Es una vista: el turno lo gestiona el supervisor de Door.
- El administrador enciende la versión avanzada en la **ficha del cliente** (Clientes y cobros → Clientes), junto con su tarifa negociada por servicio, sus usuarios y sus maquilas. El cliente sin ella ve qué incluye y puede solicitarla (aviso `cli_avz`).
- En la demostración, `cliente` (Importadora Istmo) tiene la avanzada y `atlantico` (Distribuidora Atlántico) la básica.
