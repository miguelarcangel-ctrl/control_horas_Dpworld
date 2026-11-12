## Línea gráfica
Esta app sigue la línea gráfica común de DP World Panamá, con **Last Mile** como molde: login con la frase de la app, una escena animada propia y la tarjeta blanca; cinta superior blanca; menú desplegable lateral con todas las secciones; sin íconos ni emojis. Antes de tocar el login, la cinta, la navegación o crear pantallas, sigue el skill `.claude/skills/linea-grafica/` (copia del que vive en HubApp: https://github.com/miguelarcangel-ctrl/HubApp/tree/main/.claude/skills/linea-grafica). El kit (`dpw-shell.css`, `dpw-shell.js`, escenas) se cambia en HubApp y se vuelve a copiar aquí; no se edita solo en esta app.

## Publicar cambios
El dueño del repo autoriza de forma permanente, en cualquier sesión: al terminar un cambio, subirlo a una rama, abrir el pull request a `main` y fusionarlo sin pedir confirmación, siempre que las pruebas y el despliegue de vista previa de Vercel estén en verde. Si algo falla, se arregla antes de fusionar; si no se puede, se avisa sin fusionar.

## Principio de uso y avisos
El funcionamiento diario de la app (más allá del control del administrador) depende de los **supervisores** y del **encargado de la línea**. Todo cambio debe mantener que ellos reciban los avisos que sostienen ese uso correcto, y que esos avisos **no se puedan apagar**:
- Supervisores (y administrador): turno sin abrir con personal marcado, personas sin tarea, tareas o pausas largas, cantidades pendientes, fin de jornada / sobretiempo, turno abierto después de la salida, y los de línea.
- Encargado de la línea: personal de línea sin línea en marcha, paros largos, insumos por agotarse, productividad en riesgo, pallets sin registrar y línea abierta más allá de sus horas.
La lista vive en `AVISOS_OBLIG` (index.html) y `OBLIG` (supabase/functions/push-marcaje); deben coincidir. Un aviso nuevo de operación se agrega a ambas.
Horario base: 8:00 a 17:00 (Configuración). Lo marcado antes de la hora de inicio no cuenta.
