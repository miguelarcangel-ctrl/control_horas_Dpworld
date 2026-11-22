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
