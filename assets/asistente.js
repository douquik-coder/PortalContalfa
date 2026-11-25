/* Portal Contalfa · Asistente de carga con IA
   Revisa cada archivo antes de que entre a una herramienta. Si el formato es el esperado, lo deja pasar tal cual.
   Si no, propone qué columna es cada dato (con ayuda de Gemini), muestra los problemas encontrados y entrega a la
   herramienta una versión ordenada del archivo. Lo que el analista confirma se guarda como "formato" para toda la firma. */
(function () {
  'use strict';
  const Portal = window.Portal;
  if (!Portal) return;
  const C = window.PORTAL_CONFIG;

  // ======================= utilidades =======================
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deacc = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nrm = (s) => deacc(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  const NORM = (s) => deacc(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  const txt = (v) => (blank(v) ? '' : String(v).replace(/\s+/g, ' ').trim());
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const fmtN = (n) => (n == null ? '' : Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES_ABR = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  const colL = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // Número en formato venezolano o internacional → número (o null si no es número)
  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (blank(v)) return null;
    let s = String(v).trim().replace(/\s|bs\.?s?|bsd|ves|usd|\$/gi, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    const lc = s.lastIndexOf(','), lp = s.lastIndexOf('.');
    if (lc >= 0 && lp >= 0) { s = lc > lp ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); }
    else if (lc >= 0) { s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.'); }
    else if (lp >= 0) { if (s.match(/\./g).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, ''); }
    const n = parseFloat(s);
    return isNaN(n) ? null : (neg ? -n : n);
  }
  const isTextNum = (v) => typeof v === 'string' && toNum(v) !== null;

  // Fecha en cualquier formato común → {y,m,d}
  function toDate(v, fmt) {
    if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
      if (v > 19000101 && v < 21001231) { const s = String(Math.round(v)); return valid(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)); }
      return null;
    }
    const s = txt(v); if (!s || s.length > 40) return null;
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:\s.*)?$/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
      if (fmt === 'mdy' || (a <= 12 && b > 12 && fmt !== 'dmy_strict')) { const t = a; a = b; b = t; }
      return valid(y, b, a);
    }
    m = nrm(s).match(/^(\d{1,2}) (?:de )?([a-z]{3,})\.? (?:de )?(\d{2,4})$/);
    if (m && MES_ABR[m[2].slice(0, 3)]) { let y = +m[3]; if (y < 100) y += 2000; return valid(y, MES_ABR[m[2].slice(0, 3)], +m[1]); }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    return null;
    function valid(y, mo, d) { if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null; const t = new Date(y, mo - 1, d); return t.getMonth() === mo - 1 ? { y, m: mo, d } : null; }
  }
  const fmtDate = (o) => (o ? String(o.d).padStart(2, '0') + '/' + String(o.m).padStart(2, '0') + '/' + o.y : '');
  const isDateLike = (v) => !!toDate(v);

  // Código de cuenta y "código - nombre"
  const CODE_RE = /^\d+(?:[.\-]\d+)+$|^\d{3,12}$/;
  const COMB_RE = /^\s*(\d+(?:[.\-]\d+)*)\s*(?:[-–:]\s*|\s+)(\D.*)$/;
  function splitCode(v) {
    const s = txt(v); if (!s) return null;
    const m = s.match(COMB_RE);
    if (m && m[2].trim().length > 1) return { code: m[1], name: m[2].trim() };
    if (CODE_RE.test(s)) return { code: s, name: '' };
    return null;
  }
  // Pone puntos al código cuando el sistema lo exporta sin separadores (máscara tipo #.#.##.###)
  function applyMask(code, mask) {
    code = String(code).trim();
    if (/[.]/.test(code)) return code;
    if (/-/.test(code)) return code.replace(/-/g, '.');
    if (!mask) return code;
    const digits = code.replace(/\D/g, ''); let out = '', k = 0;
    for (const ch of mask) { if (k >= digits.length) break; if (ch === '#') out += digits[k++]; else out += ch; }
    if (k < digits.length) out += (out.endsWith('.') ? '' : '.') + digits.slice(k);
    return out.replace(/\.$/, '');
  }

  // ======================= tipos de documento =======================
  const F = (k, label, type, req, al) => ({ k, label, type, req: !!req, al });
  const DOCS = {
    modulo: {
      name: 'Reporte de transacciones CXP/CXC (módulo administrativo)',
      fields: [
        F('fecha', 'Fecha', 'date', 1, ['fecha', 'fecha emision', 'fecha documento', 'fecha doc', 'f emision', 'emision', 'fecha factura']),
        F('tercero', 'Proveedor / Cliente', 'text', 1, ['proveedor', 'cliente', 'beneficiario', 'razon social', 'nombre', 'tercero', 'nombre proveedor', 'nombre cliente']),
        F('tipo', 'Tipo de documento', 'text', 0, ['tipo', 'tipo doc', 'tipo documento', 'tipo de documento', 'transaccion', 'tipo transaccion']),
        F('referencia', 'Referencia', 'text', 1, ['referencia', 'ref', 'nro referencia', 'n referencia', 'referencia interna']),
        F('documento', 'N° documento', 'text', 0, ['documento', 'nro documento', 'n documento', 'numero documento', 'factura', 'nro', 'numero', 'n']),
        F('monto', 'Total Bs', 'number', 1, ['total bs', 'total', 'monto', 'monto bs', 'importe', 'total bolivares', 'monto total']),
        F('fechaCont', 'Fecha contable', 'date', 0, ['fecha contable', 'contable', 'fecha cont', 'fecha contabilizacion'])
      ],
      keywords: /CXP|CXC|CUENTAS POR (PAGAR|COBRAR)|TRANSACCIONES/
    },
    mayor: {
      name: 'Mayor analítico',
      fields: [
        F('cuenta', 'Cuenta (código o código - nombre)', 'code', 0, ['cuenta', 'codigo', 'codigo cuenta', 'cod cuenta', 'cta', 'nro cuenta', 'cuenta contable']),
        F('cuentaNombre', 'Nombre de la cuenta', 'text', 0, ['nombre cuenta', 'descripcion cuenta', 'nombre de la cuenta', 'denominacion']),
        F('fecha', 'Fecha', 'date', 1, ['fecha', 'fecha asiento', 'fecha comprobante', 'f contable']),
        F('detalle', 'Detalle', 'text', 0, ['detalle', 'descripcion', 'concepto', 'glosa', 'descripcion asiento']),
        F('referencia', 'Referencia', 'text', 0, ['referencia', 'ref', 'comprobante', 'asiento', 'documento', 'nro comprobante']),
        F('debe', 'Debe', 'number', 0, ['debe', 'debito', 'debitos', 'cargo', 'cargos']),
        F('haber', 'Haber', 'number', 0, ['haber', 'credito', 'creditos', 'abono', 'abonos']),
        F('monto', 'Monto con signo (si no hay Debe/Haber)', 'number', 0, ['monto', 'importe', 'movimiento', 'valor']),
        F('saldo', 'Saldo', 'number', 0, ['saldo', 'saldo acumulado', 'saldo final', 'balance'])
      ],
      keywords: /MAYOR|AUXILIAR|LIBRO MAYOR/
    },
    bc: {
      name: 'Balance de comprobación',
      fields: [
        F('codigo', 'Código de cuenta', 'code', 1, ['codigo', 'cuenta', 'codigo cuenta', 'cod', 'nro cuenta', 'cta']),
        F('nombre', 'Nombre de la cuenta', 'text', 0, ['nombre', 'descripcion', 'nombre cuenta', 'denominacion', 'nombre de la cuenta']),
        F('si', 'Saldo inicial', 'number', 0, ['saldo inicial', 'saldo anterior', 'inicial', 'anterior', 'saldo al inicio']),
        F('debe', 'Debe', 'number', 1, ['debe', 'debito', 'debitos', 'cargos', 'movimiento debe']),
        F('haber', 'Haber', 'number', 1, ['haber', 'credito', 'creditos', 'abonos', 'movimiento haber']),
        F('sf', 'Saldo final', 'number', 0, ['saldo final', 'saldo actual', 'saldo', 'final', 'saldo al cierre'])
      ],
      keywords: /BALANCE DE COMPROBACION|BALANZA|COMPROBACION/
    },
    ventas: {
      name: 'Libro de ventas',
      fields: [
        F('fecha', 'Fecha', 'date', 1, ['fecha', 'fecha factura', 'fecha documento', 'fecha emision']),
        F('serie', 'Serial máquina fiscal', 'text', 0, ['serial', 'serie', 'maquina', 'serial maquina', 'maquina fiscal']),
        F('rif', 'RIF / Cédula', 'text', 1, ['rif', 'cedula', 'ci', 'rif cliente', 'rif ci']),
        F('nombre', 'Nombre o razón social', 'text', 0, ['nombre', 'razon social', 'cliente', 'nombre o razon social']),
        F('factura', 'N° factura', 'text', 1, ['factura', 'n factura', 'nro factura', 'numero factura', 'n de factura']),
        F('nd', 'N° nota de débito', 'text', 0, ['nota debito', 'nota de debito', 'n nota debito', 'nd']),
        F('nc', 'N° nota de crédito', 'text', 0, ['nota credito', 'nota de credito', 'n nota credito', 'nc']),
        F('control', 'N° control', 'text', 0, ['control', 'n control', 'nro control', 'numero control', 'reporte z']),
        F('afectada', 'Factura afectada', 'text', 0, ['factura afectada', 'afectada', 'n factura afectada']),
        F('c_total', 'Total ventas con IVA', 'number', 1, ['total ventas', 'total', 'total venta', 'total factura', 'monto total', 'total con iva']),
        F('c_exento', 'Ventas exentas', 'number', 0, ['exento', 'exentas', 'ventas exentas', 'no sujeto', 'no gravado', 'monto exento']),
        F('c_base', 'Base imponible', 'number', 1, ['base', 'base imponible', 'monto base']),
        F('c_alic', 'Alícuota %', 'number', 0, ['alicuota', '%', 'tasa', '% alicuota', 'alicuota %']),
        F('c_iva', 'IVA (débito fiscal)', 'number', 1, ['iva', 'impuesto', 'debito fiscal', 'monto iva']),
        F('comprobante', 'N° comprobante de retención', 'text', 0, ['comprobante', 'comprobante retencion', 'n comprobante']),
        F('fcomp', 'Fecha del comprobante', 'date', 0, ['fecha comprobante', 'fecha retencion']),
        F('retenido', 'IVA retenido', 'number', 0, ['iva retenido', 'retenido', 'retencion', 'monto retenido'])
      ],
      keywords: /LIBRO DE VENTAS|DEBITO FISCAL|VENTAS/
    }
  };
  // Documentos que no son de ninguna herramienta pero conviene reconocer para avisar
  const OTROS = [
    { re: /LIBRO DE COMPRAS|LIBRODECOMPRAS|TOTAL COMPRAS|COMPRAS INTERNAS/, name: 'un libro de compras' },
    { re: /ESTADO DE CUENTA|SALDO DISPONIBLE|MOVIMIENTOS BANCARIOS/, name: 'un estado de cuenta bancario' },
    { re: /NOMINA .*(TRABAJADOR|EMPLEADO)|RECIBOS? DE PAGO/, name: 'una nómina' },
    { re: /REPORTE DE INVENTARIO|KARDEX|EXISTENCIA FISICA/, name: 'un reporte de inventario' }
  ];

  // Dónde se conecta el asistente en cada herramienta
  const SHEETS = ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'txt', 'tsv'];
  const SLOTS = {
    atr: [{ id: 'atr', selector: '#file', drop: '#drop', docs: ['modulo', 'mayor'], exts: ['xls', 'xlsx', 'xlsm', 'csv'] }],
    ventas: [{ id: 'ventas', selector: '#fileIn', drop: '#drop', docs: ['ventas'], exts: ['xls', 'xlsx', 'xlsm', 'csv'] }],
    islr: [
      { id: 'islr-bc', selector: 'input[onchange*="subirBC"]', docs: ['bc'], exts: ['xls', 'xlsx', 'xlsm', 'csv'] },
      { id: 'islr-mayor', selector: 'input[onchange*="subirMayores"]', docs: ['mayor'], exts: ['xls', 'xlsx', 'xlsm', 'csv'] }
    ],
    eeff: [{ id: 'eeff-bc', selector: '#fBC', docs: ['bc'], exts: SHEETS }],
    mayor: [{ id: 'revisor', selector: '#fIn', drop: '#drop', docs: ['mayor'], exts: null, onlyIfLooksLike: true }],
    otherlevel: [{ id: 'otherlevel', selector: '#files', drop: '#drop', docs: ['mayor'], exts: ['xls', 'xlsx'], onlyIfLooksLike: true }]
  };
  const TOOL_NAME = { atr: 'Conciliador ATR', ventas: 'Validador de libro de ventas', islr: 'Precierre e ISLR', eeff: 'Generador de EEFF VEN-NIF', mayor: 'Revisor de mayor analítico', otherlevel: 'Reporte mensual Other Level' };

  Portal.assistSlots = (slug) => (SLOTS[slug] || []).map((s) => ({ id: s.id, selector: s.selector, drop: s.drop || null }));

  // ======================= lectura de archivos =======================
  let xlsxReady = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxReady) xlsxReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX); s.onerror = () => { xlsxReady = null; rej(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión.')); };
      document.head.appendChild(s);
    });
    return xlsxReady;
  }
  function parseDelimited(text) {
    const head = text.replace(/\r/g, '').split('\n').slice(0, 20).join('\n');
    const cnt = (ch) => head.split(ch).length - 1;
    const delim = [['\t', cnt('\t')], [';', cnt(';')], [',', cnt(',')], ['|', cnt('|')]].sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (ch !== '\r') f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return { rows, delim };
  }
  async function readBook(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const buf = new Uint8Array(await file.arrayBuffer());
    const notes = [];
    if (!buf.length) throw new Error('El archivo está vacío (0 bytes).');
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) throw Object.assign(new Error('Es un PDF, no una hoja de cálculo.'), { code: 'pdf' });
    if ((buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50)) throw Object.assign(new Error('Es una imagen, no una hoja de cálculo.'), { code: 'img' });
    if (['csv', 'txt', 'tsv'].includes(ext)) {
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) { text = new TextDecoder('windows-1252').decode(buf); notes.push('El archivo de texto venía con acentos en formato de Windows; se corrigieron.'); }
      const p = parseDelimited(text.replace(/^﻿/, ''));
      return { sheets: [{ name: 'Datos', rows: trimRows(p.rows) }], notes, csv: true };
    }
    const X = await loadXLSX();
    let wb;
    try { wb = X.read(buf, { type: 'array', cellDates: false, cellNF: false, cellText: false }); }
    catch (e) {
      if (/password|encrypt/i.test(e.message)) throw Object.assign(new Error('El archivo está protegido con clave. Ábrelo en Excel, quita la clave y vuelve a guardarlo.'), { code: 'pwd' });
      throw Object.assign(new Error('No se pudo leer el archivo: parece dañado o no es de Excel (' + e.message + ').'), { code: 'bad' });
    }
    const sheets = wb.SheetNames.map((n) => {
      const ws = wb.Sheets[n];
      if (!ws || !ws['!ref']) return { name: n, rows: [] };
      const rg = X.utils.decode_range(ws['!ref']); rg.s.c = 0; rg.s.r = 0;
      const rows = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true, range: X.utils.encode_range(rg) });
      return { name: n, rows: trimRows(rows), hidden: false };
    });
    return { sheets, notes, csv: false };
  }
  function trimRows(rows) {
    let end = rows.length; while (end > 0 && (rows[end - 1] || []).every(blank)) end--;
    return rows.slice(0, end).map((r) => { r = r || []; let e = r.length; while (e > 0 && blank(r[e - 1])) e--; return r.slice(0, e); });
  }

  // ======================= reconocer el formato que cada herramienta ya acepta =======================
  const firstRows = (rows, n) => rows.slice(0, n || 15);
  function acceptsModulo(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const h = (rows[i] || []).map(NORM);
      if (h.includes('REFERENCIA') && h.some((c) => c.startsWith('TOTALBS'))) {
        const cRef = h.indexOf('REFERENCIA');
        const data = rows.slice(i + 1).filter((r) => !blank(r[cRef]));
        const okDates = data.filter((r) => /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(txt(r[0])) || (typeof r[0] === 'number' && r[0] > 20000 && r[0] < 80000)).length;
        return data.length > 0 && okDates >= data.length * 0.8;
      }
    }
    return false;
  }
  const ACC_HDR = /^(\d+(?:\.\d+){2,})\s*-\s*(.+)$/;
  function acceptsMayor(rows, slot) {
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const h = (rows[i] || []).map(NORM);
      if (h.includes('FECHA') && h.includes('DEBE') && h.includes('HABER') && h.includes('REFERENCIA')) { hi = i; break; }
    }
    if (hi < 0) return false;
    if (slot && slot.id === 'otherlevel') { const h0 = (rows[0] || []).map(txt).join('|'); if (!h0.startsWith('Fecha|Detalle|Referencia|Saldo Inicial')) return false; }
    let accs = 0, lines = 0, okL = 0;
    for (let i = hi + 1; i < rows.length && i < hi + 3000; i++) {
      const r = rows[i] || []; const c0 = txt(r[0]);
      if (ACC_HDR.test(c0) && r.slice(1).every(blank)) { accs++; continue; }
      if (accs && r.slice(1).some((c) => typeof c === 'number')) { lines++; if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(c0) || (typeof r[0] === 'number' && r[0] > 20000 && r[0] < 80000)) okL++; }
    }
    return accs > 0 && lines > 0 && okL >= lines * 0.6;
  }
  const isCodeISLR = (s) => /^\d[\d.\-]*\d$/.test(String(s).trim()) && /[.\-]/.test(String(s));
  function acceptsBC(rows, slot) {
    const hi = rows.findIndex((r) => (r || []).some((c) => /d[eé]b/i.test(String(c))) && (r || []).some((c) => /cr[eé]d|haber/i.test(String(c))));
    if (hi < 0 || hi > 25) return false;
    const data = rows.slice(hi + 1).filter((r) => isCodeISLR(txt(r[0])) && typeof r[1] === 'string');
    if (data.length < 3) return false;
    if (slot && slot.id === 'islr-bc') {
      // El precierre lee los montos desde la tercera columna, en el orden de los títulos del encabezado
      const labels = (rows[hi] || []).filter((c) => !blank(c));
      const nums = Math.max(...data.slice(0, 50).map((r) => r.slice(2).length));
      if (!blank(rows[hi][0]) || !blank(rows[hi][1]) || labels.length !== nums) return false;
    }
    const numOk = data.filter((r) => r.slice(2).some((c) => typeof c === 'number')).length;
    return numOk >= data.length * 0.7;
  }
  // Réplica de la detección del Validador (encabezado con sinónimos, o formato de 33+ columnas sin encabezado)
  const VSYN = {
    fecha: /^fecha( de la)?( factura| documento| emisi)?/, rif: /rif|c\.?i\.?\b|cedula|cédula/, nombre: /nombre|raz[oó]n social|cliente/,
    factura: /(n[°ºo.]*|numero|número).{0,4}factura$|^factura$|^n.{0,3}fact/, base: /base/, iva: /^i\.?v\.?a\.?$|impuesto|d[eé]bito fiscal/, total: /total/
  };
  function acceptsVentas(rows) {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const row = rows[r] || []; const labels = row.map((c) => txt(c).toLowerCase());
      if (labels.some((l) => toDate(l)) || row.some((c) => typeof c === 'number' && c !== 0)) continue;
      let hits = 0, f = false, bi = false;
      labels.forEach((l) => { if (!l || l.length > 60) return; for (const k in VSYN) if (VSYN[k].test(l)) { hits++; if (k === 'fecha') f = true; if (k === 'base' || k === 'iva') bi = true; break; } });
      if (hits >= 5 && f && bi) return true;
    }
    const data = rows.filter((r) => r && toDate(r[0], 'dmy_strict'));
    const width = Math.max(0, ...rows.map((r) => (r || []).length));
    return data.length > 0 && width >= 25;
  }
  const ACCEPT = { modulo: acceptsModulo, mayor: acceptsMayor, bc: acceptsBC, ventas: acceptsVentas };

  // ======================= detección automática de columnas =======================
  function scoreLabel(label, aliases) {
    const l = nrm(label); if (!l || l.length > 60) return 0;
    let best = 0;
    for (const a of aliases) {
      if (l === a) best = Math.max(best, 3);
      else if (l.startsWith(a + ' ') || l.endsWith(' ' + a)) best = Math.max(best, 2);
      else if (a.length > 3 && l.includes(a)) best = Math.max(best, 1);
    }
    return best;
  }
  function findHeader(rows, doc) {
    let best = { row: -1, score: 0 };
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i] || []; if (r.filter((c) => !blank(c)).length < 2) continue;
      if (r.filter((c) => typeof c === 'number').length > 1) continue;
      let sc = 0; for (const f of doc.fields) { const s = Math.max(0, ...r.map((c) => scoreLabel(c, f.al))); if (s) sc += s + (f.req ? 1 : 0); }
      if (sc > best.score) best = { row: i, score: sc };
    }
    return best.score >= 4 ? best.row : -1;
  }
  function colStats(rows, start, width) {
    const sample = rows.slice(start, start + 400).filter((r) => r && r.some((c) => !blank(c)));
    const st = [];
    for (let j = 0; j < width; j++) {
      let n = 0, num = 0, tnum = 0, date = 0, code = 0, comb = 0, txtLen = 0, txtN = 0;
      for (const r of sample) {
        const v = r[j]; if (blank(v)) continue; n++;
        if (typeof v === 'number') { num++; if (v > 20000 && v < 80000 && Number.isInteger(v)) date += 0.5; }
        else if (isTextNum(v)) { tnum++; }
        if (typeof v === 'string' && toDate(v)) date++;
        if (typeof v === 'string' && CODE_RE.test(v.trim())) code++;
        if (typeof v === 'string' && COMB_RE.test(v) && !toDate(v)) comb++;
        if (typeof v === 'string' && toNum(v) === null) { txtLen += v.length; txtN++; }
      }
      st.push({ n, num: n ? num / n : 0, tnum: n ? tnum / n : 0, date: n ? date / n : 0, code: n ? code / n : 0, comb: n ? comb / n : 0, txtAvg: txtN ? txtLen / txtN : 0, txt: n ? txtN / n : 0 });
    }
    return st;
  }
  function autoMap(rows, doc, hdrRow) {
    const width = Math.max(0, ...rows.slice(0, 400).map((r) => (r || []).length));
    const map = {}; const used = new Set();
    if (hdrRow >= 0) {
      const H = rows[hdrRow] || [];
      const cands = [];
      doc.fields.forEach((f) => H.forEach((c, j) => { const s = scoreLabel(c, f.al); if (s) cands.push({ f: f.k, j, s: s + (f.req ? 0.5 : 0) }); }));
      cands.sort((a, b) => b.s - a.s);
      for (const c of cands) { if (map[c.f] !== undefined || used.has(c.j)) continue; map[c.f] = c.j; used.add(c.j); }
    }
    // Completar con los datos: fechas, montos y textos
    const st = colStats(rows, hdrRow + 1, width);
    const free = (pred) => st.map((s, j) => ({ s, j })).filter((x) => !used.has(x.j) && pred(x.s));
    for (const f of doc.fields) {
      if (map[f.k] !== undefined || !f.req) continue;
      let pick = null;
      if (f.type === 'date') pick = free((s) => s.date > 0.6).sort((a, b) => b.s.date - a.s.date)[0];
      else if (f.type === 'code') pick = free((s) => s.code + s.comb > 0.5).sort((a, b) => (b.s.code + b.s.comb) - (a.s.code + a.s.comb))[0];
      else if (f.type === 'number') pick = free((s) => s.num + s.tnum > 0.6).sort((a, b) => a.j - b.j)[0];
      else if (f.k === 'referencia') pick = free((s) => s.txt > 0.5 && s.txtAvg < 20).sort((a, b) => a.j - b.j)[0];
      else pick = free((s) => s.txt > 0.6).sort((a, b) => b.s.txtAvg - a.s.txtAvg)[0];
      if (pick) { map[f.k] = pick.j; used.add(pick.j); }
    }
    // Un campo mapeado por nombre pero sin datos válidos se descarta
    for (const f of doc.fields) {
      const j = map[f.k]; if (j === undefined) continue; const s = st[j]; if (!s || !s.n) continue;
      if (f.type === 'date' && s.date < 0.3 && f.req) delete map[f.k];
      if (f.type === 'number' && s.num + s.tnum < 0.3 && s.n > 3) delete map[f.k];
    }
    return { map, width, st };
  }
  function detectDateFmt(rows, start, col) {
    let dmy = 0, mdy = 0, ymd = 0;
    for (const r of rows.slice(start, start + 500)) {
      const s = txt(r && r[col]); let m;
      if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}/))) { if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++; }
      else if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/.test(s)) ymd++;
    }
    // Si ninguna fecha lo aclara, se compara cuántos meses distintos salen con cada lectura: la correcta suele dar menos
    let amb = !dmy && !mdy && !ymd;
    if (amb) {
      const a = new Set(), b = new Set();
      for (const r of rows.slice(start, start + 500)) { const m = txt(r && r[col]).match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/); if (m) { a.add(m[2] + m[3]); b.add(m[1] + m[3]); } }
      if (a.size && a.size < b.size) amb = false;
      if (b.size && b.size < a.size && b.size === 1) { amb = false; mdy = 1; }
    }
    return { fmt: mdy > dmy ? 'mdy' : 'dmy', ambiguous: amb, mdy, dmy, ymd };
  }

  // Clasifica una hoja: ¿qué documento parece?
  function guessDoc(sheet, fileName) {
    const top = NORM(fileName) + ' ' + firstRows(sheet.rows, 15).map((r) => (r || []).map((c) => deacc(c).toUpperCase()).join(' ')).join(' ');
    const out = [];
    for (const k in DOCS) {
      const d = DOCS[k]; const h = findHeader(sheet.rows, d); let sc = 0;
      if (h >= 0) { const H = sheet.rows[h]; for (const f of d.fields) if (H.some((c) => scoreLabel(c, f.al) >= 2)) sc += f.req ? 2 : 1; }
      if (d.keywords.test(top)) sc += 3;
      if (k === 'mayor' && sheet.rows.slice(0, 200).filter((r) => ACC_HDR.test(txt(r && r[0])) && (r || []).slice(1).every(blank)).length >= 1) sc += 4;
      if (k === 'bc' && /SALDO INICIAL|SALDO ANTERIOR/.test(top) && !/FECHA/.test(top)) sc += 3;
      out.push({ k, sc });
    }
    const other = OTROS.find((o) => o.re.test(top));
    out.sort((a, b) => b.sc - a.sc);
    return { best: out[0], all: out, other: other ? other.name : '', top };
  }

  // ======================= extracción y normalización =======================
  function extract(ana) {
    const { rows } = ana.sheet; const o = ana.opt; const doc = DOCS[ana.docType]; const m = o.map; const start = o.hdrRow + 1;
    const g = (r, k) => (m[k] === undefined || m[k] < 0 ? '' : r[m[k]]);
    const recs = []; const bad = { date: 0, num: 0, req: 0 }; let textNums = 0, totalRow = null;
    let curAcc = null; const accs = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || []; if (r.every(blank)) continue;
      const rowTxt = deacc(r.map(txt).join(' ')).toUpperCase();
      // Encabezados de cuenta (mayor agrupado)
      if (ana.docType === 'mayor' && o.grouped) {
        const first = r.findIndex((c) => !blank(c));
        const nonEmpty = r.filter((c) => !blank(c));
        const sc = splitCode(r[first]);
        if (sc && sc.name && nonEmpty.length <= 2 && !r.some((c) => typeof c === 'number' && !(c > 20000 && c < 80000) && c !== r[first])) {
          curAcc = { code: applyMask(sc.code, o.mask), name: sc.name }; accs.push(curAcc); continue;
        }
        if (sc && !sc.name && nonEmpty.length === 2 && typeof nonEmpty[1] === 'string' && !toDate(nonEmpty[1]) && toNum(nonEmpty[1]) === null) {
          curAcc = { code: applyMask(sc.code, o.mask), name: txt(nonEmpty[1]) }; accs.push(curAcc); continue;
        }
      }
      if (/^\s*TOTAL/.test(rowTxt)) {
        const nums = r.map(toNum).filter((x) => x !== null);
        if (nums.length) totalRow = { nums, isGeneral: /TOTAL GENERAL|TOTALES/.test(rowTxt), row: i + 1 };
        continue;
      }
      if (/SALDOS? IN(I)?C|SALDO ANTERIOR/.test(rowTxt) && ana.docType === 'mayor') {
        const sal = toNum(g(r, 'saldo')); const de = toNum(g(r, 'debe')) || 0, ha = toNum(g(r, 'haber')) || 0;
        const acc = curAcc || accOf(r);
        if (acc) acc.opening = sal !== null ? sal : r2(de - ha);
        continue;
      }
      const rec = { _row: i + 1 };
      let any = false;
      for (const f of doc.fields) {
        if (m[f.k] === undefined || m[f.k] < 0) continue;
        const v = g(r, f.k);
        if (f.type === 'date') { const d = toDate(v, o.dateFmt); rec[f.k] = d; if (!blank(v)) any = true; }
        else if (f.type === 'number') { const n = toNum(v); if (typeof v === 'string' && n !== null) textNums++; rec[f.k] = n; if (n) any = true; }
        else if (f.type === 'code') { rec[f.k] = txt(v); if (!blank(v)) any = true; }
        else { rec[f.k] = txt(v); if (!blank(v)) any = true; }
      }
      if (!any) continue;
      // Fecha obligatoria
      const dateF = doc.fields.find((f) => f.type === 'date' && f.req);
      if (dateF && !rec[dateF.k]) {
        const hasData = doc.fields.some((f) => f.type === 'number' && rec[f.k]);
        if (hasData) { bad.date++; rec._badDate = txt(g(r, dateF.k)); recs.push(rec); }
        continue;
      }
      if (ana.docType === 'mayor') {
        if (o.amountMode === 'signed') { const v = rec.monto || 0; rec.debe = v > 0 ? v : 0; rec.haber = v < 0 ? -v : 0; }
        rec.debe = rec.debe || 0; rec.haber = rec.haber || 0;
        if (!o.grouped) { const acc = accOf(r); if (!acc) { bad.req++; continue; } rec._acc = acc; }
        else { if (!curAcc) { bad.req++; continue; } rec._acc = curAcc; }
      }
      if (ana.docType === 'bc') {
        const sc = splitCode(rec.codigo);
        if (!sc) continue; // filas de grupo o títulos
        rec.codigo = applyMask(sc.code, o.mask); if (!rec.nombre && sc.name) rec.nombre = sc.name;
        if (!rec.nombre) { bad.req++; continue; }
      }
      const miss = doc.fields.filter((f) => f.req && f.type !== 'date' && f.k !== 'codigo' && (rec[f.k] === '' || rec[f.k] === null || rec[f.k] === undefined));
      if (miss.length && ana.docType !== 'mayor') { rec._miss = miss.map((f) => f.label); bad.req++; }
      recs.push(rec);
    }
    function accOf(r) {
      const v = g(r, 'cuenta'); const sc = splitCode(v); if (!sc) return null;
      const code = applyMask(sc.code, o.mask);
      let acc = accs.find((a) => a.code === code);
      if (!acc) { acc = { code, name: sc.name || txt(g(r, 'cuentaNombre')) || 'Cuenta ' + code }; accs.push(acc); }
      return acc;
    }
    return { recs, bad, textNums, totalRow, accs };
  }

  // ======================= revisiones =======================
  function checks(ana, ex) {
    const out = []; const o = ana.opt; const recs = ex.recs.filter((r) => !r._badDate);
    const add = (sev, msg, extra) => out.push(Object.assign({ sev, msg }, extra || {}));
    if (ana.other) add('bad', `Este archivo parece <b>${esc(ana.other)}</b>, no ${esc(DOCS[ana.docType].name.toLowerCase())}. Verifica que subiste el archivo correcto.`);
    if (ana.wrongDoc) add('bad', `Este archivo parece <b>${esc(DOCS[ana.wrongDoc].name.toLowerCase())}</b>, pero aquí se espera ${esc(DOCS[ana.docType].name.toLowerCase())}.`);
    if (!recs.length) { add('bad', 'No se encontraron filas de datos con las columnas elegidas. Revisa la hoja, la fila de títulos y las columnas.'); return out; }
    if (ex.bad.date) add('warn', `${ex.bad.date} fila(s) con montos tienen la fecha vacía o ilegible (por ejemplo «${esc(ex.recs.find((r) => r._badDate)._badDate || 'vacía')}»). Se dejarán fuera.`);
    if (ex.bad.req) add('warn', `${ex.bad.req} fila(s) no tienen un dato obligatorio (${esc([...new Set(ex.recs.filter((r) => r._miss).flatMap((r) => r._miss))].join(', ') || 'cuenta')}).`);
    if (ex.textNums && !(ana.book && ana.book.csv)) add('info', `${ex.textNums} monto(s) venían escritos como texto (por ejemplo «1.234,56»); se convirtieron a números.`);
    if (o.dateInfo && o.dateInfo.ambiguous && o.map.fecha !== undefined) add('info', 'Las fechas no permiten saber si van día/mes o mes/día. Se leen como <b>día/mes/año</b>; cámbialo abajo si no es así.');
    if (o.dateInfo && o.dateInfo.mdy && o.dateFmt === 'mdy') add('info', 'Las fechas venían en formato mes/día/año (estilo EE. UU.); se convirtieron a día/mes/año.');
    // Período
    const dk = DOCS[ana.docType].fields.find((f) => f.type === 'date' && f.req);
    if (dk) {
      const months = {}; let minY = 9999, maxY = 0;
      recs.forEach((r) => { const d = r[dk.k]; if (!d) return; const k = d.y + '-' + String(d.m).padStart(2, '0'); months[k] = (months[k] || 0) + 1; minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y); });
      const keys = Object.keys(months).sort();
      ana.months = keys.map((k) => ({ k, n: months[k], label: MESES[+k.slice(5) - 1] + ' ' + k.slice(0, 4) }));
      const now = new Date(); const fut = recs.filter((r) => r[dk.k] && new Date(r[dk.k].y, r[dk.k].m - 1, r[dk.k].d) > new Date(now.getFullYear(), now.getMonth(), now.getDate() + 31)).length;
      if (fut) add('warn', `${fut} fila(s) tienen fecha en el futuro. Puede ser un error de digitación o de formato de fecha.`);
      const monthly = ana.docType === 'ventas' || ana.slot.id === 'otherlevel';
      if (monthly && keys.length > 1) {
        const main = ana.months.slice().sort((a, b) => b.n - a.n)[0];
        add('warn', `El libro trae fechas de <b>${keys.length} meses</b> (${ana.months.map((x) => esc(x.label) + ': ' + x.n).join(', ')}). Lo normal es un solo mes; el principal es ${esc(main.label)}.`, { periodPick: true });
      } else if (keys.length > 13) add('warn', `Las fechas abarcan ${keys.length} meses (${esc(ana.months[0].label)} a ${esc(ana.months[keys.length - 1].label)}). Verifica que sea el período correcto.`);
      else if (maxY - minY > 1) add('warn', `Hay fechas de años muy distintos (${minY} a ${maxY}). Revisa el formato de fecha.`);
    }
    // Duplicados exactos
    const seen = new Map(); let dups = 0;
    recs.forEach((r) => { const k = JSON.stringify(Object.entries(r).filter(([k]) => !k.startsWith('_')).concat([['a', r._acc && r._acc.code]])); if (seen.has(k)) dups++; else seen.set(k, 1); });
    if (dups) add('warn', `${dups} fila(s) están repetidas exactamente. Puede que el reporte se haya exportado o pegado dos veces.`, { dups });
    // Totales
    const sum = (k) => r2(recs.reduce((s, r) => s + (r[k] || 0), 0));
    if (ana.docType === 'modulo' && ex.totalRow) {
      const t = ex.totalRow.nums[ex.totalRow.nums.length - 1]; const s = sum('monto');
      if (Math.abs(t - s) > 0.05) add('bad', `El total que trae el propio reporte (${fmtN(t)}) no coincide con la suma de las líneas (${fmtN(s)}). Diferencia: <b>${fmtN(r2(t - s))}</b>. Puede faltar información o haber filas ocultas.`);
      else add('ok', `El total del reporte (${fmtN(t)}) coincide con la suma de las líneas.`);
    }
    if (ana.docType === 'bc') {
      const D = sum('debe'), H = sum('haber');
      if (Math.abs(D - H) > 1) add('bad', `Los débitos (${fmtN(D)}) y créditos (${fmtN(H)}) no cuadran. Diferencia: <b>${fmtN(r2(D - H))}</b>. Puede ser un balance exportado con filtro o incompleto.`);
      else add('ok', `Débitos y créditos cuadran (${fmtN(D)}).`);
      if (o.map.si === undefined && o.map.sf === undefined) add('info', 'No se encontraron columnas de saldo inicial ni final; se calcularán con débitos y créditos.');
    }
    if (ana.docType === 'mayor') {
      const neg = recs.filter((r) => r.debe < 0 || r.haber < 0).length;
      if (neg) add('warn', `${neg} movimiento(s) tienen montos negativos en Debe o Haber. Puede que las columnas estén invertidas o que el sistema exporte las reversiones con signo.`);
      if (o.map.saldo === undefined && !ex.accs.some((a) => a.opening !== undefined)) add('warn', 'El archivo no trae saldo inicial ni columna de saldo, así que se toma <b>saldo inicial 0</b> en cada cuenta. Si alguna cuenta tenía saldo al empezar el período, exporta el mayor con saldos para que el saldo final sea el real.');
      if (ex.accs.some((a) => !/\./.test(a.code))) add('warn', 'Los códigos de cuenta vienen sin puntos. Escribe abajo la máscara del plan de cuentas (por ejemplo #.#.##.###) para separarlos.');
      if (ana.slot.id === 'atr' && ex.accs.some((a) => !/^\d+(\.\d+){2,}$/.test(a.code))) add('warn', 'El conciliador necesita códigos con al menos tres niveles (por ejemplo 2.1.01). Ajusta la máscara del código.');
    }
    if (ana.docType === 'ventas') {
      const badIva = recs.filter((r) => r.c_base && r.c_alic && r.c_iva && Math.abs(r.c_base * r.c_alic / 100 - r.c_iva) > Math.max(0.05, Math.abs(r.c_iva) * 0.001)).length;
      if (badIva) add('info', `${badIva} factura(s) tienen IVA distinto de base × alícuota. El validador las va a señalar en detalle.`);
    }
    return out;
  }

  // ======================= escritura del archivo ordenado =======================
  function buildAoA(ana, ex) {
    const o = ana.opt; let recs = ex.recs.filter((r) => !r._badDate);
    const dk = DOCS[ana.docType].fields.find((f) => f.type === 'date' && f.req);
    if (o.onlyMonth && dk) recs = recs.filter((r) => r[dk.k] && (r[dk.k].y + '-' + String(r[dk.k].m).padStart(2, '0')) === o.onlyMonth);
    if (o.dropDups) { const seen = new Set(); recs = recs.filter((r) => { const k = JSON.stringify(Object.entries(r).filter(([k]) => !k.startsWith('_')).concat([['a', r._acc && r._acc.code]])); if (seen.has(k)) return false; seen.add(k); return true; }); }
    if (ana.docType === 'modulo') {
      const t = o.modType || 'CXP';
      const aoa = [['Transacciones ' + t + (t === 'CXP' ? ' · Cuentas por pagar' : ' · Cuentas por cobrar')], [], ['Fecha', t === 'CXP' ? 'Proveedor' : 'Cliente', 'Tipo', 'Referencia', 'Documento', 'Total Bs', 'Contable (fecha)']];
      recs.forEach((r) => aoa.push([fmtDate(r.fecha), r.tercero || '', r.tipo || '', r.referencia || '', r.documento || '', r.monto || 0, fmtDate(r.fechaCont)]));
      const total = ex.totalRow && !o.onlyMonth && !o.dropDups ? ex.totalRow.nums[ex.totalRow.nums.length - 1] : r2(recs.reduce((s, r) => s + (r.monto || 0), 0));
      aoa.push(['TOTAL GENERAL', '', '', '', '', total]);
      return aoa;
    }
    if (ana.docType === 'mayor') {
      const aoa = [['Fecha', 'Detalle', 'Referencia', 'Saldo Inicial', 'Debe', 'Haber', 'Saldo']];
      const order = []; const by = new Map();
      recs.forEach((r) => { const a = r._acc; if (!by.has(a)) { by.set(a, []); order.push(a); } by.get(a).push(r); });
      ex.accs.forEach((a) => { if (!by.has(a) && a.opening) { by.set(a, []); order.push(a); } });
      order.sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
      const hasSaldo = o.map.saldo !== undefined;
      for (const a of order) {
        const L = by.get(a);
        aoa.push([a.code + ' - ' + a.name, '', '', '', '', '', '']);
        let open = a.opening;
        if (open === undefined && !hasSaldo) open = 0;
        if (open === undefined && hasSaldo && L.length && L[0].saldo !== null && L[0].saldo !== undefined) open = r2(L[0].saldo - L[0].debe + L[0].haber);
        const known = open !== undefined;
        let run = known ? open : 0;
        if (known) aoa.push([L.length ? fmtDate(L[0].fecha) : '', 'Saldos Iniciales', '', open, '', '', open]);
        let D = 0, H = 0;
        for (const r of L) { run = r2(run + r.debe - r.haber); D += r.debe; H += r.haber; aoa.push([fmtDate(r.fecha), r.detalle || r.referencia || 'Movimiento', r.referencia || '', '', r.debe || 0, r.haber || 0, known ? run : '']); }
        if (known) aoa.push(['Total ' + a.code, open, r2(D), r2(H), r2(D - H), run]);
      }
      return aoa;
    }
    if (ana.docType === 'bc') {
      const aoa = [['', '', 'Saldo Inicial', 'Debe', 'Haber', 'Saldo Final']];
      recs.forEach((r) => {
        const d = r.debe || 0, h = r.haber || 0;
        let si = r.si, sf = r.sf;
        if (si == null && sf == null) { si = 0; sf = r2(d - h); } else if (si == null) si = r2(sf - d + h); else if (sf == null) sf = r2(si + d - h);
        aoa.push([String(r.codigo), r.nombre || '', si, d, h, sf]);
      });
      return aoa;
    }
    if (ana.docType === 'ventas') {
      const cols = [['fecha', 'Fecha'], ['serie', 'Serial Máquina'], ['rif', 'RIF'], ['nombre', 'Nombre o Razón Social'], ['factura', 'N° Factura'], ['nd', 'N° Nota de Débito'], ['nc', 'N° Nota de Crédito'],
        ['control', 'N° Control'], ['afectada', 'Factura Afectada'], ['c_total', 'Total Ventas'], ['c_exento', 'Ventas Exentas'], ['c_base', 'Base Imponible'], ['c_alic', 'Alícuota %'], ['c_iva', 'IVA'],
        ['comprobante', 'Comprobante de Retención'], ['fcomp', 'Fecha Comprobante'], ['retenido', 'IVA Retenido']];
      const aoa = [cols.map((c) => c[1])];
      recs.forEach((r) => aoa.push(cols.map(([k]) => (k === 'fecha' || k === 'fcomp' ? fmtDate(r[k]) : r[k] == null ? '' : r[k]))));
      return aoa;
    }
    return [];
  }
  async function toFile(ana, aoa) {
    const X = await loadXLSX();
    const ws = X.utils.aoa_to_sheet(aoa); const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, ana.docType === 'mayor' ? 'Mayor' : ana.docType === 'bc' ? 'Balance' : ana.docType === 'ventas' ? 'Libro de ventas' : 'Transacciones');
    const out = X.write(wb, { type: 'array', bookType: 'xlsx', bookSST: true });
    let base = ana.file.name.replace(/\.[^.]+$/, '');
    if (ana.docType === 'modulo') base = base.replace(/\b(CXC|CXP)\b/gi, '').trim() + ' ' + (ana.opt.modType || 'CXP');
    if (ana.docType === 'mayor' && !/MAYOR|AUXILIAR/i.test(base)) base = 'Mayor ' + base;
    return new File([out], base + ' (revisado).xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ======================= formatos guardados =======================
  const signature = (ana) => {
    const r = ana.opt.hdrRow >= 0 ? ana.sheet.rows[ana.opt.hdrRow] || [] : [];
    const lab = r.map((c) => nrm(c)).join('|');
    return ana.docType + '#' + (lab || 'sin-encabezado:' + ana.width + ':' + ana.st.map((s) => (s.date > 0.6 ? 'f' : s.num + s.tnum > 0.6 ? 'n' : s.n ? 't' : '_')).join(''));
  };
  async function findProfile(ana) {
    try {
      const { data } = await Portal.sb.from('import_profiles').select('id,name,config,doc_type,signature').eq('doc_type', ana.docType).eq('signature', signature(ana)).order('last_used_at', { ascending: false, nullsFirst: false }).limit(1);
      return data && data[0] ? data[0] : null;
    } catch (e) { return null; }
  }
  async function saveProfile(ana, name) {
    const cfg = { map: ana.opt.map, hdrRow: ana.opt.hdrRow, sheetName: ana.sheet.name, grouped: ana.opt.grouped, amountMode: ana.opt.amountMode, dateFmt: ana.opt.dateFmt, mask: ana.opt.mask, modType: ana.opt.modType };
    const { error } = await Portal.sb.from('import_profiles').insert({ doc_type: ana.docType, name, signature: signature(ana), config: cfg, created_by: Portal.user.id });
    if (error) throw error;
  }
  function touchProfile(p) { Portal.sb.from('import_profiles').update({ uses: (p.uses || 0) + 1, last_used_at: new Date().toISOString() }).eq('id', p.id).then(() => {}, () => {}); }

  // ======================= IA (Gemini) =======================
  function maskCell(v, hdr) {
    if (typeof v === 'number') return v;
    let s = txt(v); if (!s) return '';
    s = s.replace(/\b[VEJPGC][-\s]?\d{5,9}(?:-?\d)?\b/gi, 'J-XXXXXXXX');
    const h = nrm(hdr || '');
    if (/nombre|cliente|proveedor|razon|beneficiario|tercero/.test(h) && !/cuenta|rif|cedula|factura|tipo|fecha|monto|total|n /.test(h)) return '‹nombre›';
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }
  async function askAI(ana, allSheets) {
    const { data: { session } } = await Portal.sb.auth.getSession();
    const docs = ana.slot.docs.map((k) => ({ clave: k, nombre: DOCS[k].name, campos: Object.fromEntries(DOCS[k].fields.map((f) => [f.k, f.label + (f.req ? ' (obligatorio)' : '')])) }));
    const hojas = allSheets.map((s) => {
      const hr = findHeader(s.rows, DOCS[ana.docType]); const H = hr >= 0 ? s.rows[hr] : [];
      return { nombre: s.name, total_filas: s.rows.length, filas: s.rows.slice(0, 14).map((r, i) => (r || []).slice(0, 20).map((c, j) => (i === hr ? txt(c).slice(0, 40) : maskCell(c, H[j])))) };
    });
    const body = { herramienta: TOOL_NAME[ana.slug], tipos_esperados: docs, archivo: ana.file.name, hojas: hojas.slice(0, 4) };
    const r = await fetch(C.supabaseUrl + '/functions/v1/ai-assist', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseKey, Authorization: 'Bearer ' + (session ? session.access_token : '') }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'La IA no respondió (' + r.status + ')');
    return j.result || {};
  }

  // ======================= análisis de un archivo =======================
  async function analyze(file, slot, slug) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const ana = { file, slot, slug, issues: [] };
    if (slot.exts && !slot.exts.includes(ext) && !SHEETS.includes(ext)) {
      return Object.assign(ana, { status: 'block', reason: `«${file.name}» es un archivo .${ext || '?'}. Esta herramienta recibe hojas de cálculo (${slot.exts.map((e) => '.' + e).join(', ')}).` });
    }
    if (!SHEETS.includes(ext) && slot.onlyIfLooksLike) return Object.assign(ana, { status: 'pass' });
    let book;
    try { book = await readBook(file); }
    catch (e) {
      if (slot.onlyIfLooksLike && (e.code === 'pdf' || e.code === 'img')) return Object.assign(ana, { status: 'pass' });
      return Object.assign(ana, { status: 'block', reason: `«${file.name}»: ${e.message}` });
    }
    ana.book = book;
    const sheets = book.sheets.filter((s) => s.rows.some((r) => r.some((c) => !blank(c))));
    if (!sheets.length) return Object.assign(ana, { status: 'block', reason: `«${file.name}» no tiene datos: todas las hojas están vacías.` });
    const tabular = sheets.some((s) => s.rows.filter((r) => r.filter((c) => !blank(c)).length >= 2).length >= 3);
    if (!tabular) {
      if (slot.onlyIfLooksLike) return Object.assign(ana, { status: 'pass' });
      return Object.assign(ana, { status: 'block', reason: `«${file.name}» no tiene una tabla de datos. Puede estar dañado, ser otro tipo de documento o haberse guardado mal. Ábrelo en Excel, revisa que se vean las columnas y guárdalo de nuevo.` });
    }
    ana.sheets = sheets;
    // ¿Alguna hoja ya está en el formato que la herramienta acepta?
    for (const k of slot.docs) for (const s of sheets) if (ACCEPT[k](s.rows, slot)) { ana.accepted = { docType: k, sheet: s }; break; }
    // Elegir documento y hoja más probables
    let best = null;
    for (const s of sheets) {
      const g = guessDoc(s, file.name);
      for (const k of slot.docs) { const sc = (g.all.find((x) => x.k === k) || {}).sc || 0; if (!best || sc > best.sc) best = { k, s, sc, g }; }
    }
    if (ana.accepted) best = Object.assign(best || {}, { k: ana.accepted.docType, s: ana.accepted.sheet, g: guessDoc(ana.accepted.sheet, file.name) });
    ana.docType = best.k; ana.sheet = best.s;
    // Revisor y Other Level reciben muchos tipos de archivo: solo intervenir si parece un mayor
    if (slot.onlyIfLooksLike && !ana.accepted) {
      const looks = /MAYOR|AUXILIAR/i.test(deacc(file.name)) || best.g.best.k === 'mayor' && best.g.best.sc >= 4;
      if (!looks) return Object.assign(ana, { status: 'pass' });
    }
    const g = best.g;
    if (g.other && !DOCS[ana.docType].keywords.test(g.top)) ana.other = g.other;
    if (g.best && !slot.docs.includes(g.best.k) && g.best.sc >= 6 && (g.all.find((x) => x.k === ana.docType) || {}).sc < g.best.sc - 2) ana.wrongDoc = g.best.k;
    setupOptions(ana);
    // Formato guardado por la firma
    if (!ana.accepted) { const p = await findProfile(ana); if (p) applyProfile(ana, p); }
    recompute(ana);
    const serious = ana.checks.filter((c) => c.sev === 'bad' || c.sev === 'warn');
    if (ana.accepted && !serious.length) return Object.assign(ana, { status: 'pass' });
    if (ana.accepted) return Object.assign(ana, { status: 'review' });
    if (ana.profile && !serious.length && ana.complete) return Object.assign(ana, { status: 'auto' });
    return Object.assign(ana, { status: 'fix' });
  }
  function setupOptions(ana, keepMap) {
    const doc = DOCS[ana.docType]; const rows = ana.sheet.rows;
    const hdrRow = findHeader(rows, doc);
    const am = autoMap(rows, doc, hdrRow);
    const grouped = ana.docType === 'mayor' && rows.slice(0, 400).filter((r) => { const f = (r || []).findIndex((c) => !blank(c)); const sc = f >= 0 && splitCode(r[f]); return sc && (sc.name || (r.filter((c) => !blank(c)).length === 2)) && (r || []).filter((c) => !blank(c)).length <= 2; }).length >= 1;
    const opt = { hdrRow, map: keepMap || am.map, grouped, amountMode: 'dh', dateFmt: 'dmy', mask: '', modType: '', onlyMonth: '', dropDups: false };
    if (ana.docType === 'mayor' && opt.map.debe === undefined && opt.map.haber === undefined && opt.map.monto !== undefined) opt.amountMode = 'signed';
    const dcol = opt.map.fecha;
    if (dcol !== undefined) { opt.dateInfo = detectDateFmt(rows, hdrRow + 1, dcol); opt.dateFmt = opt.dateInfo.ymd ? 'dmy' : opt.dateInfo.fmt; }
    if (ana.docType === 'modulo') {
      const top = deacc(ana.file.name + ' ' + rows.slice(0, Math.max(3, hdrRow + 1)).map((r) => (r || []).join(' ')).join(' ')).toUpperCase();
      opt.modType = /CXC|COBRAR|CLIENTE|VENTA/.test(top) ? 'CXC' : 'CXP';
    }
    const codes = rows.slice(hdrRow + 1, hdrRow + 300).map((r) => { const j = ana.docType === 'bc' ? opt.map.codigo : opt.map.cuenta; const v = j !== undefined ? r && r[j] : r && r.find((c) => !blank(c)); const sc = splitCode(v); return sc && sc.code; }).filter(Boolean);
    if (codes.length && codes.every((c) => /^\d+$/.test(c))) { const L = Math.max(...codes.map((c) => c.length)); opt.mask = L <= 4 ? '#.#.##' : L <= 6 ? '#.#.##.##' : '#.#.##.' + '#'.repeat(Math.max(2, L - 4)); }
    ana.opt = opt; ana.width = am.width; ana.st = am.st;
  }
  function applyProfile(ana, p) {
    const c = p.config || {};
    const s = ana.sheets.find((x) => x.name === c.sheetName); if (s) ana.sheet = s;
    Object.assign(ana.opt, { map: c.map || ana.opt.map, hdrRow: c.hdrRow ?? ana.opt.hdrRow, grouped: c.grouped ?? ana.opt.grouped, amountMode: c.amountMode || ana.opt.amountMode, dateFmt: c.dateFmt || ana.opt.dateFmt, mask: c.mask ?? ana.opt.mask, modType: c.modType || ana.opt.modType });
    ana.profile = p;
  }
  function recompute(ana) {
    const doc = DOCS[ana.docType];
    const m = ana.opt.map;
    const reqMissing = doc.fields.filter((f) => f.req && (m[f.k] === undefined || m[f.k] < 0));
    if (ana.docType === 'mayor') {
      if (!ana.opt.grouped && (m.cuenta === undefined || m.cuenta < 0)) reqMissing.push({ label: 'Cuenta' });
      if (ana.opt.amountMode === 'dh' && (m.debe === undefined || m.haber === undefined)) reqMissing.push({ label: 'Debe y Haber' });
      if (ana.opt.amountMode === 'signed' && m.monto === undefined) reqMissing.push({ label: 'Monto con signo' });
    }
    ana.missing = reqMissing.map((f) => f.label);
    ana.ex = extract(ana);
    ana.checks = checks(ana, ana.ex);
    if (ana.missing.length) ana.checks.unshift({ sev: 'bad', msg: 'Falta indicar la columna de: <b>' + ana.missing.map(esc).join(', ') + '</b>.' });
    const good = ana.ex.recs.filter((r) => !r._badDate).length;
    ana.complete = !ana.missing.length && good > 0;
  }

  // ======================= ventana del asistente =======================
  let css = false;
  function ensureUI() {
    if (!css) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/assets/asistente.css'; document.head.appendChild(l); css = true; }
    let d = document.getElementById('dlg-assist');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-assist'; d.className = 'dlg asist'; document.body.appendChild(d); }
    return d;
  }
  const SEV = { bad: '⛔', warn: '⚠️', info: 'ℹ️', ok: '✅' };

  function openAssistant(ana) {
    return new Promise((resolve) => {
      const d = ensureUI();
      const doc = () => DOCS[ana.docType];
      let ai = null, aiErr = '', aiBusy = false, showCols = ana.status === 'fix';
      const render = () => {
        const o = ana.opt; const rows = ana.sheet.rows;
        const hdr = o.hdrRow >= 0 ? rows[o.hdrRow] || [] : [];
        const sample = (j) => { const v = rows.slice(o.hdrRow + 1, o.hdrRow + 40).filter((r) => r && r.filter((c) => !blank(c)).length > 1).map((r) => r[j]).find((x) => !blank(x)); return v === undefined ? '' : txt(typeof v === 'number' && v > 20000 && v < 80000 && Number.isInteger(v) ? fmtDate(toDate(v)) : v).slice(0, 24); };
        const colOpts = (sel) => `<option value="-1">— No está en el archivo —</option>` + Array.from({ length: ana.width }, (_, j) => `<option value="${j}" ${sel === j ? 'selected' : ''}>${colL(j)} · ${esc(txt(hdr[j]) || 'sin título')}${sample(j) ? ' — ej: ' + esc(sample(j)) : ''}</option>`).join('');
        const fields = doc().fields.filter((f) => !(ana.docType === 'mayor' && ((o.amountMode === 'signed' && (f.k === 'debe' || f.k === 'haber')) || (o.amountMode === 'dh' && f.k === 'monto') || (o.grouped && (f.k === 'cuenta' || f.k === 'cuentaNombre')))));
        const prev = buildAoA(ana, ana.ex).slice(0, 9);
        const status = ana.edited && ana.accepted ? 'Con tus ajustes, la herramienta recibirá una versión ordenada del archivo.' : ana.status === 'review' ? 'El formato es el correcto, pero encontré algo que conviene revisar.'
          : ana.profile ? `Se aplicó el formato guardado <b>«${esc(ana.profile.name)}»</b>.`
            : 'Este archivo no viene en el formato que espera la herramienta. Revisa las columnas propuestas y continúa.';
        d.innerHTML = `<form method="dialog" class="as-wrap">
          <div class="as-head"><div><div class="as-kicker">Asistente de carga · ${esc(TOOL_NAME[ana.slug])}</div><h3>${esc(ana.file.name)}</h3></div>
            <span class="badge">${esc(doc().name)}</span></div>
          <p class="as-status">${status}</p>
          <div class="as-ai">${aiBusy ? '<span class="as-spin"></span> La IA está revisando el archivo…' : aiErr ? '✨ ' + esc(aiErr) + ' <button type="button" class="btn sm" id="as-ask">Reintentar</button>' : !ai ? '✨ ¿Dudas con este archivo? <button type="button" class="btn sm" id="as-ask">Pedir revisión a la IA</button>' : ai ? '✨ <b>IA:</b> ' + esc(ai.explicacion || '') + (ai.es_otro_documento ? ' <b>Parece: ' + esc(ai.es_otro_documento) + '.</b>' : '') + (ai._diff ? ` <button type="button" class="btn sm" id="as-apply-ai">Usar columnas sugeridas por la IA</button>` : '') : ''}</div>
          <ul class="as-checks">${ana.checks.map((c) => `<li class="${c.sev}"><span>${SEV[c.sev]}</span><div>${c.msg}${c.periodPick ? `<div class="as-inline">Usar: <select id="as-month"><option value="">todos los meses</option>${ana.months.map((m) => `<option value="${m.k}" ${o.onlyMonth === m.k ? 'selected' : ''}>solo ${esc(m.label)} (${m.n})</option>`).join('')}</select></div>` : ''}${c.dups ? `<label class="as-inline"><input type="checkbox" id="as-dups" ${o.dropDups ? 'checked' : ''}> Quitar las filas repetidas</label>` : ''}</div></li>`).join('') || '<li class="ok"><span>✅</span><div>Todo en orden.</div></li>'}</ul>
          ${ana.status === 'review' && !showCols ? `<p><button type="button" class="btn sm ghost" id="as-showcols">Ver o ajustar columnas</button></p>` : ''}
          <div class="as-cols ${showCols ? '' : 'hide'}">
            <div class="as-grid">
              ${ana.slot.docs.length > 1 ? `<label>Tipo de documento<select id="as-doc">${ana.slot.docs.map((k) => `<option value="${k}" ${k === ana.docType ? 'selected' : ''}>${esc(DOCS[k].name)}</option>`).join('')}</select></label>` : ''}
              ${ana.sheets.length > 1 ? `<label>Hoja<select id="as-sheet">${ana.sheets.map((s, i) => `<option value="${i}" ${s === ana.sheet ? 'selected' : ''}>${esc(s.name)} (${s.rows.length} filas)</option>`).join('')}</select></label>` : ''}
              <label>Fila de títulos<select id="as-hdr"><option value="-1" ${o.hdrRow < 0 ? 'selected' : ''}>No tiene títulos</option>${rows.slice(0, 30).map((r, i) => `<option value="${i}" ${o.hdrRow === i ? 'selected' : ''}>Fila ${i + 1}: ${esc((r || []).filter((c) => !blank(c)).map(txt).join(' | ').slice(0, 70))}</option>`).join('')}</select></label>
              ${o.map.fecha !== undefined ? `<label>Las fechas vienen como<select id="as-dfmt"><option value="dmy" ${o.dateFmt === 'dmy' ? 'selected' : ''}>día/mes/año</option><option value="mdy" ${o.dateFmt === 'mdy' ? 'selected' : ''}>mes/día/año</option></select></label>` : ''}
              ${ana.docType === 'modulo' ? `<label>El reporte es de<select id="as-mod"><option value="CXP" ${o.modType === 'CXP' ? 'selected' : ''}>Cuentas por pagar (CXP)</option><option value="CXC" ${o.modType === 'CXC' ? 'selected' : ''}>Cuentas por cobrar (CXC)</option></select></label>` : ''}
              ${ana.docType === 'mayor' ? `<label>Las cuentas vienen<select id="as-grp"><option value="1" ${o.grouped ? 'selected' : ''}>Como títulos (código - nombre) encima de sus movimientos</option><option value="0" ${!o.grouped ? 'selected' : ''}>En una columna en cada fila</option></select></label>
                <label>Los montos vienen<select id="as-amt"><option value="dh" ${o.amountMode === 'dh' ? 'selected' : ''}>En dos columnas: Debe y Haber</option><option value="signed" ${o.amountMode === 'signed' ? 'selected' : ''}>En una columna con signo (+ debe / − haber)</option></select></label>` : ''}
              ${(ana.docType === 'mayor' || ana.docType === 'bc') ? `<label>Máscara del código (solo si viene sin puntos)<input id="as-mask" value="${esc(o.mask)}" placeholder="#.#.##.###"></label>` : ''}
            </div>
            <h4>¿Qué columna es cada dato?</h4>
            <div class="as-grid">${fields.map((f) => `<label>${esc(f.label)}${f.req ? ' <b class="req">*</b>' : ''}<select data-f="${f.k}">${colOpts(o.map[f.k])}</select></label>`).join('')}</div>
            <h4>Así lo va a recibir la herramienta</h4>
            <div class="as-prev"><table>${prev.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${esc(typeof c === 'number' ? fmtN(c) : c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table></div>
            <p class="as-note">${ana.ex.recs.filter((r) => !r._badDate).length} fila(s) de datos${ana.docType === 'mayor' ? ' en ' + ana.ex.accs.length + ' cuenta(s)' : ''}.</p>
          </div>
          <div class="as-foot">
            ${ana.status !== 'review' ? `<label class="as-save"><input type="checkbox" id="as-save" ${ana.profile ? '' : 'checked'}> Recordar este formato para toda la firma como <input id="as-pname" value="${esc(ana.profile ? ana.profile.name : defaultName())}"></label>` : ''}
            <div class="as-btns">
              <button type="button" class="btn ghost danger" id="as-skip">Quitar archivo</button>
              ${ana.accepted || ana.status === 'fix' ? `<button type="button" class="btn" id="as-orig">Usar el original sin cambios</button>` : ''}
              <button type="button" class="btn primary" id="as-ok" ${ana.complete || ana.status === 'review' ? '' : 'disabled'}>${ana.status === 'review' && !showCols ? 'Continuar' : 'Continuar con el archivo ordenado'}</button>
            </div>
          </div></form>`;
        wire();
      };
      const defaultName = () => { const b = ana.file.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').replace(/\b(19|20)\d{2}\b|\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\b/gi, '').replace(/\s+/g, ' ').trim(); return (b || DOCS[ana.docType].name).slice(0, 60); };
      const wire = () => {
        const $ = (s) => d.querySelector(s);
        const re = (fn) => (e) => { fn(e); recompute(ana); if (ana.status === 'review') { ana.status = 'fix'; ana.edited = true; showCols = true; } render(); };
        d.querySelectorAll('select[data-f]').forEach((s) => s.onchange = re(() => { const v = +s.value; if (v < 0) delete ana.opt.map[s.dataset.f]; else { for (const k in ana.opt.map) if (ana.opt.map[k] === v) delete ana.opt.map[k]; ana.opt.map[s.dataset.f] = v; } }));
        if ($('#as-doc')) $('#as-doc').onchange = re((e) => { ana.docType = e.target.value; ana.profile = null; setupOptions(ana); });
        if ($('#as-sheet')) $('#as-sheet').onchange = re((e) => { ana.sheet = ana.sheets[+e.target.value]; ana.profile = null; setupOptions(ana); });
        if ($('#as-hdr')) $('#as-hdr').onchange = re((e) => { const h = +e.target.value; const am = autoMap(ana.sheet.rows, DOCS[ana.docType], h); ana.opt.hdrRow = h; ana.opt.map = am.map; ana.width = am.width; ana.st = am.st; });
        if ($('#as-dfmt')) $('#as-dfmt').onchange = re((e) => { ana.opt.dateFmt = e.target.value; });
        if ($('#as-mod')) $('#as-mod').onchange = re((e) => { ana.opt.modType = e.target.value; });
        if ($('#as-grp')) $('#as-grp').onchange = re((e) => { ana.opt.grouped = e.target.value === '1'; });
        if ($('#as-amt')) $('#as-amt').onchange = re((e) => { ana.opt.amountMode = e.target.value; });
        if ($('#as-mask')) $('#as-mask').onchange = re((e) => { ana.opt.mask = e.target.value.trim(); });
        if ($('#as-month')) $('#as-month').onchange = re((e) => { ana.opt.onlyMonth = e.target.value; });
        if ($('#as-dups')) $('#as-dups').onchange = re((e) => { ana.opt.dropDups = e.target.checked; });
        if ($('#as-showcols')) $('#as-showcols').onclick = () => { showCols = true; render(); };
        if ($('#as-ask')) $('#as-ask').onclick = () => runAI();
        if ($('#as-apply-ai')) $('#as-apply-ai').onclick = re(() => applyAI(true));
        $('#as-skip').onclick = () => done(null);
        if ($('#as-orig')) $('#as-orig').onclick = () => done(ana.file);
        $('#as-ok').onclick = async () => {
          const b = $('#as-ok'); b.disabled = true;
          if (ana.status === 'review' && !showCols) { done(ana.file); return; }
          try {
            const f = await toFile(ana, buildAoA(ana, ana.ex));
            const sv = $('#as-save');
            if (sv && sv.checked) { const nm = ($('#as-pname').value || '').trim() || defaultName(); try { await saveProfile(ana, nm); Portal.toast && Portal.toast('Formato «' + nm + '» guardado para toda la firma'); } catch (e) { Portal.toast && Portal.toast('No se pudo guardar el formato: ' + e.message); } }
            else if (ana.profile) touchProfile(ana.profile);
            done(f);
          } catch (e) { b.disabled = false; alert('No se pudo preparar el archivo: ' + e.message); }
        };
      };
      const applyAI = (force) => {
        if (!ai) return;
        const k = ai.tipo && ana.slot.docs.includes(ai.tipo) ? ai.tipo : ana.docType;
        const sh = typeof ai.hoja === 'number' && ana.sheets[ai.hoja] ? ana.sheets[ai.hoja] : ana.sheet;
        if (k !== ana.docType || sh !== ana.sheet) { ana.docType = k; ana.sheet = sh; setupOptions(ana); }
        const map = {}; const cols = ai.columnas || {};
        for (const f of DOCS[k].fields) { const v = cols[f.k]; if (typeof v === 'number' && v >= 0 && v < 200) map[f.k] = v; }
        if (force || !ana.complete) {
          ana.opt.map = map;
          if (typeof ai.fila_encabezado === 'number') ana.opt.hdrRow = ai.fila_encabezado;
          const op = ai.opciones || {};
          if (op.formato_fecha === 'mdy') ana.opt.dateFmt = 'mdy';
          if (k === 'mayor' && op.montos === 'monto_con_signo' && map.monto !== undefined && map.debe === undefined) ana.opt.amountMode = 'signed';
          if (k === 'modulo' && (op.tipo_modulo === 'CXP' || op.tipo_modulo === 'CXC')) ana.opt.modType = op.tipo_modulo;
          ana.aiApplied = true; ai._diff = false;
        } else {
          ai._diff = Object.keys(map).some((f) => map[f] !== ana.opt.map[f]);
        }
      };
      const done = (val) => { d.close(); resolve(val); };
      d.oncancel = (e) => { e.preventDefault(); };
      render();
      d.showModal();
      d.scrollTop = 0;
      // Pedir a la IA su lectura del archivo (solo si hay algo que revisar)
      // La IA se consulta sola solo cuando hace falta (columnas sin identificar o documento dudoso), para cuidar el límite gratuito
      function runAI() {
        aiBusy = true; aiErr = ''; render();
        askAI(ana, ana.sheets).then((res) => { ai = res; aiBusy = false; const before = ana.complete; applyAI(false); recompute(ana); if (!before && ana.complete) ai.explicacion = (ai.explicacion || '') + ' Ya completé las columnas con su sugerencia; revísalas.'; render(); })
          .catch((e) => { aiBusy = false; aiErr = e.message; render(); });
      }
      if ((ana.status === 'fix' && !ana.complete) || ana.other || ana.wrongDoc) runAI();
    });
  }

  // ======================= punto de entrada =======================
  Portal.assist = async function (slug, slotId, files) {
    const slot = (SLOTS[slug] || []).find((s) => s.id === slotId);
    if (!slot) return files;
    const out = [];
    for (const f of files) {
      let ana;
      try { ana = await analyze(f, slot, slug); }
      catch (e) { console.error(e); out.push(f); continue; }
      if (ana.status === 'pass') { out.push(f); continue; }
      if (ana.status === 'block') { await blockDialog(ana); continue; }
      if (ana.status === 'auto') {
        try { out.push(await toFile(ana, buildAoA(ana, ana.ex))); touchProfile(ana.profile); Portal.toast && Portal.toast('Formato «' + ana.profile.name + '» aplicado a ' + f.name); }
        catch (e) { out.push(f); }
        continue;
      }
      const r = await openAssistant(ana);
      if (r) out.push(r);
    }
    return out;
  };
  function blockDialog(ana) {
    return new Promise((resolve) => {
      const d = ensureUI();
      d.innerHTML = `<div class="as-wrap"><div class="as-head"><div><div class="as-kicker">Asistente de carga · ${esc(TOOL_NAME[ana.slug])}</div><h3>No se puede usar este archivo</h3></div></div>
        <ul class="as-checks"><li class="bad"><span>⛔</span><div>${esc(ana.reason)}</div></li></ul>
        <div class="as-foot"><div class="as-btns"><button class="btn primary" id="as-close">Entendido</button></div></div></div>`;
      d.querySelector('#as-close').onclick = () => { d.close(); resolve(); };
      d.oncancel = () => resolve();
      d.showModal();
    });
  }

  // Para las pruebas automáticas
  Portal._assistTest = { toNum, toDate, analyze, buildAoA, extract, DOCS, SLOTS, ACCEPT, readBook };
})();
