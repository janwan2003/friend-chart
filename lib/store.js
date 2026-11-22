// Chartmates: the state machine for ONE chart. Runs inside a Durable Object (one object per chart),
// so every operation on a chart is serialised. `storage` needs get(key) / put(key, v) / deleteAll().
//
// Privacy rule enforced here, not in the browser: before the reveal nobody receives anyone else's
// placements, only "done / not done" per member. After the reveal only averages are returned,
// never who put whom where.
import {
  LIM, EMOJI, COLORS, DEADLINES, validPoint, normPoint, isDone, todoCount, groupSize, doneCount, canReveal,
  shouldAutoReveal, computeResults, computeAwards, stateLine, isBlocked, targets,
} from '../public/lib/chart.js';
import { themeById } from '../public/lib/themes.js';

export const KEEP_DAYS = 60;
const DAY = 86400000;

export class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

export function rid(n = 8) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const x of b) s += abc[x % abc.length];
  return s;
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function cleanStr(v, max, what, required = true) {
  let s = typeof v === 'string' ? v : v == null ? '' : String(v);
  s = s.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !s) throw bad(`Please enter ${what}.`);
  if (s.length > max) throw bad(`${what[0].toUpperCase() + what.slice(1)} is too long (max ${max} characters).`);
  if (s && isBlocked(s)) throw bad(`Please pick a kinder ${what}.`);
  return s;
}

/** Build the theme snapshot stored with a chart (a library theme, or a custom two-axis chart). */
export function themeFrom(body) {
  if (body.custom) {
    const c = body.custom;
    const x = [cleanStr(c.x?.[0], LIM.label, 'label'), cleanStr(c.x?.[1], LIM.label, 'label')];
    const y = [cleanStr(c.y?.[0], LIM.label, 'label'), cleanStr(c.y?.[1], LIM.label, 'label')];
    const title = cleanStr(c.title || `${x[0]} ↔ ${x[1]}`, LIM.title, 'title');
    return { id: 'custom', kind: 'axes', title, emoji: '✏️', x, y };
  }
  const t = themeById(String(body.themeId || ''));
  if (!t) throw bad('Pick a chart first.');
  return JSON.parse(JSON.stringify(t));
}

export class ChartStore {
  constructor(storage, opts = {}) {
    this.storage = storage;
    this.now = opts.now || (() => Date.now());
    this.onDelete = opts.onDelete || (() => {});
  }

  async load() {
    const c = await this.storage.get('c');
    if (!c) throw new HttpError(404, 'This chart does not exist or was deleted.');
    return c;
  }
  async save(c) {
    await this.storage.put('c', c);
  }

  async member(c, token) {
    if (!token) return null;
    const h = await sha(token);
    return c.members.find((m) => m.th === h) || null;
  }

  async addMember(c, name) {
    if (c.members.length >= LIM.members) throw new HttpError(409, `This chart is full (${LIM.members} people).`);
    const nm = cleanStr(name, LIM.name, 'nickname');
    if (c.members.some((m) => m.name.toLowerCase() === nm.toLowerCase())) throw new HttpError(409, `Someone here is already called ${nm}. Add an initial?`);
    const usedE = new Set(c.members.map((m) => m.emoji));
    const usedC = new Set(c.members.map((m) => m.color));
    const token = newToken();
    const m = {
      id: rid(6),
      name: nm,
      emoji: EMOJI.find((e) => !usedE.has(e)) || EMOJI[c.members.length % EMOJI.length],
      color: COLORS.find((x) => !usedC.has(x)) || COLORS[c.members.length % COLORS.length],
      th: await sha(token),
      hidden: false,
      joinedAt: this.now(),
    };
    c.members.push(m);
    return { m, token };
  }

  /** Create the chart. body: { id, themeId | custom, name, expected, hours } */
  async create(body) {
    if (await this.storage.get('c')) throw new HttpError(409, 'Chart already exists.');
    const theme = themeFrom(body);
    const expected = Math.round(Number(body.expected));
    if (!(expected >= LIM.minToReveal && expected <= LIM.members)) throw bad(`Group size must be ${LIM.minToReveal} to ${LIM.members}.`);
    const hours = DEADLINES.includes(Number(body.hours)) ? Number(body.hours) : 24;
    const now = this.now();
    const c = {
      v: 1, id: String(body.id), theme, createdAt: now, deadline: now + hours * 3600000, expected,
      revealedAt: null, creator: null, prev: body.prev || null, next: null, members: [], placements: {},
    };
    const { m, token } = await this.addMember(c, body.name);
    c.creator = m.id;
    await this.save(c);
    if (this.storage.setAlarm) await this.storage.setAlarm(now + KEEP_DAYS * DAY);
    return { id: c.id, token, memberId: m.id, title: theme.title, emoji: theme.emoji };
  }

  async join(token, body) {
    const c = await this.load();
    const existing = await this.member(c, token);
    if (existing) return { memberId: existing.id, token };
    this.maybeReveal(c);
    if (c.revealedAt) throw new HttpError(409, 'This chart has already been revealed.');
    const { m, token: t } = await this.addMember(c, body.name);
    await this.save(c);
    return { memberId: m.id, token: t };
  }

