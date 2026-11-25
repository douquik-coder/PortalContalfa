/* Portal Contalfa · fondo animado (red neuronal + cifras contables). Solo decorativo. */
(function () {
  'use strict';
  const cv = document.getElementById('fx');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GLYPHS = ['Σ', '%', '∆', 'Bs', '$', '0', '1', '16%', 'IVA', 'ISLR', '∫', '±', '÷', '≈', '€'];
  let W = 0, H = 0, dpr = 1, nodes = [], glyphs = [], mouse = { x: -999, y: -999 }, last = 0;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(90, Math.max(28, (W * H) / 16000)));
    nodes = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
      r: Math.random() * 1.6 + 0.8, g: Math.random() < 0.3
    }));
    glyphs = Array.from({ length: Math.round(n / 3) }, () => newGlyph(true));
  }
  function newGlyph(anywhere) {
    return {
      t: GLYPHS[(Math.random() * GLYPHS.length) | 0],
      x: Math.random() * W, y: anywhere ? Math.random() * H : H + 20,
      v: Math.random() * 0.25 + 0.08, s: Math.random() * 8 + 10, a: Math.random() * 0.12 + 0.05
    };
  }

  function busy() { const t = document.getElementById('p-tool'); return t && !t.classList.contains('hide') && !document.getElementById('v-app').classList.contains('hide'); }

  function draw(ts) {
    if (!still) {
      requestAnimationFrame(draw);
      if (document.hidden || busy()) return;
      if (ts - last < 30) return; // ~30 fps: suficiente y liviano
    }
    last = ts;
    ctx.clearRect(0, 0, W, H);

    ctx.textAlign = 'center';
    for (const g of glyphs) {
      g.y -= g.v;
      if (g.y < -20) Object.assign(g, newGlyph(false));
      ctx.font = '600 ' + g.s + 'px ui-monospace,Menlo,Consolas,monospace';
      ctx.fillStyle = 'rgba(111,214,245,' + g.a + ')';
      ctx.fillText(g.t, g.x, g.y);
    }

    const LINK = 130;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      a.x += a.vx; a.y += a.vy;
      if (a.x < 0 || a.x > W) a.vx *= -1;
      if (a.y < 0 || a.y > H) a.vy *= -1;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = dx * dx + dy * dy;
        if (d < LINK * LINK) {
          const o = (1 - Math.sqrt(d) / LINK) * 0.35;
          ctx.strokeStyle = (a.g || b.g) ? 'rgba(141,198,63,' + o + ')' : 'rgba(41,196,240,' + o + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      const md = Math.hypot(a.x - mouse.x, a.y - mouse.y);
      if (md < 170) {
        ctx.strokeStyle = 'rgba(191,243,255,' + (1 - md / 170) * 0.45 + ')';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
      }
    }
    for (const a of nodes) {
      ctx.fillStyle = a.g ? 'rgba(160,220,90,.85)' : 'rgba(120,220,250,.85)';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  size();
  addEventListener('resize', () => { size(); if (still) draw(0); });
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  addEventListener('pointerleave', () => { mouse.x = mouse.y = -999; });
  if (still) draw(0); else requestAnimationFrame(draw);
})();
