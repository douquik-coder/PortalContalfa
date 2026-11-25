# Portal Contalfa

Un solo lugar en internet con las herramientas de trabajo de Contalfa, siempre en su última versión.

- **Web**: HTML estático publicado en Vercel (sin paso de compilación).
- **Usuarios y datos**: Supabase, proyecto "Portal Contalfa" (independiente de Lenix).

## Estructura

| Ruta | Qué es |
| --- | --- |
| `index.html`, `assets/portal.*` | Portal: inicio de sesión, menú y panel de administración |
| `assets/bridge.js` | Puente que se carga al inicio de cada herramienta: separa el almacenamiento por usuario y conecta el guardado en la nube |
| `herramientas/*.html` | Las herramientas, tal como las entrega Douglas, con una línea agregada para cargar `bridge.js` |
| `supabase/functions/admin-users` | Función para crear usuarios, cambiar claves y activar o desactivar analistas |

## Publicar una versión nueva de una herramienta

1. Reemplazar `herramientas/<slug>.html` por la versión nueva.
2. Agregar `<script src="/assets/bridge.js"></script>` justo después de `<head>`.
3. En el Conciliador ATR, conservar los métodos `getState` y `setState` de `window.__ATR` y las llamadas a `emit()`.
4. Subir los cambios a `main`: Vercel publica solo.

Slugs: `atr`, `ventas`, `mayor`, `islr`, `eeff`, `honorarios`, `otherlevel`.

## Guardado en la nube

Todas las herramientas guardan en la nube sin cambiar su código (lo hace `assets/bridge.js` con `assets/nube.js`):
- Lo que guardaban en el navegador (localStorage) va a la tabla `tool_kv`, por usuario y herramienta. El portal lo precarga antes de abrir la herramienta.
- La "carpeta de datos" (Precierre ISLR, Other Level) es la carpeta del usuario en el bucket privado `trabajo`.
- El histórico del Revisor de Mayor se guarda como registros en ese mismo bucket.
Si no hay conexión, queda una copia en el equipo y se sube al volver.
