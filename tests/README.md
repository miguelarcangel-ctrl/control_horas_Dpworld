# Pruebas

Simulan el servidor (funciones `ch_*`) en memoria; no tocan Supabase.

```bash
python3 -m http.server 8765        # desde la raíz del repo
node tests/run_tests.js            # requiere: npm i playwright
```
