// Shared browser helpers: API calls, saved identities, the chart board, the theme picker and share images.
import { THEMES, THEME_GROUPS } from './lib/themes.js';

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-token'] = token;
  const now = sessionStorage.getItem('fc:now'); // local test hook only; ignored by production
  if (now) headers['x-now'] = now;
  let r;
  try {
    r = await fetch('/api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || 'Something went wrong.');
    e.status = r.status;
    throw e;
  }
  return data;
}

// Identity per chart: { token, memberId } in localStorage. The last nickname is remembered for the next chart.
export const ident = {
  get(id) {
    try {
      return JSON.parse(localStorage.getItem('fc:' + id) || 'null');
    } catch {
      return null;
    }
  },
  set(id, v) {
    try {
      localStorage.setItem('fc:' + id, JSON.stringify(v));
    } catch {}
  },
  drop(id) {
    try {
      localStorage.removeItem('fc:' + id);
    } catch {}
  },
  get name() {
    try {
      return localStorage.getItem('fc:name') || '';
    } catch {
      return '';
    }
  },
  set name(v) {
    try {
      localStorage.setItem('fc:name', v);
    } catch {}
  },
};

export function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h(`<div class="toast" role="status">${esc(msg)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

export async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  await copy(url);
}
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    window.prompt('Copy this link:', text);
  }
}

// ---------- Board ----------
const PAD = 0.07; // keep dots off the very edge
export const toView = (v) => PAD + v * (1 - 2 * PAD);
export const fromView = (v) => Math.min(1, Math.max(0, (v - PAD) / (1 - 2 * PAD)));

export function buildBoard(theme) {
  const el = h(`<div class="board" role="application" aria-label="${esc(theme.title)} chart"></div>`);
  const lines = [];
  if (theme.kind === 'grid') {
    for (const f of [1 / 3, 2 / 3]) {
      lines.push(`<line x1="${f * 100}" y1="0" x2="${f * 100}" y2="100" />`, `<line x1="0" y1="${f * 100}" x2="100" y2="${f * 100}" />`);
    }
  } else {
    lines.push('<line x1="50" y1="0" x2="50" y2="100" />', '<line x1="0" y1="50" x2="100" y2="50" />');
  }
  el.innerHTML = `<svg class="bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4ec"/><stop offset="1" stop-color="#f1edff"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#g1)"/>
    <g stroke="#ddd3e8" stroke-width="0.5" vector-effect="non-scaling-stroke">${lines.join('')}</g></svg>`;
  if (theme.kind === 'grid') {
    theme.cells.forEach((c, i) => {
      const cell = h(`<div class="cell">${esc(c)}</div>`);
      cell.style.left = `${(i % 3) * 33.333}%`;
      cell.style.top = `${Math.floor(i / 3) * 33.333}%`;
      el.append(cell);
    });
    el.append(h(`<div class="lbl l" style="top:auto;bottom:8px;transform:none">← ${esc(theme.x[0])}</div>`));
    el.append(h(`<div class="lbl r" style="top:auto;bottom:8px;transform:none">${esc(theme.x[1])} →</div>`));
  } else {
    el.append(h(`<div class="lbl t">${esc(theme.y[0])}</div>`), h(`<div class="lbl b">${esc(theme.y[1])}</div>`));
    el.append(h(`<div class="lbl l">${esc(theme.x[0])}</div>`), h(`<div class="lbl r">${esc(theme.x[1])}</div>`));
  }
  return el;
}

export function dotEl(m) {
  const d = h(`<div class="dot" data-id="${esc(m.id)}"><div class="b" style="background:${esc(m.color)}">${esc(m.emoji)}</div><div class="n">${esc(m.name)}</div></div>`);
  return d;
}
export function setPos(el, p) {
  el.style.left = `${toView(p[0]) * 100}%`;
  el.style.top = `${toView(p[1]) * 100}%`;
}
export function boardPoint(board, clientX, clientY) {
  const r = board.getBoundingClientRect();
  return [fromView((clientX - r.left) / r.width), fromView((clientY - r.top) / r.height)];
}

// ---------- Theme picker ----------
export function axisSummary(t) {
  return t.kind === 'grid' ? `3×3 · ${t.x[0]} ↔ ${t.x[1]}` : `${t.x[0]} ↔ ${t.x[1]}`;
}
export function pickerHtml(selected) {
  const feat = THEMES[0];
  let out = `<button type="button" class="featured" data-theme="${feat.id}"><span class="e">${feat.emoji}</span><span><small>Chart of the season</small><b>${esc(feat.title)}</b><small>${esc(feat.x[0])} ↔ ${esc(feat.x[1])} · ${esc(feat.y[0])} ↔ ${esc(feat.y[1])}</small></span></button>`;
  for (const g of THEME_GROUPS) {
    const list = THEMES.filter((t) => t.group === g.id);
    out += `<h3>${esc(g.label)}</h3><div class="themes">`;
    for (const t of list) out += `<button type="button" class="theme" data-theme="${t.id}" aria-pressed="${t.id === selected}"><span class="e">${t.emoji}</span><span><b>${esc(t.title)}</b><small>${esc(axisSummary(t))}</small></span></button>`;
    out += '</div>';
  }
  out += `<h3>Make your own</h3><div class="themes"><button type="button" class="theme" data-theme="custom"><span class="e">✏️</span><span><b>Custom chart</b><small>Write your own two axes</small></span></button></div>`;
  return `<div class="picker">${out}</div>`;
}

export function sheet(inner) {
  const bg = h(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true"></div></div>`);
  const s = bg.firstElementChild;
  s.append(inner);
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => e.target === bg && close());
  document.body.append(bg);
  return { el: s, close };
}

