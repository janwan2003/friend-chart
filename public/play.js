// The chart page: join, place everyone, wait, reveal.
import { $, esc, h, api, ident, toast, shareLink, copy, buildBoard, dotEl, setPos, boardPoint, toView, groupCard, meCard, shareCanvas } from './common.js';
import { describe } from './lib/chart.js';
import { openCreate } from './create.js';

const id = (location.pathname.match(/^\/c\/([A-Za-z0-9]{8})/) || [])[1];
const app = $('#app');
let view = null;
let me = ident.get(id);
let pl = {}; // my placements (local, autosaved)
let current = null; // target id being placed
let saveTimer = null;
let saving = false;
let dirty = false;
let pollTimer = null;
let mode = '';
let boardEl = null;

// A personal link (#k=token) lets a member continue on another device.
const k = new URLSearchParams(location.hash.slice(1)).get('k');
if (k && id) {
  ident.set(id, { token: k });
  me = { token: k };
  history.replaceState(null, '', location.pathname);
}

const url = () => `${location.origin}/c/${id}`;
const token = () => (me && me.token) || '';
const fmtLeft = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const hrs = Math.round(m / 60);
  return hrs < 48 ? `${hrs} h` : `${Math.round(hrs / 24)} days`;
};
const inviteText = () => `Where would you put everyone? ${view.theme.emoji} ${view.theme.title}: place the group, and see where they put you.`;
const memberById = (mid) => view.members.find((m) => m.id === mid);
const targets = () => view.members.filter((m) => !m.hidden);

