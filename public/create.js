// Create-a-chart sheet: pick a theme, then name, group size and when it reveals.
// With { prev }, it starts the next chart for an existing group (the name and size are reused).
import { $, esc, h, api, ident, sheet, pickerHtml, axisSummary } from './common.js';
import { themeById } from './lib/themes.js';
import { LIM, DEADLINES } from './lib/chart.js';

export function openCreate({ prev = null, prevToken = null, themeId = null } = {}) {
  const box = h('<div></div>');
  const s = sheet(box);
  let chosen = themeId;
  let size = 5;
  let hours = 24;

  function step1() {
    box.innerHTML = `<div class="sheet-head"><h2>${prev ? 'Next chart for this group' : 'Pick a chart'}</h2><button class="x" aria-label="Close">×</button></div>
      <p class="muted" style="margin:0 0 12px">Everyone places everyone on it. You can change your mind until the reveal.</p>${pickerHtml(chosen)}`;
    $('.x', box).onclick = s.close;
    box.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => ((chosen = b.dataset.theme), step2())));
  }

  function step2() {
    const t = chosen === 'custom' ? null : themeById(chosen);
    box.innerHTML = `<div class="sheet-head"><button class="linkbtn" data-back>← Charts</button><button class="x" aria-label="Close">×</button></div>
      <form class="stack" novalidate>
        ${t ? `<div class="row nowrap"><span style="font-size:40px;flex:none">${t.emoji}</span><div><h2>${esc(t.title)}</h2><div class="muted small">${esc(axisSummary(t))}${t.kind === 'axes' ? ` · ${esc(t.y[0])} ↔ ${esc(t.y[1])}` : ''}</div></div></div>`
          : `<h2>Your own chart</h2>
          <label class="field">Left ↔ right <span class="hint">(e.g. early bird ↔ night owl)</span>
            <div class="row" style="flex-wrap:nowrap"><input type="text" name="x0" maxlength="${LIM.label}" placeholder="early bird" required><input type="text" name="x1" maxlength="${LIM.label}" placeholder="night owl" required></div></label>
          <label class="field">Top ↔ bottom <span class="hint">(e.g. tidy ↔ chaos)</span>
            <div class="row" style="flex-wrap:nowrap"><input type="text" name="y0" maxlength="${LIM.label}" placeholder="tidy" required><input type="text" name="y1" maxlength="${LIM.label}" placeholder="chaos" required></div></label>
          <p class="muted small" style="margin:0">Keep it fun: charts about looks or anything hurtful are blocked.</p>`}
        ${prev ? '' : `<label class="field">Your nickname<input type="text" name="name" maxlength="${LIM.name}" autocomplete="nickname" placeholder="e.g. Sam" value="${esc(ident.name)}" required></label>
        <div class="field"><b>How many in the group?</b> <span class="muted small">(including you)</span>
          <div class="stepper"><button type="button" data-d="-1" aria-label="Fewer">−</button><output>${size}</output><button type="button" data-d="1" aria-label="More">+</button></div></div>`}
        <div class="field"><b>Reveal</b> <span class="muted small">when everyone has placed everyone, or at the latest in</span>
          <div class="seg" role="group">${DEADLINES.map((d) => `<button type="button" data-h="${d}" aria-pressed="${d === hours}">${d < 24 ? `${d} hours` : d === 24 ? '1 day' : `${d / 24} days`}</button>`).join('')}</div></div>
        <p class="err" aria-live="polite"></p>
        <button class="btn block" type="submit">${prev ? 'Start the next chart' : 'Create chart and get the link'}</button>
      </form>`;
    $('[data-back]', box).onclick = step1;
    $('.x', box).onclick = s.close;
    box.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => {
      size = Math.min(LIM.members, Math.max(LIM.minToReveal, size + Number(b.dataset.d)));
      $('output', box).textContent = size;
    }));
    box.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => {
      hours = Number(b.dataset.h);
      box.querySelectorAll('[data-h]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    const form = $('form', box);
    const first = $('input', box);
    if (first && !first.value) setTimeout(() => first.focus(), 50);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const body = { hours, expected: size };
      if (t) body.themeId = t.id;
      else body.custom = { x: [f.get('x0'), f.get('x1')], y: [f.get('y0'), f.get('y1')] };
      if (prev) body.prev = prev;
      else {
        body.name = String(f.get('name') || '').trim();
        if (!body.name) return ($('.err', box).textContent = 'Please enter your nickname.');
      }
      const btn = $('button[type=submit]', box);
      btn.disabled = true;
      try {
        const r = await api('charts', { method: 'POST', body, token: prevToken });
        if (r.existing) {
          location.href = `/c/${r.existing}`;
          return;
        }
        ident.set(r.id, { token: r.token, memberId: r.memberId, created: true });
        if (body.name) ident.name = body.name;
        location.href = `/c/${r.id}`;
      } catch (err) {
        $('.err', box).textContent = err.message;
        btn.disabled = false;
      }
    };
  }

  if (chosen) step2();
  else step1();
}