// ---------- Share images (canvas) ----------
function rr(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const FONT = "ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
function fitText(ctx, text, max, size, weight = 800) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= max) break;
    s -= 2;
  } while (s > 14);
  return s;
}
function pill(ctx, text, cx, cy, size = 26) {
  ctx.font = `800 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 1.1;
  const hh = size * 1.6;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  rr(ctx, cx - w / 2, cy - hh / 2, w, hh, hh / 2);
  ctx.fill();
  ctx.strokeStyle = '#ece4da';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#4b4560';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1);
}

/** Draws the chart square with dots at `pts` (array of {m, p, self}) at x,y,size. */
function drawChart(ctx, theme, x, y, size, pts, { rings = true } = {}) {
  ctx.save();
  rr(ctx, x, y, size, size, 36);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#fff4ec');
  g.addColorStop(1, '#f1edff');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#ddd3e8';
  ctx.lineWidth = 3;
  const fr = theme.kind === 'grid' ? [1 / 3, 2 / 3] : [0.5];
  for (const f of fr) {
    ctx.beginPath();
    ctx.moveTo(x + f * size, y);
    ctx.lineTo(x + f * size, y + size);
    ctx.moveTo(x, y + f * size);
    ctx.lineTo(x + size, y + f * size);
    ctx.stroke();
  }
  if (theme.kind === 'grid') {
    ctx.fillStyle = '#8a83a0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    theme.cells.forEach((c, i) => {
      fitText(ctx, c.toUpperCase(), size / 3 - 20, 22);
      ctx.fillText(c.toUpperCase(), x + ((i % 3) + 0.5) * (size / 3), y + Math.floor(i / 3) * (size / 3) + 14);
    });
  } else {
    pill(ctx, theme.y[0], x + size / 2, y + 30);
    pill(ctx, theme.y[1], x + size / 2, y + size - 30);
    ctx.save();
    ctx.textAlign = 'left';
    pill(ctx, theme.x[0], x + 20 + measure(ctx, theme.x[0]) / 2, y + size / 2);
    pill(ctx, theme.x[1], x + size - 20 - measure(ctx, theme.x[1]) / 2, y + size / 2);
    ctx.restore();
  }
  const P = (v) => toView(v) * size;
  if (rings) {
    for (const { m, p, self } of pts) {
      if (!self) continue;
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + P(self[0]), y + P(self[1]));
      ctx.lineTo(x + P(p[0]), y + P(p[1]));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + P(self[0]), y + P(self[1]), 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }
  for (const { m, p } of pts) {
    const cx = x + P(p[0]);
    const cy = y + P(p[1]);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `36px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.emoji, cx, cy + 2);
    ctx.font = `800 24px ${FONT}`;
    const w = ctx.measureText(m.name).width + 22;
    ctx.fillStyle = '#1f1b2e';
    rr(ctx, cx - w / 2, cy + 40, w, 34, 17);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(m.name, cx, cy + 58);
  }
  ctx.restore();
}
function measure(ctx, t) {
  ctx.font = `800 26px ${FONT}`;
  return ctx.measureText(t).width + 28;
}