async function load(first = false) {
  try {
    const v = await api(`charts/${id}`, { token: token() });
    if (me && !v.me) {
      // Token no longer valid (e.g. chart re-created). Forget it.
      ident.drop(id);
      me = null;
    } else if (me && v.me && !me.memberId) {
      me.memberId = v.me.id;
      ident.set(id, me);
    }
    const wasRevealed = view && view.revealed;
    view = v;
    if (first && v.me) pl = { ...v.me.placements };
    render(wasRevealed === false && v.revealed);
  } catch (e) {
    if (e.status === 404) return renderGone(e.message);
    if (first) app.innerHTML = `<div class="narrow card center stack" style="margin-top:30px"><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (view && view.revealed) return;
  pollTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible' && !saving && !dirty) await load();
    schedulePoll();
  }, 7000);
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && view && !view.revealed && !dirty && load());

function renderGone(msg) {
  app.innerHTML = `<div class="narrow card center stack" style="margin-top:30px"><div style="font-size:44px">🫥</div><h2>Chart not found</h2><p class="muted">${esc(msg)} Charts are deleted 60 days after they start, or by the person who made them.</p><button class="btn" id="mk">Make a new chart</button></div>`;
  $('#mk').onclick = () => openCreate();
}

function render(justRevealed) {
  document.title = `${view.theme.emoji} ${view.theme.title} · Chartmates`;
  if (view.revealed) {
    if (mode !== 'results' || justRevealed) renderResults(justRevealed || !localStorage.getItem('fc:seen:' + id));
    mode = 'results';
    return;
  }
  if (!view.me) {
    renderJoin();
    mode = 'join';
  } else if (mode !== 'play') {
    renderPlay();
    mode = 'play';
  } else updatePlay();
  schedulePoll();
}

function headHtml() {
  return `<div class="chart-head"><span class="e">${view.theme.emoji}</span><div><h1>${esc(view.theme.title)}</h1><div class="line" id="line">${esc(statusLine())}</div></div></div>`;
}
function statusLine() {
  if (view.revealed) return `Revealed · ${view.charted} people charted`;
  const left = view.deadline - view.now;
  const tail = left > 0 ? ` · reveals when all ${view.groupSize} are in, or in ${fmtLeft(left)}` : view.canReveal ? '' : ' · time is up, waiting for 3 people to place';
  return `${view.doneCount} of ${view.groupSize} have placed everyone${tail}`;
}
function avatarsHtml() {
  return view.members.map((m) => `<div class="person"><span class="av" style="background:${esc(m.color)}">${esc(m.emoji)}</span>${esc(m.name)}${m.id === view.creator ? ' <span class="muted small">· started it</span>' : ''}${m.hidden ? ' <span class="muted small">· off the chart</span>' : ''}<span class="st ${m.done ? 'ok' : ''}">${m.done ? 'placed everyone ✓' : 'placing…'}</span></div>`).join('');
}
function progressHtml() {
  const pct = Math.round((100 * view.doneCount) / Math.max(1, view.groupSize));
  const waiting = view.groupSize - view.members.length;
  return `<b>Who's in</b><div class="progress"><i style="width:${pct}%"></i></div>
    <div class="muted small" style="margin-bottom:10px">${view.doneCount} of ${view.groupSize} done${waiting > 0 ? ` · ${waiting} more to join` : ''}</div>
    <div class="people">${avatarsHtml()}</div>`;
}

// ---------- Join ----------
function renderJoin() {
  const by = memberById(view.creator);
  app.innerHTML = `<div class="play-grid"><div>${headHtml()}
      <div class="card stack">
        <p style="margin:0;font-size:18px"><b>${esc(by ? by.name : 'A friend')}</b> wants to know where the group puts everyone. Join, place your friends in secret, and they'll place you too.</p>
        <form id="join" class="stack" novalidate>
          <label class="field">Your nickname<input type="text" name="name" maxlength="20" autocomplete="nickname" placeholder="the name your friends know" value="${esc(ident.name)}" required></label>
          <p class="err" aria-live="polite"></p>
          <button class="btn block" type="submit">Join and start placing</button>
        </form>
        <p class="muted small" style="margin:0">No sign-up. Nobody sees where you put them, only the group's average after the reveal.</p>
      </div></div>
      <div class="side stack"><div id="preview"></div><div class="card">${progressHtml()}</div></div></div>`;
  $('#preview').append(buildBoard(view.theme));
  const f = $('#join');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const name = String(new FormData(f).get('name') || '').trim();
    if (!name) return ($('.err', f).textContent = 'Please enter your nickname.');
    const btn = $('button', f);
    btn.disabled = true;
    try {
      const r = await api(`charts/${id}/join`, { method: 'POST', body: { name } });
      me = { token: r.token, memberId: r.memberId };
      ident.set(id, me);
      ident.name = name;
      pl = {};
      mode = '';
      await load();
    } catch (err) {
      $('.err', f).textContent = err.message;
      btn.disabled = false;
      if (err.status === 409 && /revealed/.test(err.message)) load();
    }
  };
}

// ---------- Play ----------
function order() {
  const t = targets();
  const mine = t.filter((m) => m.id === view.me.id);
  return [...mine, ...t.filter((m) => m.id !== view.me.id)];
}
function nextUnplaced() {
  const o = order();
  return (o.find((m) => !pl[m.id]) || {}).id || null;
}

function renderPlay() {
  current = nextUnplaced();
  app.innerHTML = `<div class="play-grid"><div>${headHtml()}
      <div class="ask" id="ask" aria-live="polite"></div>
      <div id="boardwrap"></div>
      <div class="tray" id="tray"></div>
      <p class="muted small" style="margin:0">Tap the chart to place the highlighted person, or drag any dot. You can change your mind until the reveal.</p>
    </div>
    <div class="side stack">
      <div class="card invite" id="invite"></div>
      <div class="card" id="progress"></div>
      <div class="card"><b>Options</b><div class="menu" id="menu"></div><p class="err" id="menuerr" style="margin:0;min-height:0"></p></div>
    </div></div>`;
  boardEl = buildBoard(view.theme);
  $('#boardwrap').append(boardEl);
  boardEl.append(h('<div class="hint-tap" id="taphint">Tap where they belong</div>'));
  bindBoard();
  updatePlay();
}

function updatePlay() {
  // Drop placements of people who left the chart.
  const ids = new Set(targets().map((m) => m.id));
  if ((current && !ids.has(current)) || (!current && !document.querySelector('.dot.dragging'))) current = current && ids.has(current) ? current : nextUnplaced();
  $('#line').textContent = statusLine();
  // Dots
  const want = new Set(Object.keys(pl).filter((t) => ids.has(t)));
  boardEl.querySelectorAll('.dot').forEach((d) => !want.has(d.dataset.id) && d.remove());
  for (const tid of want) {
    let d = boardEl.querySelector(`.dot[data-id="${tid}"]`);
    if (!d) {
      d = dotEl(memberById(tid));
      boardEl.append(d);
    }
    if (!d.classList.contains('dragging')) setPos(d, pl[tid]);
    d.classList.toggle('sel', tid === current);
  }
  // Ask line
  const cur = current && memberById(current);
  const all = order().every((m) => pl[m.id]);
  $('#ask').innerHTML = cur
    ? cur.id === view.me.id
      ? `<span class="chip cur"><span class="av" style="background:${esc(cur.color)}">${esc(cur.emoji)}</span>You</span> Where do you put yourself?`
      : `Where does <span class="chip cur"><span class="av" style="background:${esc(cur.color)}">${esc(cur.emoji)}</span>${esc(cur.name)}</span> go?`
    : all && order().length > 1
      ? '✅ Everyone placed. Drag to adjust until the reveal.'
      : '✅ You’re placed. Waiting for friends to join…';
  $('#taphint').classList.toggle('hidden', !cur || Object.keys(pl).length > 1);
  // Tray
  $('#tray').innerHTML = order().map((m) => `<button type="button" class="chip ${m.id === current ? 'cur' : ''} ${pl[m.id] ? 'placed' : ''}" data-id="${m.id}"><span class="av" style="background:${esc(m.color)}">${esc(m.emoji)}</span>${m.id === view.me.id ? 'You' : esc(m.name)}</button>`).join('');
  $('#tray').querySelectorAll('.chip').forEach((c) => (c.onclick = () => ((current = c.dataset.id), updatePlay())));
  // Invite
  const waiting = view.groupSize - view.members.length;
  $('#invite').innerHTML = `<b style="font-size:18px">${waiting > 0 ? `Invite the group (${waiting} more to join)` : 'Share the link'}</b>
    <p class="muted small" style="margin:4px 0 0">Send it to the group chat. Each friend opens it, picks a nickname and places everyone.</p>
    <div class="linkbox"><input type="text" readonly value="${esc(url())}" aria-label="Chart link"><button class="btn small" id="sharebtn">Share</button></div>`;
  $('#sharebtn').onclick = () => shareLink({ title: `${view.theme.title} · Chartmates`, text: inviteText(), url: url() });
  $('#invite input').onclick = (e) => e.target.select();
  $('#progress').innerHTML = progressHtml();
  // Menu
  const mm = view.me;
  $('#menu').innerHTML = `${mm.isCreator ? `<button class="linkbtn" id="revealnow" ${view.canReveal ? '' : 'disabled title="At least 3 people need to place first"'}>Reveal now</button>` : ''}
    <button class="linkbtn" id="hideme">${mm.hidden ? 'Put me back on the chart' : 'Leave me off the chart'}</button>
    <button class="linkbtn" id="device">Continue on another device</button>
    ${mm.isCreator ? '<button class="linkbtn" id="del" style="color:#c92a2a">Delete chart</button>' : ''}`;
  if (mm.isCreator && !view.canReveal) $('#revealnow').insertAdjacentHTML('afterend', '<span class="muted small" style="align-self:center">(after 3 people have placed)</span>');
  const err = (e) => ($('#menuerr').textContent = e.message);
  if ($('#revealnow')) $('#revealnow').onclick = async () => {
    if (!view.canReveal) return;
    if (!confirm('Reveal the chart now? Placements lock for everyone.')) return;
    await flush();
    try {
      view = await api(`charts/${id}/reveal`, { method: 'POST', token: token(), body: {} });
      render(true);
    } catch (e) {
      err(e);
    }
  };
  $('#hideme').onclick = async () => {
    try {
      await flush();
      view = await api(`charts/${id}/hide`, { method: 'POST', token: token(), body: { hidden: !mm.hidden } });
      current = nextUnplaced();
      toast(view.me.hidden ? 'You’re off the chart. You can still place friends.' : 'You’re back on the chart');
      render(false);
    } catch (e) {
      err(e);
    }
  };
  $('#device').onclick = () => copy(`${url()}#k=${token()}`).then(() => toast('Private link copied. It signs in as you, so keep it to yourself.'));
  if ($('#del')) $('#del').onclick = async () => {
    if (!confirm('Delete this chart for everyone? This cannot be undone.')) return;
    try {
      await api(`charts/${id}/delete`, { method: 'POST', token: token(), body: {} });
      ident.drop(id);
      location.href = '/';
    } catch (e) {
      err(e);
    }
  };
}

function bindBoard() {
  let drag = null;
  boardEl.addEventListener('pointerdown', (e) => {
    const d = e.target.closest('.dot');
    const p = boardPoint(boardEl, e.clientX, e.clientY);
    drag = { id: d ? d.dataset.id : null, x: e.clientX, y: e.clientY, moved: false, start: p };
    if (d) {
      d.classList.add('dragging');
      boardEl.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
  });
  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || !drag.id) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (!drag.moved) return;
    const p = boardPoint(boardEl, e.clientX, e.clientY);
    pl[drag.id] = p;
    setPos(boardEl.querySelector(`.dot[data-id="${drag.id}"]`), p);
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    boardEl.querySelectorAll('.dot.dragging').forEach((x) => x.classList.remove('dragging'));
    if (d.id && d.moved) {
      changed();
      return;
    }
    if (d.id && !d.moved && d.id !== current) {
      // Tapped a dot: select that person to move them with the next tap.
      current = d.id;
      updatePlay();
      return;
    }
    if (e.type === 'pointercancel') return;
    if (current) {
      pl[current] = boardPoint(boardEl, e.clientX, e.clientY);
      current = nextUnplaced();
      changed();
    }
  };
  boardEl.addEventListener('pointerup', end);
  boardEl.addEventListener('pointercancel', end);
}

