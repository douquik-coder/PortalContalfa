/* Portal Contalfa · lógica del portal (inicio de sesión, menú, herramientas, guardado y administración) */
(function () {
  'use strict';
  const C = window.PORTAL_CONFIG;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => new Date(d).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  if (!window.supabase || !C) { document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">No se pudo cargar el portal. Revisa tu conexión a internet y recarga la página.</p>'; return; }
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'portal-contalfa-auth' }
  });

  // ---------- utilidades ----------
  function show(v) { ['loading', 'login', 'setup', 'denied', 'app'].forEach((x) => $('#v-' + x).classList.toggle('hide', x !== v)); }
  function toast(t) { const d = $('#toast'); d.textContent = t; d.classList.add('show'); clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove('show'), 3800); }
  const chk = (r) => { if (r.error) throw r.error; return r.data; };

  async function adminFn(body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(C.supabaseUrl + '/functions/v1/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: C.supabaseKey, Authorization: 'Bearer ' + (session ? session.access_token : C.supabaseKey) },
      body: JSON.stringify(body)
    });
    let j = {}; try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok || j.error) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }

  function b64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  async function pack(str) {
    if (!window.CompressionStream) return 'js:' + str;
    const st = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return 'gz:' + b64(await new Response(st).arrayBuffer());
  }
  async function unpack(p) {
    if (p.startsWith('js:')) return p.slice(3);
    const st = new Blob([unb64(p.slice(3))]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(st).text();
  }

  // ---------- objeto compartido con las herramientas (ver bridge.js) ----------
  const Portal = window.Portal = {
    user: null, profile: null, tools: [], access: new Set(), sb,
    canUse(slug) { return this.access.has(slug); },
    toolHasCloudDb(slug) { return slug === 'ventas' && this.canUse(slug); },
    makeDb(slug) { return makeDb(slug); },
    onToolChange(slug) { if (cur.slug === slug && cur.snapshot) markDirty(); },
    toast(t) { toast(t); }
  };

  // Base de datos tipo "colecciones y documentos" que usa el Validador de libro de ventas, guardada por usuario.
  function makeDb(slug) {
    const uid = Portal.user.id;
    const t = () => sb.from('tool_docs');
    const fail = (e) => { throw { code: e.code || 'db', message: e.message || 'No se pudo leer o guardar en la nube.' }; };
    const coll = (name, filters) => ({
      doc: (id) => ({
        id,
        get: async () => {
          const r = await t().select('data').eq('tool_slug', slug).eq('collection', name).eq('doc_id', id).maybeSingle();
          if (r.error) fail(r.error);
          return { exists: !!r.data, id, data: () => (r.data ? r.data.data : undefined) };
        },
        set: async (body) => {
          const r = await t().upsert({ user_id: uid, tool_slug: slug, collection: name, doc_id: id, data: body, updated_at: new Date().toISOString() });
          if (r.error) fail(r.error);
        },
        delete: async () => {
          const r = await t().delete().eq('tool_slug', slug).eq('collection', name).eq('doc_id', id);
          if (r.error) fail(r.error);
        }
      }),
      where: (f, op, v) => { if (op !== '==') throw { code: 'unsupported', message: 'Filtro no soportado: ' + op }; return coll(name, filters.concat([[f, v]])); },
      get: async () => {
        let all = [];
        for (let from = 0; ; from += 500) {
          let q = t().select('doc_id,data').eq('tool_slug', slug).eq('collection', name);
          for (const [f, v] of filters) q = q.eq('data->>' + f, String(v));
          const r = await q.order('doc_id').range(from, from + 499);
          if (r.error) fail(r.error);
          all = all.concat(r.data);
          if (r.data.length < 500) break;
        }
        const docs = all.map((r) => ({ id: r.doc_id, exists: true, data: () => r.data }));
        return { docs, size: docs.length, empty: !docs.length };
      }
    });
    return { collection: (name) => coll(name, []) };
  }

  // ---------- inicio de sesión ----------
  const toEmail = (u) => u.trim().toLowerCase() + '@' + C.emailDomain;

  async function showLogin() {
    show('login');
    setTimeout(() => $('#f-login [name=username]').focus(), 50);
    try { const s = await adminFn({ action: 'status' }); $('#setup-link').classList.toggle('hide', !s.needsSetup); } catch (e) { /* sin conexión al servicio */ }
  }

  $('#f-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target, btn = $('button[type=submit]', f), err = $('#login-err');
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(f.username.value), password: f.password.value });
      if (error) {
        const m = /banned/i.test(error.message) ? 'Tu usuario está desactivado. Habla con el administrador.'
          : /invalid/i.test(error.message) ? 'Usuario o clave incorrectos.' : 'No se pudo entrar: ' + error.message;
        throw new Error(m);
      }
      f.password.value = '';
      await enter(data.user);
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Entrar'; }
  });

  $('#go-setup').addEventListener('click', (e) => { e.preventDefault(); show('setup'); });
  $('#back-login').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
  $('#f-setup').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target, err = $('#setup-err'), btn = $('button[type=submit]', f);
    err.textContent = '';
    if (f.password.value !== f.password2.value) { err.textContent = 'Las claves no coinciden.'; return; }
    btn.disabled = true;
    try {
      await adminFn({ action: 'bootstrap', code: f.code.value, full_name: f.full_name.value, username: f.username.value, password: f.password.value });
      const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(f.username.value), password: f.password.value });
      if (error) throw error;
      f.reset();
      await enter(data.user);
      toast('Administrador creado. Ya puedes crear a los analistas.');
      location.hash = '#/admin';
    } catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; }
  });

  $$('[data-logout]').forEach((b) => b.addEventListener('click', logout));
  async function logout() {
    try { await flushSave(); } catch (e) { /* seguimos */ }
    await sb.auth.signOut();
    location.hash = '#/';
    location.reload();
  }

  async function enter(user) {
    const prof = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (prof.error || !prof.data || !prof.data.active) {
      $('#denied-msg').textContent = prof.error ? 'No se pudo leer tu perfil: ' + prof.error.message
        : !prof.data ? 'Tu usuario no está registrado en el portal. Habla con el administrador.'
          : 'Tu usuario está desactivado. Habla con el administrador.';
      show('denied'); return;
    }
    Portal.user = user; Portal.profile = prof.data;
    const [tools, acc] = await Promise.all([
      sb.from('tools').select('*').order('sort'),
      sb.from('tool_access').select('tool_slug').eq('user_id', user.id)
    ]);
    Portal.tools = tools.data || [];
    Portal.access = new Set(prof.data.role === 'admin' ? Portal.tools.map((t) => t.slug) : (acc.data || []).map((a) => a.tool_slug));
    $('#who-name').textContent = prof.data.full_name || prof.data.username;
    $('#nav-admin').classList.toggle('hide', prof.data.role !== 'admin');
    show('app');
    route();
  }

  // ---------- navegación ----------
  window.addEventListener('hashchange', () => { if (Portal.user) route(); });
  async function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [page, arg] = h.split('/');
    if (cur.slug && !(page === 'h' && arg === cur.slug)) await closeTool();
    $$('.page').forEach((p) => p.classList.add('hide'));
    $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page === 'admin' ? 'admin' : 'home')));
    if (page === 'h' && arg && Portal.canUse(arg)) { if (cur.slug !== arg) openTool(arg); $('#p-tool').classList.remove('hide'); return; }
    if (page === 'admin' && Portal.profile.role === 'admin') { $('#p-admin').classList.remove('hide'); loadAdmin(); return; }
    if (page) { history.replaceState(null, '', '#/'); }
    renderHome(); $('#p-home').classList.remove('hide');
  }

  // Iconos de cada herramienta (trazos de 24 px)
  const ICONS = {
    ventas: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="M15 6l2 2 4-4"/>',
    mayor: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 10h8M8 14h8M8 18h5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    islr: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3M8 18.5h8"/>',
    otherlevel: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 6-7"/><path d="M16 6h4v4"/>',
    eeff: '<path d="M12 3v9l7.5 4.3"/><circle cx="12" cy="12" r="9"/>',
    atr: '<path d="M7 7h10l-3-3M17 17H7l3 3"/><rect x="2.5" y="9.5" width="7" height="5" rx="1"/><rect x="14.5" y="9.5" width="7" height="5" rx="1"/>',
    honorarios: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6.5h8v3H8z"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>'
  };
  // Herramientas de la zona ejecutiva (supervisores y gerentes), mostradas aparte del resto
  const EXEC = new Set(['honorarios']);
  const DEF_ICON = '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>';

  function renderHome() {
    const first = (Portal.profile.full_name || Portal.profile.username).split(' ')[0];
    $('#hello').innerHTML = 'Hola, <span class="grad">' + esc(first) + '</span>';
    const all = Portal.tools.filter((t) => Portal.canUse(t.slug));
    const exec = all.filter((t) => EXEC.has(t.slug));
    const list = all.filter((t) => !EXEC.has(t.slug));
    $('#no-tools').classList.toggle('hide', list.length > 0 || exec.length > 0);
    $('#stat-tools').textContent = all.length;
    $('#stat-cloud').textContent = all.filter((t) => t.cloud).length;
    const now = new Date();
    $('#stat-date').textContent = now.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' }).replace('.', '');
    $('#stat-day').textContent = now.toLocaleDateString('es-VE', { weekday: 'long' });
    const ico = (t) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.slug] || DEF_ICON}</svg>`;
    $('#tool-grid').innerHTML = list.map((t, i) => `<a class="tcard" href="#/h/${esc(t.slug)}" style="--i:${i}">
      <span class="tc-top"><span class="tc-ico">${ico(t)}</span><span class="cat">${esc(t.category)}</span></span>
      <b>${esc(t.name)}</b><p>${esc(t.description)}</p>
      <span class="tc-foot"><span class="badge ${t.cloud ? 'cloud' : ''}">${t.cloud ? '☁ Guardado en la nube' : 'Guarda en este equipo'}</span><span class="tc-go" aria-hidden="true">→</span></span></a>`).join('');
    $('#exec-zone').classList.toggle('hide', !exec.length);
    $('#home-body').classList.toggle('has-exec', exec.length > 0);
    $('#exec-tools').innerHTML = exec.map((t) => `<a class="xcard" href="#/h/${esc(t.slug)}">
      <span class="xc-ico">${ico(t)}</span>
      <span class="xc-txt"><b>${esc(t.name)}</b><span>${esc(t.description)}</span></span>
      <span class="xc-cta">Abrir <span aria-hidden="true">→</span></span></a>`).join('');
  }

  // ---------- herramienta abierta ----------
  const SNAPSHOT = { atr: { api: '__ATR', label: 'conciliación' } };
  const cur = { slug: null, snapshot: null, workId: null, title: null, dirty: false, saving: null, timer: null, restoring: false };
  const frame = $('#tool-frame');

  function openTool(slug) {
    const t = Portal.tools.find((x) => x.slug === slug);
    Object.assign(cur, { slug, snapshot: SNAPSHOT[slug] || null, workId: null, title: null, dirty: false, saving: null });
    $('#tool-name').textContent = t.name;
    const b = $('#tool-badge');
    b.textContent = t.cloud ? '☁ Guardado en la nube' : 'Guarda en este equipo';
    b.className = 'badge' + (t.cloud ? ' cloud' : '');
    $('#tool-actions').classList.toggle('hide', !cur.snapshot);
    setStatus('');
    frame.src = '/herramientas/' + encodeURIComponent(slug) + '.html?v=' + encodeURIComponent(t.version || '1');
    if (cur.snapshot) frame.addEventListener('load', offerResume, { once: true });
  }

  async function closeTool() {
    try { await flushSave(); } catch (e) { /* ya se avisó */ }
    frame.src = 'about:blank';
    cur.slug = null; cur.snapshot = null;
  }

  function api() { try { return frame.contentWindow[cur.snapshot.api]; } catch (e) { return null; } }
  function setStatus(t, isErr) { const s = $('#save-st'); s.textContent = t; s.classList.toggle('err', !!isErr); }

  function markDirty() {
    if (cur.restoring) return;
    cur.dirty = true; setStatus('Guardando…');
    clearTimeout(cur.timer); cur.timer = setTimeout(() => saveNow().catch(() => {}), 1500);
  }

  function autoTitle(st) {
    const mods = (st.loaded || []).filter((p) => p.kind === 'modulo');
    const base = (mods[0] || (st.loaded || [])[0] || {}).fileName || 'Conciliación';
    return base.replace(/\.(xlsx?|csv)$/i, '') + (mods.length > 1 ? ' y ' + (mods.length - 1) + ' más' : '');
  }
  function summaryOf(st) {
    const L = st.loaded || [];
    const mods = [...new Set(L.filter((p) => p.kind === 'modulo').map((p) => p.use))];
    return L.length + ' reporte(s)' + (mods.length ? ' · ' + mods.join(' y ') : '') + (st.ran ? ' · conciliado' : '');
  }

  async function saveNow() {
    clearTimeout(cur.timer);
    if (!cur.snapshot || !cur.dirty) return;
    if (cur.saving) { await cur.saving.catch(() => {}); return saveNow(); }
    const a = api(); if (!a) return;
    const st = a.getState();
    if (!(st.loaded || []).length && !cur.workId) { cur.dirty = false; setStatus(''); return; }
    cur.dirty = false;
    const slug = cur.slug;
    cur.saving = (async () => {
      const json = JSON.stringify(st);
      const payload = await pack(json);
      const row = { title: cur.title || autoTitle(st), summary: summaryOf(st), payload, size: payload.length, updated_at: new Date().toISOString() };
      if (cur.workId) chk(await sb.from('saved_work').update(row).eq('id', cur.workId));
      else { const d = chk(await sb.from('saved_work').insert(Object.assign({ tool_slug: slug, user_id: Portal.user.id }, row)).select('id').single()); if (cur.slug === slug) cur.workId = d.id; }
      if (cur.slug === slug) setStatus('☁ Guardado ' + fmtTime(new Date()));
    })();
    try { await cur.saving; }
    catch (e) {
      cur.dirty = true; setStatus('No se pudo guardar. Reintentando…', true);
      clearTimeout(cur.timer); cur.timer = setTimeout(() => saveNow().catch(() => {}), 10000);
      throw e;
    } finally { cur.saving = null; }
  }
  async function flushSave() { if (cur.snapshot && (cur.dirty || cur.saving)) { if (cur.saving) await cur.saving.catch(() => {}); await saveNow(); } }
  window.addEventListener('beforeunload', (e) => { if (cur.snapshot && (cur.dirty || cur.saving)) { saveNow().catch(() => {}); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow().catch(() => {}); });

  async function listWork() {
    return chk(await sb.from('saved_work').select('id,title,summary,size,updated_at').eq('tool_slug', cur.slug).order('updated_at', { ascending: false }).limit(200));
  }

  async function offerResume() {
    try {
      const rows = await listWork();
      if (!rows.length || cur.workId) return;
      const r = rows[0];
      setStatus('');
      const s = $('#save-st');
      s.innerHTML = `<a href="#" id="resume">Continuar «${esc(r.title)}»</a>`;
      $('#resume').onclick = (e) => { e.preventDefault(); openWork(r.id); };
    } catch (e) { /* sin conexión */ }
  }

  async function openWork(id) {
    try {
      await flushSave();
      setStatus('Abriendo…');
      const r = chk(await sb.from('saved_work').select('id,title,payload').eq('id', id).single());
      const st = JSON.parse(await unpack(r.payload));
      const a = api(); if (!a) throw new Error('La herramienta aún no terminó de cargar.');
      cur.restoring = true;
      try { a.setState(st); } finally { cur.restoring = false; }
      cur.workId = r.id; cur.title = r.title; cur.dirty = false;
      setStatus('☁ Abierto: ' + r.title);
      $('#dlg-list').close();
    } catch (e) { setStatus('No se pudo abrir el trabajo.', true); toast('No se pudo abrir: ' + (e.message || e)); }
  }

  $('#btn-new').addEventListener('click', async () => {
    await flushSave().catch(() => {});
    const a = api(); if (!a) return;
    cur.restoring = true; try { a.setState({ loaded: [] }); } finally { cur.restoring = false; }
    cur.workId = null; cur.title = null; cur.dirty = false;
    setStatus('Nueva ' + cur.snapshot.label);
  });

  $('#btn-rename').addEventListener('click', async () => {
    const a = api(); if (!a) return;
    if (!cur.workId && !(a.getState().loaded || []).length) { toast('Primero carga los archivos; luego le pones nombre.'); return; }
    const t = prompt('Nombre para este trabajo (por ejemplo: Cliente – octubre 2026)', cur.title || autoTitle(a.getState()));
    if (!t || !t.trim()) return;
    cur.title = t.trim().slice(0, 140);
    cur.dirty = true; await saveNow().catch(() => toast('No se pudo guardar el nombre.'));
  });

  $('#btn-list').addEventListener('click', async () => {
    const box = $('#work-list');
    box.innerHTML = '<p class="muted">Cargando…</p>';
    $('#dlg-list').showModal();
    try { await flushSave(); } catch (e) { /* sigue */ }
    try {
      const rows = await listWork();
      box.innerHTML = rows.length ? rows.map((r) => `<div class="work ${r.id === cur.workId ? 'cur' : ''}">
        <div class="wt"><b>${esc(r.title)}</b><span>${esc(r.summary)} · ${fmtDate(r.updated_at)} · ${fmtSize(r.size)}</span></div>
        <button class="btn sm primary" data-open="${r.id}">${r.id === cur.workId ? 'Abierto' : 'Abrir'}</button>
        <button class="btn sm ghost danger" data-del="${r.id}" aria-label="Eliminar">Eliminar</button></div>`).join('')
        : '<p class="muted">Aún no tienes trabajos guardados en esta herramienta.</p>';
      $$('[data-open]', box).forEach((b) => b.onclick = () => openWork(b.dataset.open));
      $$('[data-del]', box).forEach((b) => b.onclick = async () => {
        if (!confirm('¿Eliminar este trabajo guardado? No se puede deshacer.')) return;
        try { chk(await sb.from('saved_work').delete().eq('id', b.dataset.del)); if (cur.workId === b.dataset.del) { cur.workId = null; cur.title = null; } b.closest('.work').remove(); }
        catch (e) { toast('No se pudo eliminar: ' + e.message); }
      });
    } catch (e) { box.innerHTML = '<p class="form-err">No se pudo leer la lista: ' + esc(e.message) + '</p>'; }
  });
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  // ---------- administración ----------
  let adm = { users: [], access: [] };
  async function loadAdmin() {
    const m = $('#matrix');
    m.innerHTML = '<tr><td class="muted">Cargando…</td></tr>';
    try {
      const [u, a] = await Promise.all([
        sb.from('profiles').select('*').order('role').order('full_name'),
        sb.from('tool_access').select('user_id,tool_slug')
      ]);
      adm.users = chk(u); adm.access = chk(a);
      renderMatrix();
    } catch (e) { m.innerHTML = '<tr><td class="form-err">No se pudo cargar: ' + esc(e.message) + '</td></tr>'; }
  }

  function renderMatrix() {
    const has = new Set(adm.access.map((x) => x.user_id + '|' + x.tool_slug));
    const T = Portal.tools;
    $('#matrix').innerHTML = `<thead><tr><th>Usuario</th>${T.map((t) => `<th>${esc(t.name)}</th>`).join('')}<th>Estado</th><th></th></tr></thead><tbody>${adm.users.map((u) => {
      const isA = u.role === 'admin';
      return `<tr class="${u.active ? '' : 'off'}"><td><div class="uname">${esc(u.full_name || u.username)}</div><div class="ulogin">${esc(u.username)}</div></td>
      ${T.map((t) => `<td><input type="checkbox" aria-label="${esc(t.name)} para ${esc(u.username)}" data-u="${u.id}" data-t="${esc(t.slug)}" ${isA || has.has(u.id + '|' + t.slug) ? 'checked' : ''} ${isA ? 'disabled' : ''}></td>`).join('')}
      <td>${isA ? '<span class="pill adm">Administrador</span>' : u.active ? '<span class="pill on">Activo</span>' : '<span class="pill off">Desactivado</span>'}</td>
      <td class="acts"><button class="btn sm ghost" data-pass="${u.id}">Clave</button>${isA ? '' : `<button class="btn sm ghost" data-act="${u.id}">${u.active ? 'Desactivar' : 'Activar'}</button><button class="btn sm ghost danger" data-delu="${u.id}">Eliminar</button>`}</td></tr>`;
    }).join('')}</tbody>`;
    if (adm.users.length === 1) $('#matrix tbody').insertAdjacentHTML('beforeend', `<tr><td colspan="${T.length + 3}" class="muted" style="text-align:left">Aún no hay analistas. Usa «+ Nuevo analista» para crear el primero.</td></tr>`);

    $$('#matrix input[type=checkbox]').forEach((c) => c.onchange = async () => {
      const row = { user_id: c.dataset.u, tool_slug: c.dataset.t };
      c.disabled = true;
      try {
        if (c.checked) { chk(await sb.from('tool_access').insert(row)); adm.access.push(row); }
        else { chk(await sb.from('tool_access').delete().eq('user_id', row.user_id).eq('tool_slug', row.tool_slug)); adm.access = adm.access.filter((x) => !(x.user_id === row.user_id && x.tool_slug === row.tool_slug)); }
        toast(c.checked ? 'Herramienta activada' : 'Herramienta desactivada');
      } catch (e) { c.checked = !c.checked; toast('No se pudo cambiar: ' + e.message); }
      finally { c.disabled = false; }
    });
    $$('[data-act]').forEach((b) => b.onclick = async () => {
      const u = adm.users.find((x) => x.id === b.dataset.act);
      b.disabled = true;
      try { await adminFn({ action: 'set_active', user_id: u.id, active: !u.active }); u.active = !u.active; renderMatrix(); toast(u.active ? 'Usuario activado' : 'Usuario desactivado'); }
      catch (e) { toast(e.message); b.disabled = false; }
    });
    $$('[data-delu]').forEach((b) => b.onclick = async () => {
      const u = adm.users.find((x) => x.id === b.dataset.delu);
      if (!confirm(`¿Eliminar a ${u.full_name || u.username}? Se borran su usuario y sus trabajos guardados. No se puede deshacer.`)) return;
      try { await adminFn({ action: 'delete', user_id: u.id }); toast('Usuario eliminado'); loadAdmin(); }
      catch (e) { toast(e.message); }
    });
    $$('[data-pass]').forEach((b) => b.onclick = () => {
      const u = adm.users.find((x) => x.id === b.dataset.pass);
      const d = $('#dlg-pass'); d.dataset.u = u.id;
      $('#pass-who').textContent = (u.full_name || u.username) + ' · usuario ' + u.username;
      $('#f-pass').reset(); $('#pass-err').textContent = '';
      d.showModal();
    });
  }

  $('#btn-add-user').addEventListener('click', () => {
    const f = $('#f-user'); f.reset(); $('#user-err').textContent = '';
    $('#user-tools').innerHTML = '<legend>Herramientas activas</legend>' + Portal.tools.map((t) => `<label><input type="checkbox" value="${esc(t.slug)}"> ${esc(t.name)}</label>`).join('');
    $('#dlg-user').showModal();
  });

  $('#f-user').addEventListener('submit', async (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    ev.preventDefault();
    const f = ev.target, btn = $('#user-save');
    btn.disabled = true; $('#user-err').textContent = '';
    try {
      await adminFn({ action: 'create', full_name: f.full_name.value, username: f.username.value, password: f.password.value, tools: $$('#user-tools input:checked').map((c) => c.value) });
      $('#dlg-user').close();
      toast('Analista creado. Pásale su usuario y clave.');
      loadAdmin();
    } catch (e) { $('#user-err').textContent = e.message; }
    finally { btn.disabled = false; }
  });

  $('#f-pass').addEventListener('submit', async (ev) => {
    if (ev.submitter && ev.submitter.value === 'cancel') return;
    ev.preventDefault();
    const d = $('#dlg-pass');
    try { await adminFn({ action: 'set_password', user_id: d.dataset.u, password: ev.target.password.value }); d.close(); toast('Clave cambiada'); }
    catch (e) { $('#pass-err').textContent = e.message; }
  });

  // ---------- arranque ----------
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && Portal.user) location.reload(); });
  (async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) await enter(session.user); else await showLogin();
    } catch (e) { await showLogin(); }
  })();
})();
