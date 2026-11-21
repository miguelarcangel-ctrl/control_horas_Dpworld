# Prototipo Control de Horas · Door Logistic

Demostración de la app de Control de Horas con la marca de Door Logistic, para que la prueben antes de una venta.

- **No usa base de datos:** el "servidor" corre dentro del navegador (`tests/mock_supabase.js`) con datos ficticios (`door/demo-data.js`). No se conecta a Supabase ni toca datos de DP World.
- Cada visitante tiene su propia copia, guardada en su navegador. Al día siguiente se renueva sola, y la franja «Demostración · Reiniciar» la vuelve al inicio.
- Usuarios: `admin`, `supervisor` y `linea`, todos con contraseña `demo123`. En el marcaje de la tablet, la cédula de todo el personal es `1234`.

## Regenerar

```
python3 demo-door/build.py
```

Toma el `index.html` actual de la app, le aplica el logo, los colores y los textos de Door y deja el sitio listo en `demo-door/dist/`. Hay que volver a correrlo cuando cambie la app, para que el prototipo tenga las mejoras nuevas.

## Publicación

Proyecto de Vercel aparte, conectado a este repositorio con directorio raíz `demo-door/dist`. El proyecto de DP World no muestra esta carpeta: `vercel.json` en la raíz la redirige al inicio. (Un `.vercelignore` en la raíz dejaba vacío también al proyecto de Door.)
