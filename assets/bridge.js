/* Portal Contalfa · puente entre cada herramienta y el portal.
   Si la herramienta se abre sola (fuera del portal) no hace nada y funciona como siempre. */
(function () {
  var P = null;
  try { if (window.parent !== window && window.parent.Portal && window.parent.Portal.user) P = window.parent.Portal; } catch (e) { P = null; }
  if (!P) return;
  var slug = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');

  // Almacenamiento del navegador separado por usuario, para que dos personas en el mismo equipo no se mezclen.
  try {
    var real = window.localStorage;
    var pre = 'pc:' + P.user.id + ':' + slug + ':';
    var keys = function () { var a = []; for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(pre) === 0) a.push(k.slice(pre.length)); } return a; };
    var store = {
      getItem: function (k) { return real.getItem(pre + k); },
      setItem: function (k, v) { real.setItem(pre + k, String(v)); },
      removeItem: function (k) { real.removeItem(pre + k); },
      clear: function () { keys().forEach(function (k) { real.removeItem(pre + k); }); },
      key: function (i) { return keys()[i] || null; },
      get length() { return keys().length; }
    };
    Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
  } catch (e) { /* si el navegador no lo permite, la herramienta usa el almacenamiento normal */ }

  function download(filename, data) {
    var blob = data instanceof Blob ? data : new Blob([data]);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename || 'archivo';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  window.claude = window.claude || {};
  window.claude.use = function (cap) {
    if (cap === 'db' && P.toolHasCloudDb(slug)) return Promise.resolve(P.makeDb(slug));
    if (cap === 'downloads') return Promise.resolve({ save: function (o) { download(o && o.filename, o && o.data); return Promise.resolve(); } });
    return Promise.resolve(null);
  };

  // Aviso al portal cuando cambia el trabajo (lo usan las herramientas con guardado automático)
  window.addEventListener('portal:change', function () { try { P.onToolChange(slug); } catch (e) {} });
})();