function changed() {
  dirty = true;
  updatePlay();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 450);
}
async function flush() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  if (saving) {
    saveTimer = setTimeout(flush, 300);
    return;
  }
  saving = true;
  dirty = false;
  try {
    const v = await api(`charts/${id}/place`, { method: 'POST', token: token(), body: { placements: pl } });
    view = v;
    if (v.revealed) render(true);
    else if (!dirty) updatePlay();
  } catch (e) {
    dirty = true;
    toast(e.message);
    if (e.status === 409) {
      dirty = false;
      load();
    } else saveTimer = setTimeout(flush, 3000);
  } finally {
    saving = false;
  }
}
window.addEventListener('pagehide', () => {
  if (dirty && token()) navigator.sendBeacon && fetch(`/api/charts/${id}/place`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-token': token() }, body: JSON.stringify({ placements: pl }) });
});

// ---------- Results ----------
function renderResults(animate) {
  clearTimeout(pollTimer);
  const res = view.results.filter((r) => r.avg);
  const mine = view.me && view.results.find((r) => r.id === view.me.id && r.avg);
  const words = mine ? { self: mine.self ? describe(view.theme, mine.self) : 'didn’t say', group: describe(view.theme, mine.avg) } : null;
  const award = (a) => {
    const r = view.results.find((x) => x.id === a.id);
    return `<div class="award"><span class="av" style="background:${esc(r.color)}">${esc(r.emoji)}</span><div><small>${esc(a.title)}</small><b>${esc(r.name)}</b><p>${esc(a.line)}</p></div></div>`;
  };
  const nextHtml = view.next
    ? `<a class="card next row" style="text-decoration:none;color:inherit" href="/c/${esc(view.next.id)}"><span style="font-size:34px">${esc(view.next.emoji || '📊')}</span><div><b style="font-size:18px">Next chart is up: ${esc(view.next.title)}</b><div class="muted small">Same group, new chart. Tap to place everyone.</div></div></a>`
    : view.me
      ? `<div class="card next stack"><b style="font-size:18px">Again? Start the next chart for this group</b><p class="muted small" style="margin:0">Everyone here sees it on this page.</p><button class="btn" id="nextbtn">Pick the next chart</button></div>`
      : '';
  app.innerHTML = `<div class="play-grid"><div>${headHtml()}
      <div id="boardwrap"></div>
      <div class="row" style="margin-top:10px;justify-content:space-between"><span class="muted small">Dot = where the group put them · dashed ring = where they put themselves</span><button class="linkbtn" id="ringsbtn">Hide rings</button></div>
    </div>
    <div class="side stack">
      ${words ? `<div class="card mine stack"><div class="muted small" style="font-weight:700">YOUR VERDICT</div><div class="big">You said: ${esc(words.self)}.<br>Your friends said: ${esc(words.group)}.</div><button class="btn secondary" id="sharemine">Share my result</button></div>` : ''}
      ${view.awards.length ? `<div class="awards">${view.awards.map(award).join('')}</div>` : ''}
      <div class="row"><button class="btn" id="sharechart">Share the chart</button><button class="btn ghost" id="copylink">Copy link</button></div>
      ${nextHtml}
      <div class="card"><b>Everyone's verdict</b><div class="verdicts">${view.results.map((r) => `<div class="v"><span class="av" style="background:${esc(r.color)}">${esc(r.emoji)}</span><div><b>${esc(r.name)}</b><br>${r.avg ? `Group: ${esc(describe(view.theme, r.avg))}` : '<span class="muted">Nobody placed them</span>'}${r.self ? `<br><span class="muted">Self: ${esc(describe(view.theme, r.self))}</span>` : ''}</div></div>`).join('')}</div></div>
      <div class="card stack center"><b style="font-size:18px">Got another group chat?</b><p class="muted small" style="margin:0">Family, work, the other friends. Takes 30 seconds.</p><button class="btn ghost" id="other">Chart your other group</button></div>
    </div></div>`;
  boardEl = buildBoard(view.theme);
  boardEl.classList.add('reveal');
  $('#boardwrap').append(boardEl);
  const links = [];
  for (const r of res) {
    if (r.self) {
      const ring = h(`<div class="ring" style="border-color:${esc(r.color)}"></div>`);
      setPos(ring, r.self);
      boardEl.append(ring);
      links.push(`<line x1="${toView(r.self[0]) * 100}" y1="${toView(r.self[1]) * 100}" x2="${toView(r.avg[0]) * 100}" y2="${toView(r.avg[1]) * 100}" stroke="${esc(r.color)}" stroke-width="2" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>`);
    }
    const d = dotEl(r);
    setPos(d, animate ? [0.5, 0.5] : r.avg);
    boardEl.append(d);
  }
  boardEl.prepend(h(`<svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${links.join('')}</svg>`));
  const place = () => res.forEach((r) => setPos(boardEl.querySelector(`.dot[data-id="${r.id}"]`), r.avg));
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(place));
    setTimeout(() => boardEl.classList.add('rings'), 1300);
  } else boardEl.classList.add('rings');
  try {
    localStorage.setItem('fc:seen:' + id, '1');
  } catch {}
  $('#ringsbtn').onclick = () => {
    const on = boardEl.classList.toggle('rings');
    $('#ringsbtn').textContent = on ? 'Hide rings' : 'Show rings';
  };
  $('#sharechart').onclick = () => shareCanvas(groupCard(view), 'chartmates.png', `${view.theme.emoji} ${view.theme.title}: our group's verdict. Make one for your group: ${location.origin}`);
  $('#copylink').onclick = () => copy(url());
  if ($('#sharemine')) $('#sharemine').onclick = () => shareCanvas(meCard(view, mine, words), 'my-chartmates-verdict.png', `I said ${words.self}. My friends said ${words.group}. ${location.origin}`);
  if ($('#nextbtn')) $('#nextbtn').onclick = () => openCreate({ prev: id, prevToken: token() });
  $('#other').onclick = () => openCreate();
}

if (!id) renderGone('That link is not complete.');
else load(true);
$('#newlink').onclick = (e) => {
  e.preventDefault();
  openCreate();
};
