// Chartmates core rules: pure functions shared by the API (worker) and the browser.
// A chart stores, for every placer, an [x, y] position (0..1, origin top-left) for each target.
// A person's revealed dot is the AVERAGE of the other members' placements of them; their own
// placement is kept separately as the "where I put myself" ring.

export const LIM = { members: 16, minToReveal: 3, name: 20, label: 16, title: 40 };
export const DEADLINES = [3, 24, 72]; // hours offered at create time
export const EMOJI = ['🦊', '🐸', '🐙', '🦄', '🐼', '🐯', '🐧', '🦉', '🐝', '🦖', '🐨', '🐳', '🦩', '🐌', '🦔', '🐲', '🐵', '🦦'];
export const COLORS = ['#e4572e', '#2a9d8f', '#7b61ff', '#f2a541', '#d6336c', '#1c7ed6', '#5c940d', '#ae3ec9', '#0b7285', '#e67700', '#495057', '#c2255c', '#2f9e44', '#3b5bdb', '#a61e4d', '#087f5b'];

const r3 = (v) => Math.round(v * 1000) / 1000;
export const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function validPoint(p) {
  return Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= -0.01 && v <= 1.01);
}
export const normPoint = (p) => [r3(clamp01(p[0])), r3(clamp01(p[1]))];

/** Members who appear on the chart (anyone who chose "leave me off" is excluded). */
export const targets = (chart) => chart.members.filter((m) => !m.hidden);

/** Has this member placed everyone who is on the chart (themselves included unless hidden)? */
export function isDone(chart, memberId) {
  const mine = chart.placements[memberId] || {};
  const t = targets(chart);
  return t.length > 0 && t.every((m) => Array.isArray(mine[m.id]));
}

/** How many targets this member still has to place. */
export function todoCount(chart, memberId) {
  const mine = chart.placements[memberId] || {};
  return targets(chart).filter((m) => !Array.isArray(mine[m.id])).length;
}

/** Number of members who have placed at least one OTHER person. */
export function activePlacers(chart) {
  return chart.members.filter((m) => Object.keys(chart.placements[m.id] || {}).some((t) => t !== m.id)).length;
}

export const groupSize = (chart) => Math.max(chart.expected || 0, chart.members.length);
export const doneCount = (chart) => chart.members.filter((m) => isDone(chart, m.id)).length;

/** Enough data for a meaningful reveal: 3+ people have placed someone other than themselves. */
export const canReveal = (chart) => activePlacers(chart) >= LIM.minToReveal && targets(chart).length >= 2;

/**
 * Should the chart be revealed now? Either everyone expected is in and done, or the deadline has
 * passed with enough data. Returns false if already revealed (caller checks revealedAt).
 */
export function shouldAutoReveal(chart, now) {
  if (chart.revealedAt) return false;
  if (!canReveal(chart)) return false;
  const everyoneIn = chart.members.length >= (chart.expected || Infinity);
  if (everyoneIn && chart.members.every((m) => isDone(chart, m.id))) return true;
  return now >= chart.deadline;
}

/** Results per target: group average, own placement, gap between them, spread of the group's votes. */
export function computeResults(chart) {
  const out = [];
  for (const m of targets(chart)) {
    const votes = [];
    for (const p of chart.members) {
      if (p.id === m.id) continue;
      const pt = (chart.placements[p.id] || {})[m.id];
      if (Array.isArray(pt)) votes.push(pt);
    }
    const self = (chart.placements[m.id] || {})[m.id] || null;
    let avg = null;
    let spread = null;
    if (votes.length) {
      avg = [r3(votes.reduce((s, v) => s + v[0], 0) / votes.length), r3(votes.reduce((s, v) => s + v[1], 0) / votes.length)];
      spread = r3(votes.reduce((s, v) => s + dist(v, avg), 0) / votes.length);
    }
    const gap = avg && self ? r3(dist(avg, self)) : null;
    out.push({ id: m.id, name: m.name, emoji: m.emoji, color: m.color, n: votes.length, avg, self, gap, spread });
  }
  return out;
}

