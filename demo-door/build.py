#!/usr/bin/env python3
"""Genera el prototipo de Control de Horas para Door Logistic en demo-door/dist/.

Parte de la app real (index.html, kit dpw/ y el servidor simulado de las pruebas) y le aplica:
- la marca de Door Logistic (logo, colores del logo sobre la base blanca de la línea gráfica, textos);
- el servidor simulado en el navegador (tests/mock_supabase.js) con datos ficticios (door/demo-data.js),
  de modo que no se conecta a ninguna base de datos ni toca datos reales.

Uso:  python3 demo-door/build.py      (volver a correrlo cada vez que cambie la app)
"""
import json, re, shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DEMO = RAIZ / 'demo-door'
DIST = DEMO / 'dist'

# Paleta tomada del logo: degradado azul claro → índigo, barra roja y globo azul marino
COLORES = {
    '1A1060': '1B3F95', '2A1F8F': '2453B8', '3E3C90': '2F5FC4', '120B45': '14306F', '2D2B6B': '1B3170',
    '0d0b28': '0A1022', '16143d': '101A33', '1e1c50': '16223F', '252368': '1D2C52', '13113e': '0F1830',
    '0f0c38': '0C142B', '1c1a4d': '15213D', 'a9a7ff': '7CC4FF', '4a48a8': '3A6FD6', '8a88e0': '6FA8E8',
    'ECEBFA': 'E8F1FB', '1a1760': '1B3F95', '2a2770': '1F3F8A', '1a1830': '0F1830', '8b8fad': '8A97AD',
    # acento verde de DP World → azul claro del logo de Door; morado → azul medio; rojo → rojo de la barra del logo
    '2D1B8E': '1E4FA8', '00C389': '0596DC', '00a372': '0484C4', '00A878': '0377BE', '008f66': '03679F', '00996b': '0377BE',
    '7C5CBF': '1D6FD1', '8f6fd6': '4C8FE0', 'c4b5fd': 'A9D3FF', '6D4FB8': '1F5FB0', 'E8003D': 'E30613', 'ff6680': 'FF5A66',
}
RGB = {'26,16,96': '27,63,149', '62,60,144': '47,95,196', '26, 16, 96': '27, 63, 149', '0,195,137': '5,150,220', '0,168,120': '3,119,190',
       '143,111,214': '76,143,224', '169,167,255': '124,196,255', '232,0,61': '227,6,19', '13,11,40': '10,16,34', '8,6,30': '6,10,24', '15,12,56': '12,20,43'}


def recolor(txt):
    for a, b in COLORES.items():
        txt = re.sub('#' + a + r'(?![0-9A-Fa-f])', '#' + b, txt, flags=re.I)
    for a, b in RGB.items():
        txt = txt.replace(a, b)
    return txt


def cambiar(txt, viejo, nuevo, minimo=1):
    n = txt.count(viejo)
    if n < minimo:
        raise SystemExit(f'No encontré en index.html: {viejo[:70]!r}')
    return txt.replace(viejo, nuevo)


CSS_DOOR = """
<style id="door-marca">
/* ═══ Door Logistic · prototipo ═══ base blanca de la línea gráfica con los colores del logo */
:root,[data-theme="dark"]{--accent:#7CC4FF;--blue:#3BA7EE;--red:#FF2A3D;--rg:rgba(255,42,61,.4);--on-green:#fff}
[data-theme="light"]{--accent:#0587D3;--blue:#0587D3;--red:#E30613;--rg:rgba(227,6,19,.2);--red-t:#C10512;--bg:#F3F6FB}
:root{--dpw-red:#E30613;--dpw-blue:#0587D3}
.dpw-logo img{height:40px}
.dpw-lg-logo img{height:112px;margin-bottom:8px}
.ki-logo{height:56px}
.tv-hdr-logo img{background:#fff;border-radius:8px;padding:3px 5px}
.dpw-hdr{border-bottom:3px solid #E30613}
.door-cred{margin:10px 0 2px;padding:9px 11px;border-radius:10px;background:rgba(5,135,211,.08);border:1px dashed rgba(5,135,211,.45);font-size:.78rem;color:#334155;line-height:1.45}
.door-cred b{font-family:'Barlow Condensed',sans-serif;letter-spacing:.4px;color:#1B3F95}
.door-cred code{font-family:inherit;font-weight:700;color:#0F172A}
.door-demo-tag{position:fixed;left:10px;bottom:10px;z-index:9000;display:flex;align-items:center;gap:8px;padding:5px 6px 5px 11px;border-radius:999px;
  background:#1B3F95;color:#fff;font:700 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.6px;text-transform:uppercase;box-shadow:0 4px 14px rgba(15,23,42,.25)}
.door-demo-tag button{border:0;border-radius:999px;background:#E30613;color:#fff;font:inherit;padding:5px 9px;cursor:pointer}
body.en-kiosco .door-demo-tag{display:none}
@media(max-width:600px){.door-demo-tag{left:6px;bottom:6px;font-size:9.5px;padding:4px 4px 4px 8px}.door-demo-tag button{padding:4px 7px}}
@media print{.door-demo-tag{display:none}}
</style>
"""

CREDENCIALES = """    <div class="door-cred"><b>USUARIOS DE PRUEBA</b> · contraseña <code>demo123</code><br>
      <code>admin</code> administrador · <code>supervisor</code> supervisor · <code>linea</code> encargada de línea<br>
      <code>cliente</code> o <code>atlantico</code> cliente que pide personal para el día siguiente<br>
      Marcaje en tablet: la cédula de todo el personal es <code>1234</code></div>
"""


