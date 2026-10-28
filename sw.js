// Service worker de Control de Horas: permite instalar la app, abrirla sin conexión y mostrar avisos.
// La app se pide primero a la red (siempre la versión publicada); la copia guardada solo se usa sin conexión.
// Supabase nunca se guarda en caché: los datos van siempre al servidor (sin conexión, la app usa su respaldo local).
const CACHE = 'ch-v5';
const BASE = ['./', './index.html', './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png',
  './assets/dpworld-logo-fondo-claro.png', './assets/dpworld-logo-fondo-oscuro.png',
  './dpw/dpw-shell.css', './dpw/dpw-shell.js', './dpw/dpw-escenas.js', './dpw/assets/dpworld-logo-fondo-claro.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || /supabase\.co$/.test(url.hostname)) return;
  const propio = url.origin === self.location.origin;
  if (propio) {
    // Red primero; si falla, la copia guardada
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || caches.match('./index.html'))));
  } else if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|cdn\.sheetjs\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    // Librerías y fuentes: copia guardada y se actualiza en segundo plano
    e.respondWith(caches.open(CACHE).then(k => k.match(req).then(hit => {
      const red = fetch(req).then(r => { if (r.ok || r.type === 'opaque') k.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || red;
    })));
  }
});
// Al tocar un aviso, enfoca la app (o la abre)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => 'focus' in x); return c ? c.focus() : self.clients.openWindow('./index.html');
  }));
});