/** Awards derived from the data. Each person wins at most one award. */
export function computeAwards(results) {
  const awards = [];
  const used = new Set();
  const pick = (list, key, dir, minN) => {
    const c = list.filter((r) => r[key] != null && r.n >= minN && !used.has(r.id)).sort((a, b) => dir * (a[key] - b[key]));
    return c[0] || null;
  };
  const mis = pick(results, 'gap', -1, 1);
  if (mis && mis.gap >= 0.15) {
    used.add(mis.id);
    awards.push({ key: 'misjudged', title: 'Most misjudged', id: mis.id, line: 'Sees themselves very differently from how the group does' });
  }
  const con = pick(results, 'spread', 1, 2);
  if (con) {
    used.add(con.id);
    awards.push({ key: 'consensus', title: 'Group consensus', id: con.id, line: 'Everyone put them in the same spot' });
  }
  const wild = pick(results, 'spread', -1, 2);
  if (wild && wild.spread >= 0.12) {
    used.add(wild.id);
    awards.push({ key: 'wildcard', title: 'The wildcard', id: wild.id, line: 'Nobody agrees where they belong' });
  }
  const aware = pick(results, 'gap', 1, 1);
  if (aware && aware.gap <= 0.15) {
    used.add(aware.id);
    awards.push({ key: 'selfaware', title: 'Most self-aware', id: aware.id, line: 'Put themselves right where the group did' });
  }
  return awards;
}

/** Human words for a point: a grid cell name, or "full Grinch · leaning wings it" for axes. */
export function describe(theme, p) {
  if (!p) return '';
  if (theme.kind === 'grid' && Array.isArray(theme.cells) && theme.cells.length === 9) {
    const col = Math.min(2, Math.floor(clamp01(p[0]) * 3));
    const row = Math.min(2, Math.floor(clamp01(p[1]) * 3));
    return theme.cells[row * 3 + col];
  }
  const part = (v, [a, b]) => {
    const d = v - 0.5;
    if (Math.abs(d) < 0.12) return null;
    const word = d < 0 ? a : b;
    return Math.abs(d) > 0.3 ? word : `leaning ${word}`;
  };
  const parts = [part(p[0], theme.x), part(p[1], theme.y)].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'right in the middle';
}

/** One-line live state for link previews and the header. */
export function stateLine(chart, now = Date.now()) {
  if (chart.revealedAt) return `Revealed · ${targets(chart).length} people charted`;
  const size = groupSize(chart);
  const done = doneCount(chart);
  if (chart.members.length <= 1) return `Started by ${chart.members[0]?.name || 'a friend'} · waiting for the group`;
  return `${done} of ${size} have placed everyone`;
}

// A short list of words not allowed in nicknames or custom axis labels. The default theme library is
// playful; custom charts must not target looks, weight, intelligence or worse.
const BLOCK = [
  'ugly', 'fat', 'fattest', 'obese', 'stupid', 'dumb', 'idiot', 'retard', 'moron', 'loser', 'slut', 'whore', 'hoe', 'skank',
  'bitch', 'cunt', 'fuck', 'fucking', 'shit', 'dick', 'cock', 'pussy', 'nigger', 'nigga', 'fag', 'faggot', 'tranny', 'kys',
  'kill yourself', 'suicide', 'rape', 'rapist', 'pedo', 'nazi', 'hitler', 'hottest', 'sexiest', 'hot or not', 'poorest',
  'gay', 'lesbian', 'autistic', 'spastic', 'cripple', 'anorexic', 'smelliest', 'worthless', 'disgusting',
];
const norm = (s) => ` ${String(s).toLowerCase().replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/\$|5/g, 's').replace(/[^a-z]+/g, ' ')} `;
export function isBlocked(s) {
  const n = norm(s);
  return BLOCK.some((w) => n.includes(` ${w} `) || n.replace(/ /g, '').includes(w.replace(/ /g, '')) && w.length >= 5);
}