  /** Save some or all of a member's placements. body: { placements: { targetId: [x, y] } } */
  async place(token, body) {
    const c = await this.load();
    const me = await this.member(c, token);
    if (!me) throw new HttpError(403, 'Join the chart first.');
    this.maybeReveal(c);
    if (c.revealedAt) throw new HttpError(409, 'The chart has been revealed, placements are locked.');
    const ids = new Set(c.members.map((m) => m.id));
    const mine = { ...(c.placements[me.id] || {}) };
    const input = body.placements && typeof body.placements === 'object' ? body.placements : {};
    let n = 0;
    for (const [tid, p] of Object.entries(input)) {
      if (++n > LIM.members + 2) break;
      if (!ids.has(tid)) continue; // someone who left, or a bad id: ignore
      if (p === null) delete mine[tid];
      else if (validPoint(p)) mine[tid] = normPoint(p);
      else throw bad('Invalid position.');
    }
    c.placements[me.id] = mine;
    this.maybeReveal(c);
    await this.save(c);
    return this.view(c, me);
  }

  async setHidden(token, body) {
    const c = await this.load();
    const me = await this.member(c, token);
    if (!me) throw new HttpError(403, 'Join the chart first.');
    if (c.revealedAt) throw new HttpError(409, 'The chart has already been revealed.');
    me.hidden = !!body.hidden;
    this.maybeReveal(c);
    await this.save(c);
    return this.view(c, me);
  }

  async reveal(token) {
    const c = await this.load();
    const me = await this.member(c, token);
    if (!me || me.id !== c.creator) throw new HttpError(403, 'Only the person who started the chart can reveal it early.');
    if (!c.revealedAt) {
      if (!canReveal(c)) throw new HttpError(409, `At least ${LIM.minToReveal} people need to place their friends first.`);
      c.revealedAt = this.now();
      await this.save(c);
    }
    return this.view(c, me);
  }

  async remove(token) {
    const c = await this.load();
    const me = await this.member(c, token);
    if (!me || me.id !== c.creator) throw new HttpError(403, 'Only the person who started the chart can delete it.');
    await this.storage.deleteAll();
    this.onDelete(c);
    return { deleted: true };
  }

  /** Link the next chart for the same group. First one wins; returns the winning link. */
  async setNext(body) {
    const c = await this.load();
    if (!c.next) {
      c.next = { id: String(body.id), title: String(body.title).slice(0, 60), emoji: String(body.emoji || '').slice(0, 4) };
      await this.save(c);
    }
    return { next: c.next };
  }

  /** Who is asking to start the next chart (name is reused). */
  async whoami(token) {
    const c = await this.load();
    const me = await this.member(c, token);
    if (!me) throw new HttpError(403, 'Join the chart first.');
    return { name: me.name, next: c.next, expected: Math.max(c.expected, c.members.length) };
  }

  maybeReveal(c) {
    if (shouldAutoReveal(c, this.now())) c.revealedAt = this.now();
  }

  async get(token) {
    const c = await this.load();
    const me = await this.member(c, token);
    if (shouldAutoReveal(c, this.now())) {
      c.revealedAt = this.now();
      await this.save(c);
    }
    return this.view(c, me);
  }

  async preview() {
    const c = await this.load();
    if (shouldAutoReveal(c, this.now())) {
      c.revealedAt = this.now();
      await this.save(c);
    }
    let award = null;
    if (c.revealedAt) {
      const res = computeResults(c);
      const a = computeAwards(res)[0];
      if (a) award = `${a.title}: ${res.find((r) => r.id === a.id)?.name}`;
    }
    return { title: c.theme.title, emoji: c.theme.emoji, line: stateLine(c, this.now()), revealed: !!c.revealedAt, award, by: c.members.find((m) => m.id === c.creator)?.name || '' };
  }

  /** What one member (or a visitor) is allowed to see. */
  view(c, me) {
    const revealed = !!c.revealedAt;
    const out = {
      id: c.id,
      theme: c.theme,
      createdAt: c.createdAt,
      deadline: c.deadline,
      expected: c.expected,
      groupSize: groupSize(c),
      doneCount: doneCount(c),
      revealed,
      revealedAt: c.revealedAt,
      canReveal: canReveal(c),
      line: stateLine(c, this.now()),
      creator: c.creator,
      prev: c.prev,
      next: c.next,
      now: this.now(),
      members: c.members.map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, color: m.color, hidden: m.hidden, done: isDone(c, m.id) })),
      me: me ? { id: me.id, name: me.name, hidden: me.hidden, isCreator: me.id === c.creator, todo: todoCount(c, me.id), placements: c.placements[me.id] || {} } : null,
    };
    if (revealed) {
      out.results = computeResults(c);
      out.awards = computeAwards(out.results);
      out.charted = targets(c).length;
    }
    return out;
  }
}