function frame(ctx, W, H) {
  ctx.fillStyle = '#fff8f1';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f1b2e';
  ctx.font = `800 30px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Chartmates', 90, H - 50);
  ctx.fillStyle = '#6b6578';
  ctx.font = `600 26px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText('Make one for your group · pb-friend-chart.pages.dev', W - 60, H - 50);
  ctx.fillStyle = '#ff5a36';
  ctx.beginPath();
  ctx.arc(70, H - 60, 11, 0, Math.PI * 2);
  ctx.fill();
}

/** Group chart card, 1080×1350 (fits Instagram and WhatsApp). */
export function groupCard(view) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  frame(ctx, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1f1b2e';
  const title = `${view.theme.emoji} ${view.theme.title}`;
  fitText(ctx, title, W - 120, 58, 850);
  ctx.fillText(title, 60, 100);
  ctx.fillStyle = '#6b6578';
  ctx.font = `650 28px ${FONT}`;
  ctx.fillText(`Where our group put each other · ${view.charted} people`, 60, 146);
  const pts = view.results.filter((r) => r.avg).map((r) => ({ m: r, p: r.avg, self: r.self }));
  drawChart(ctx, view.theme, 60, 180, 960, pts);
  const a = view.awards[0];
  if (a) {
    const who = view.results.find((r) => r.id === a.id);
    ctx.fillStyle = '#1f1b2e';
    ctx.textAlign = 'left';
    const t = `🏆 ${a.title}: ${who?.name || ''}`;
    fitText(ctx, t, W - 120, 40, 800);
    ctx.fillText(t, 60, 1210);
  }
  return c;
}

/** Personal card: "I put myself here. My friends put me here." 1080×1350. */
export function meCard(view, r, words) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  frame(ctx, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6b6578';
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(`${view.theme.emoji} ${view.theme.title}`, 60, 84);
  ctx.fillStyle = '#1f1b2e';
  const l1 = `I said: ${words.self}`;
  const l2 = `My friends said: ${words.group}`;
  fitText(ctx, l1, W - 120, 50, 850);
  ctx.fillText(l1, 60, 148);
  ctx.fillStyle = '#ff5a36';
  fitText(ctx, l2, W - 120, 50, 850);
  ctx.fillText(l2, 60, 210);
  drawChart(ctx, view.theme, 120, 250, 840, [{ m: r, p: r.avg, self: r.self }]);
  ctx.fillStyle = '#6b6578';
  ctx.font = `650 28px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`Dashed ring: where I put myself · dot: the average of ${r.n} friend${r.n === 1 ? '' : 's'}`, W / 2, 1150);
  return c;
}

export async function shareCanvas(canvas, name, text) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const { close } = sheet(
    h(`<div class="stack center"><div class="sheet-head"><b>Save the image</b><button class="x" aria-label="Close">×</button></div>
      <img src="${url}" alt="Chart image" style="width:100%;max-width:420px;margin:0 auto;border-radius:14px;box-shadow:var(--shadow)">
      <p class="muted small">On a phone, press and hold the image to save or share it.</p>
      <a class="btn" href="${url}" download="${esc(name)}">Download image</a></div>`),
  );
  document.querySelector('.sheet .x').onclick = close;
}
