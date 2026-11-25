/* Portal Contalfa · puente entre cada herramienta y el portal.
   Si la herramienta se abre sola (fuera del portal) no hace nada y funciona como siempre. */
(function () {
  var P = null;
  try { if (window.parent !== window && window.parent.Portal && window.parent.Portal.user) P = window.parent.Portal; } catch (e) { P = null; }
  if (!P) return;
  var slug = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');

  var C = P.cloud;

  // Lo que la herramienta guarda "en el navegador" va a la nube del usuario (precargado por el portal antes de abrirla).
  // Si la nube no estuviera disponible, se usa una copia separada por usuario en este equipo.
  try {
    var store;
    if (C) {
      store = {
        getItem: function (k) { return C.lsGet(slug, String(k)); },
        setItem: function (k, v) { C.lsSet(slug, String(k), v); },
        removeItem: function (k) { C.lsRemove(slug, String(k)); },
        clear: function () { C.lsKeys(slug).forEach(function (k) { C.lsRemove(slug, k); }); },
        key: function (i) { return C.lsKeys(slug)[i] || null; },
        get length() { return C.lsKeys(slug).length; }
      };
    } else {
      var real = window.localStorage;
      var pre = 'pc:' + P.user.id + ':' + slug + ':';
      var keys = function () { var a = []; for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(pre) === 0) a.push(k.slice(pre.length)); } return a; };
      store = {
        getItem: function (k) { return real.getItem(pre + k); },
        setItem: function (k, v) { real.setItem(pre + k, String(v)); },
        removeItem: function (k) { real.removeItem(pre + k); },
        clear: function () { keys().forEach(function (k) { real.removeItem(pre + k); }); },
        key: function (i) { return keys()[i] || null; },
        get length() { return keys().length; }
      };
    }
    var proxy = new Proxy(store, {
      get: function (t, k) { if (k in t) return typeof t[k] === 'function' ? t[k].bind(t) : t[k]; return typeof k === 'string' ? t.getItem(k) : undefined; },
      set: function (t, k, v) { t.setItem(k, v); return true; },
      deleteProperty: function (t, k) { t.removeItem(k); return true; },
      has: function (t, k) { return k in t || t.getItem(k) !== null; }
    });
    Object.defineProperty(window, 'localStorage', { value: proxy, configurable: true });
  } catch (e) { /* si el navegador no lo permite, la herramienta usa el almacenamiento normal */ }

  if (C) {
    // "Carpeta de datos": en el portal es la carpeta del usuario en la nube (sin diálogos de permisos).
    var root = function () { return C.rootDir(slug, window); };
    window.showDirectoryPicker = function () { return Promise.resolve(root()); };
    // Las herramientas recuerdan la carpeta elegida en IndexedDB; ahí se guarda una marca y al leerla se entrega la carpeta de la nube.
    // Si en este equipo nunca se eligió, se entrega igual, para que el trabajo aparezca solo en cualquier computador.
    var FOLDER_DBS = { 'precierre-islr': 1, 'otherlevel_reporte': 1 };
    try {
      var OS = window.IDBObjectStore.prototype, RQ = window.IDBRequest.prototype;
      var origPut = OS.put, origGet = OS.get;
      OS.put = function (v, k) { if (v && v.__cloud) v = { __cloudDir: true }; return origPut.call(this, v, k); };
      OS.get = function (k) { var r = origGet.call(this, k); try { r.__pcKey = k; r.__pcDb = this.transaction.db.name; } catch (e) {} return r; };
      var desc = Object.getOwnPropertyDescriptor(RQ, 'result');
      Object.defineProperty(RQ, 'result', {
        configurable: true, enumerable: desc.enumerable,
        get: function () {
          var v = desc.get.call(this);
          if (v && v.__cloudDir) return root();
          if (v === undefined && this.__pcKey === 'dir' && FOLDER_DBS[this.__pcDb]) return root();
          return v;
        }
      });
    } catch (e) { console.warn('Portal: no se pudo conectar la carpeta en la nube', e); }

    // Revisor de Mayor: su base de datos local se reemplaza por registros en la nube.
    if (slug === 'mayor') {
      var R = C.records(slug);
      var b64 = function (u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
      var unb64 = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
      var enc = function (obj) {
        return JSON.stringify(obj, function (k, v) {
          var o = this[k], t = Object.prototype.toString.call(o);
          if (t === '[object Date]') return { __d: o.toISOString() };
          if (ArrayBuffer.isView(o)) return { __u8: b64(new Uint8Array(o.buffer, o.byteOffset, o.byteLength)) };
          if (t === '[object ArrayBuffer]') return { __ab: b64(new Uint8Array(o)) };
          if (t === '[object Map]') return { __map: Array.from(o.entries()) };
          return v;
        });
      };
      var dec = function (txt) {
        if (txt == null) return undefined;
        return JSON.parse(txt, function (k, v) {
          if (v && typeof v === 'object') {
            if ('__u8' in v) return unb64(v.__u8);
            if ('__ab' in v) return unb64(v.__ab).buffer;
            if ('__d' in v) return new Date(v.__d);
            if ('__map' in v) return new Map(v.__map);
          }
          return v;
        });
      };
      var wrap = function (api) {
        if (!api || api.__cloud) return api;
        var w = Object.assign({}, api, {
          __cloud: true,
          open: function () { return Promise.resolve(true); },
          isMemory: function () { return false; },
          all: function (st) { return R.all(st).then(function (a) { return a.map(dec); }); },
          get: function (st, id) { return R.get(st, id).then(dec); },
          put: function (st, obj) { return R.put(st, obj.id, enc(obj)).then(function () { return obj.id; }); },
          del: function (st, id) { return R.del(st, id); }
        });
        return w;
      };
      var cur = wrap(window.Store);
      Object.defineProperty(window, 'Store', { configurable: true, get: function () { return cur; }, set: function (v) { cur = wrap(v); } });
    }
  }

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

  // Todo en español: los mensajes técnicos en inglés que muestre la herramienta se traducen al vuelo.
  var es = null; try { es = window.parent.enEspanol || null; } catch (e) {}
  if (es) {
    ['alert', 'confirm', 'prompt'].forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig === 'function') window[fn] = function (m) { var a = Array.prototype.slice.call(arguments); a[0] = es(m); return orig.apply(window, a); };
    });
    var fix = function (node) {
      if (node.nodeType === 3) { var t = node.nodeValue; if (t && es.huele(t)) { var n = es(t); if (n !== t) node.nodeValue = n; } return; }
      if (node.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(node.nodeName)) return;
      var w = document.createTreeWalker(node, 4), x; while ((x = w.nextNode())) fix(x);
      if (node.title && es.huele(node.title)) node.title = es(node.title);
    };
    var start = function () {
      fix(document.body);
      new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.type === 'characterData') fix(m.target); else m.addedNodes.forEach(fix); }); })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    // Un fallo inesperado de la herramienta se avisa en español en vez de quedar oculto en la consola
    var last = 0;
    var avisar = function (m) { var now = Date.now(); if (now - last < 4000) return; last = now; try { P.toast('La herramienta tuvo un problema: ' + es(m) + '. Si se repite, avísale a Douglas con una captura.'); } catch (e) {} };
    window.addEventListener('error', function (e) { if (e && e.message && !/ResizeObserver|Script error/i.test(e.message)) avisar(e.message); });
    window.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; if (r && (r.message || typeof r === 'string')) avisar(r.message || r); });
  }

  // Aviso al portal cuando cambia el trabajo (lo usan las herramientas con guardado automático)
  window.addEventListener('portal:change', function () { try { P.onToolChange(slug); } catch (e) {} });
})();