def construir():
    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / 'dpw').mkdir(parents=True)
    (DIST / 'assets').mkdir()
    shutil.copytree(DEMO / 'door', DIST / 'door')
    shutil.copy(RAIZ / 'tests' / 'mock_supabase.js', DIST / 'door' / 'mock_supabase.js')

    # Kit de la línea gráfica con la paleta de Door
    for f in ('dpw-shell.css', 'dpw-shell.js', 'dpw-escenas.js'):
        (DIST / 'dpw' / f).write_text(recolor((RAIZ / 'dpw' / f).read_text(encoding='utf-8')), encoding='utf-8')
    # Íconos de la app instalada y logos (por si algún rincón de la app pide los nombres originales)
    for f in ('icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'):
        shutil.copy(DEMO / 'door' / f, DIST / 'assets' / f)
    (DIST / 'dpw' / 'assets').mkdir()
    for d in (DIST / 'assets', DIST / 'dpw' / 'assets'):
        for f in ('dpworld-logo-fondo-claro.png', 'dpworld-logo-fondo-oscuro.png'):
            shutil.copy(DEMO / 'door' / 'door-logo-sm.png', d / f)

    h = (RAIZ / 'index.html').read_text(encoding='utf-8')
    # Servidor simulado y datos de demostración en lugar de Supabase
    h = cambiar(h, '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
                '<script src="door/mock_supabase.js"></script>\n<script src="door/demo-data.js"></script>')
    h = re.sub(r"const STATE_KEY=[^\n]*", "const STATE_KEY='ctrl_horas';", h, count=1)
    if "const STATE_KEY='ctrl_horas';" not in h:
        raise SystemExit('No pude fijar STATE_KEY')
    # Marca
    h = cambiar(h, '<title>Control de Horas — DP World</title>', '<title>Control de Horas — Door Logistic</title>')
    h = cambiar(h, 'DP World · Control de Horas', 'Door Logistic · Control de Horas')
    h = cambiar(h, '<img src="dpw/assets/dpworld-logo-fondo-claro.png" alt="DP World">\n      <div class="dpw-lg-app">',
                '<img src="door/door-logo.png" alt="Door Logistic">\n      <div class="dpw-lg-app">')
    h = cambiar(h, 'DAL · Colón Logistics Park · Panamá', 'Prototipo de demostración')
    h = cambiar(h, '<div class="dpw-lg-foot">Uso interno exclusivo · DP World Panamá</div>',
                CREDENCIALES + '    <div class="dpw-lg-foot">Demostración para Door Logistic · datos ficticios</div>')
    h = cambiar(h, 'dpw/assets/dpworld-logo-fondo-claro.png', 'door/door-logo-sm.png')
    h = cambiar(h, 'assets/dpworld-logo-fondo-claro.png', 'door/door-logo-sm.png')
    h = h.replace('alt="DP World"', 'alt="Door Logistic"')
    h = cambiar(h, '<div class="dpw-title">DP WORLD</div>', '<div class="dpw-title">DOOR LOGISTIC</div>')
    h = cambiar(h, 'DAL · Colón Logistics Park', 'Door Logistic')
    h = h.replace('Bodega DP World · Tiempo real', 'Door Logistic · Tiempo real')
    h = h.replace('DP World', 'Door Logistic').replace('DP WORLD', 'DOOR LOGISTIC')
    h = re.sub(r'DAL\s*·?\s*Col[oó]n( Logistics Park)?', 'Door Logistic', h)
    h = recolor(h)
    h = cambiar(h, '</head>', CSS_DOOR + '</head>')
    (DIST / 'index.html').write_text(h, encoding='utf-8')

    # PWA propia (otro nombre y otra caché: no se mezcla con la app de DP World)
    man = json.loads((RAIZ / 'manifest.webmanifest').read_text(encoding='utf-8'))
    man.update({'name': 'Control de Horas — Door Logistic', 'short_name': 'Door Horas',
                'description': 'Prototipo de Control de Horas para Door Logistic · datos ficticios',
                'theme_color': '#1B3F95', 'background_color': '#FFFFFF'})
    (DIST / 'manifest.webmanifest').write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding='utf-8')
    sw = (RAIZ / 'sw.js').read_text(encoding='utf-8')
    sw = re.sub(r"const CACHE = '[^']+';", "const CACHE = 'door-demo-1';", sw)
    sw = re.sub(r"const BASE = \[.*?\];", "const BASE = ['./', './index.html', './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png',\n"
                "  './door/door-logo.png', './door/door-logo-sm.png', './door/mock_supabase.js', './door/demo-data.js',\n"
                "  './dpw/dpw-shell.css', './dpw/dpw-shell.js', './dpw/dpw-escenas.js'];", sw, flags=re.S)
    sw = sw.replace('Control de Horas', 'Door · Control de Horas')
    (DIST / 'sw.js').write_text(sw, encoding='utf-8')
    (DIST / 'robots.txt').write_text('User-agent: *\nDisallow: /\n', encoding='utf-8')

    restos = [m.group(0) for m in re.finditer(r'.{0,40}(DP World|dpworld|DAL Col).{0,40}', (DIST / 'index.html').read_text(encoding='utf-8'))]
    print('Listo:', DIST)
    if restos:
        print('Menciones que quedan (revisar):', *restos[:10], sep='\n  ')


if __name__ == '__main__':
    construir()
