/* Portal Contalfa · Guardado en la nube para todas las herramientas.
   - Lo que cada herramienta guardaba en el navegador (localStorage) se guarda en la tabla tool_kv.
   - Las "carpetas de datos" (Precierre ISLR, Other Level) y el histórico del Revisor de Mayor se guardan
     en el bucket privado "trabajo", en una carpeta por usuario y herramienta.
   Así cada analista encuentra su trabajo en cualquier equipo. Los permisos los controla Supabase (RLS). */
(function () {
  'use strict';
  const Portal = window.Portal;
  if (!Portal) return;
  const sb = Portal.sb;
  const C = window.PORTAL_CONFIG;
  const BUCKET = 'trabajo';
  const BIG = 4000; // a partir de este tamaño los valores se guardan comprimidos

  // ---------- compresión ----------
  async function gz(text) {
    const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = new Uint8Array(await new Response(s).arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return 'gz:' + btoa(bin);
  }
  async function ungz(v) {
    if (typeof v !== 'string' || !v.startsWith('gz:')) return v;
    const bin = atob(v.slice(3)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const s = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(s).text();
  }

  // ---------- estado visible ----------
  let statusFn = () => {};
  const enEspanol = window.enEspanol || ((x) => (x && x.message) || String(x));
  const status = (t, bad) => { try { statusFn(t, bad); if (Portal.cloudStatus) Portal.cloudStatus(t, bad); } catch (e) {} };

  // =====================================================================
  // 1) Almacenamiento tipo localStorage, precargado antes de abrir la herramienta
  // =====================================================================
  const LS = {}; // slug -> Map(key -> value)
  const pending = {}; // slug -> Set(keys) por subir
  const timers = {};
  const uid = () => Portal.user.id;
  const localKey = (slug, k) => 'pc:' + uid() + ':' + slug + ':' + k;
  const pendKey = (slug) => 'pc:pend:' + uid() + ':' + slug;
  const real = window.localStorage;
  const readPend = (slug) => { try { return new Set(JSON.parse(real.getItem(pendKey(slug)) || '[]')); } catch (e) { return new Set(); } };
  const writePend = (slug) => { try { const s = pending[slug]; if (s && s.size) real.setItem(pendKey(slug), JSON.stringify([...s])); else real.removeItem(pendKey(slug)); } catch (e) {} };

  async function preload(slug) {
    const map = new Map();
    let rows = null;
    try {
      const { data, error } = await sb.from('tool_kv').select('key,value').eq('tool_slug', slug);
      if (error) throw error;
      rows = data || [];
      for (const r of rows) map.set(r.key, await ungz(r.value));
    } catch (e) {
      console.warn('Nube: no se pudo leer, se usa la copia de este equipo', e);
      status('⚠ Sin conexión con la nube: se usa la copia de este equipo', true);
    }
    const pre = 'pc:' + uid() + ':' + slug + ':';
    const localKeys = []; try { for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k && k.startsWith(pre)) localKeys.push(k.slice(pre.length)); } } catch (e) {}
    pending[slug] = readPend(slug);
    if (rows === null) {
      // sin nube: todo sale de la copia local
      for (const k of localKeys) map.set(k, real.getItem(pre + k));
    } else {
      // cambios que no alcanzaron a subir la última vez: gana la copia local
      for (const k of pending[slug]) { const v = real.getItem(pre + k); if (v === null) map.delete(k); else map.set(k, v); }
      // primera vez en la nube: se sube lo que esta persona ya tenía en este equipo
      if (!rows.length) for (const k of localKeys) if (!map.has(k)) { map.set(k, real.getItem(pre + k)); pending[slug].add(k); }
    }
    LS[slug] = map;
    if (pending[slug].size) schedule(slug, 50);
    return map;
  }

  function schedule(slug, ms) { clearTimeout(timers[slug]); timers[slug] = setTimeout(() => flush(slug), ms == null ? 900 : ms); }
  async function flush(slug) {
    clearTimeout(timers[slug]);
    const keys = [...(pending[slug] || [])]; if (!keys.length) return;
    const map = LS[slug] || new Map();
    status('☁ Guardando…');
    try {
      const up = [], del = [];
      for (const k of keys) { if (map.has(k)) { const v = map.get(k); up.push({ user_id: uid(), tool_slug: slug, key: k, value: v.length > BIG ? await gz(v) : v, updated_at: new Date().toISOString() }); } else del.push(k); }
      if (up.length) { const { error } = await sb.from('tool_kv').upsert(up, { onConflict: 'user_id,tool_slug,key' }); if (error) throw error; }
      if (del.length) { const { error } = await sb.from('tool_kv').delete().eq('tool_slug', slug).in('key', del); if (error) throw error; }
      keys.forEach((k) => pending[slug].delete(k)); writePend(slug);
      status('☁ Guardado en la nube');
    } catch (e) {
      console.warn('Nube: no se pudo guardar', e);
      status('⚠ No se pudo guardar en la nube; queda en este equipo y se reintenta', true);
      schedule(slug, 15000);
    }
  }
  function lsSet(slug, k, v) {
    v = String(v); const map = LS[slug] || (LS[slug] = new Map());
    if (map.get(k) === v) return;
    map.set(k, v);
    try { real.setItem(localKey(slug, k), v); } catch (e) { /* copia local llena: la nube igual la guarda */ }
    (pending[slug] || (pending[slug] = new Set())).add(k); writePend(slug); schedule(slug);
  }
  function lsRemove(slug, k) {
    const map = LS[slug]; if (!map || !map.has(k)) return;
    map.delete(k); try { real.removeItem(localKey(slug, k)); } catch (e) {}
    (pending[slug] || (pending[slug] = new Set())).add(k); writePend(slug); schedule(slug);
  }
  // Al cerrar la pestaña: envío rápido de lo pendiente que sea pequeño (lo grande se reintenta al volver)
  function beacon() {
    let token = null;
    try { const s = JSON.parse(real.getItem('portal-contalfa-auth') || 'null'); token = s && (s.access_token || (s.currentSession && s.currentSession.access_token)); } catch (e) {}
    if (!token) return;
    for (const slug in pending) {
      const map = LS[slug]; if (!map) continue;
      const up = [...pending[slug]].filter((k) => map.has(k) && map.get(k).length < 50000).map((k) => ({ user_id: uid(), tool_slug: slug, key: k, value: map.get(k), updated_at: new Date().toISOString() }));
      if (!up.length) continue;
      try { fetch(C.supabaseUrl + '/rest/v1/tool_kv?on_conflict=user_id,tool_slug,key', { method: 'POST', keepalive: true, headers: { apikey: C.supabaseKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(up) }); } catch (e) {}
    }
  }
  window.addEventListener('pagehide', () => { if (Portal.user) beacon(); });

  // =====================================================================
  // 2) Archivos en la nube (bucket "trabajo") con la forma de una carpeta del computador
  // =====================================================================
  // Supabase no acepta ciertos caracteres en las rutas (acentos, ñ, ~…): se codifican de forma reversible con !hex
  const encSeg = (s) => Array.from(new TextEncoder().encode(String(s))).map((b) => (/[A-Za-z0-9._\- ()]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : '!' + b.toString(16).padStart(2, '0'))).join('');
  const decSeg = (s) => { const out = []; for (let i = 0; i < s.length; i++) { if (s[i] === '!') { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else out.push(s.charCodeAt(i)); } return new TextDecoder().decode(new Uint8Array(out)); };
  const base = (slug) => uid() + '/' + slug;
  const joinP = (dir, name) => (dir ? dir + '/' : '') + encSeg(name);
  const notFound = (n) => new DOMException('No existe: ' + n, 'NotFoundError');

  const listCache = new Map(); // prefijo -> Promise(lista)
  function list(prefix) {
    if (!listCache.has(prefix)) {
      const p = (async () => {
        const out = []; let offset = 0;
        for (;;) {
          const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
          if (error) throw error;
          out.push(...(data || []).filter((x) => x.name !== '.emptyFolderPlaceholder'));
          if (!data || data.length < 1000) break; offset += 1000;
        }
        return out;
      })();
      listCache.set(prefix, p); p.catch(() => listCache.delete(prefix));
    }
    return listCache.get(prefix);
  }
  const invalidate = (path) => { const parts = path.split('/'); for (let i = 1; i <= parts.length; i++) listCache.delete(parts.slice(0, i).join('/')); };

  function makeDir(slug, rel, name, win) {
    const full = () => base(slug) + (rel ? '/' + rel : '');
    const h = {
      kind: 'directory', name, __cloud: true, __rel: rel,
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async isSameEntry(o) { return !!(o && o.__cloud && o.__rel === rel && o.kind === 'directory'); },
      async getDirectoryHandle(n, opt) {
        const r = joinP(rel, n);
        if (!(opt && opt.create)) { const l = await list(full()); if (!l.some((x) => x.id === null && x.name === encSeg(n))) throw notFound(n); }
        return makeDir(slug, r, n, win);
      },
      async getFileHandle(n, opt) {
        const r = joinP(rel, n);
        const l = await list(full());
        const exists = l.some((x) => x.id !== null && x.name === encSeg(n));
        if (!exists && !(opt && opt.create)) throw notFound(n);
        return makeFile(slug, r, n, win, exists);
      },
      async removeEntry(n, opt) {
        const l = await list(full()); const e = l.find((x) => x.name === encSeg(n)); if (!e) throw notFound(n);
        const p = full() + '/' + encSeg(n);
        let paths = [p];
        if (e.id === null) { if (!(opt && opt.recursive)) throw new DOMException('La carpeta no está vacía', 'InvalidModificationError'); paths = await walk(p); }
        for (let i = 0; i < paths.length; i += 100) { const { error } = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100)); if (error) throw error; }
        invalidate(p);
      },
      async *entries() { for (const x of await list(full())) { const n = decSeg(x.name); yield [n, x.id === null ? makeDir(slug, joinP(rel, n), n, win) : makeFile(slug, joinP(rel, n), n, win, true, x)]; } },
      async *keys() { for await (const [n] of h.entries()) yield n; },
      async *values() { for await (const [, v] of h.entries()) yield v; },
      [Symbol.asyncIterator]() { return h.entries(); }
    };
    return h;
  }
  async function walk(prefix) { const out = []; for (const x of await list(prefix)) { const p = prefix + '/' + x.name; if (x.id === null) out.push(...await walk(p)); else out.push(p); } return out; }

  function makeFile(slug, rel, name, win, exists, meta) {
    const path = () => base(slug) + '/' + rel;
    const W = win || window;
    return {
      kind: 'file', name, __cloud: true, __rel: rel,
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async isSameEntry(o) { return !!(o && o.__cloud && o.__rel === rel && o.kind === 'file'); },
      async getFile() {
        const { data, error } = await sb.storage.from(BUCKET).download(path());
        if (error) { if (!exists) return new W.File([], name); throw notFound(name); }
        const buf = await data.arrayBuffer();
        const lm = meta && meta.updated_at ? Date.parse(meta.updated_at) : Date.now();
        return new W.File([buf], name, { type: data.type || '', lastModified: lm });
      },
      async createWritable(opt) {
        const parts = [];
        if (opt && opt.keepExistingData && exists) { try { parts.push(await (await this.getFile()).arrayBuffer()); } catch (e) {} }
        const push = (d) => {
          if (d && typeof d === 'object' && d.type === 'write') d = d.data;
          if (d == null) return;
          if (typeof d === 'string') parts.push(d);
          else if (ArrayBuffer.isView(d)) parts.push(new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice());
          else parts.push(d); // Blob o ArrayBuffer
        };
        return {
          async write(d) { push(d); },
          async truncate(n) { if (n === 0) parts.length = 0; },
          async seek() {},
          async abort() { parts.length = 0; },
          async close() {
            const blob = new Blob(parts, { type: /\.json$/i.test(name) ? 'application/json' : 'application/octet-stream' });
            status('☁ Guardando…');
            const { error } = await sb.storage.from(BUCKET).upload(path(), blob, { upsert: true, contentType: blob.type });
            if (error) { status('⚠ No se pudo guardar en la nube: ' + enEspanol(error), true); throw error; }
            exists = true; invalidate(path()); status('☁ Guardado en la nube');
          }
        };
      }
    };
  }
  const rootDir = (slug, win) => makeDir(slug, '', 'Nube Contalfa', win);

  // =====================================================================
  // 3) Registros tipo base de datos (Revisor de Mayor): un archivo JSON por registro
  // =====================================================================
  function records(slug) {
    const dirP = (store) => base(slug) + '/__registros/' + encSeg(store);
    return {
      async all(store) {
        let l; try { l = await list(dirP(store)); } catch (e) { return []; }
        const files = l.filter((x) => x.id !== null);
        const out = await Promise.all(files.map(async (x) => { const { data } = await sb.storage.from(BUCKET).download(dirP(store) + '/' + x.name); return data ? await data.text() : null; }));
        return out.filter(Boolean);
      },
      async get(store, id) { const { data, error } = await sb.storage.from(BUCKET).download(dirP(store) + '/' + encSeg(id) + '.json'); return error || !data ? null : await data.text(); },
      async put(store, id, text) {
        status('☁ Guardando…');
        const p = dirP(store) + '/' + encSeg(id) + '.json';
        const { error } = await sb.storage.from(BUCKET).upload(p, new Blob([text], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
        if (error) { status('⚠ No se pudo guardar en la nube: ' + enEspanol(error), true); throw error; }
        invalidate(p); status('☁ Guardado en la nube');
      },
      async del(store, id) { const p = dirP(store) + '/' + encSeg(id) + '.json'; await sb.storage.from(BUCKET).remove([p]); invalidate(p); }
    };
  }

  Portal.cloud = {
    preload, flush, flushAll: () => Promise.all(Object.keys(pending).map(flush)),
    lsGet: (slug, k) => { const m = LS[slug]; return m && m.has(k) ? m.get(k) : null; },
    lsSet, lsRemove,
    lsKeys: (slug) => [...(LS[slug] || new Map()).keys()],
    rootDir, records,
    onStatus(fn) { statusFn = fn || (() => {}); },
    _enc: encSeg, _dec: decSeg
  };
})();
