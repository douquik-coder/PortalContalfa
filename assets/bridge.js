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

  // Asistente de carga: antes de que la herramienta lea un archivo, el portal lo revisa y, si hace falta, lo ordena.
  // La herramienta recibe el archivo como si el analista lo hubiera elegido directamente.
  if (P.assist && P.assistSlots) {
    var slots = P.assistSlots(slug);
    var findSlot = function (el, kind) {
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        if (kind === 'change' && el.matches && el.matches(s.selector)) return s;
        if (kind === 'drop' && s.drop && el.closest && el.closest(s.drop)) return s;
      }
      return null;
    };
    var rebuild = function (files) {
      var dt = new DataTransfer();
      files.forEach(function (f) { dt.items.add(new File([f], f.name, { type: f.type, lastModified: f.lastModified || Date.now() })); });
      return dt;
    };
    var run = function (slot, files, deliver) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      Promise.resolve(P.assist(slug, slot.id, list)).then(function (out) {
        if (out && out.length) deliver(rebuild(out));
      }, function (err) { console.error('Asistente de carga:', err); deliver(rebuild(list)); });
    };
    window.addEventListener('change', function (e) {
      var el = e.target;
      if (e.__pcPass || !el || el.type !== 'file') return;
      var slot = findSlot(el, 'change'); if (!slot || !el.files || !el.files.length) return;
      e.stopImmediatePropagation();
      var files = el.files;
      run(slot, files, function (dt) {
        try { el.files = dt.files; } catch (x) {}
        var ev = new Event('change', { bubbles: true }); ev.__pcPass = true; el.dispatchEvent(ev);
      });
      try { el.value = ''; } catch (x) {}
    }, true);
    window.addEventListener('drop', function (e) {
      if (e.__pcPass) return;
      var slot = findSlot(e.target, 'drop'); if (!slot || !e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault(); e.stopImmediatePropagation();
      var target = e.target;
      try { var z = target.closest(slot.drop); z.classList.remove('over', 'drag', 'hover', 'dragover', 'is-over', 'active'); } catch (x) {}
      run(slot, e.dataTransfer.files, function (dt) {
        var ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }); ev.__pcPass = true; target.dispatchEvent(ev);
      });
    }, true);
  }

  // Aviso al portal cuando cambia el trabajo (lo usan las herramientas con guardado automático)
  window.addEventListener('portal:change', function () { try { P.onToolChange(slug); } catch (e) {} });
})();
