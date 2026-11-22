import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartStore, HttpError } from '../../lib/store.js';
import { describe, isBlocked, computeResults, computeAwards } from '../../public/lib/chart.js';
import { THEMES, themeById } from '../../public/lib/themes.js';

function mem() {
  const m = new Map();
  return { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => void m.set(k, structuredClone(v)), deleteAll: async () => m.clear(), _m: m };
}
function setup(t0 = 1_000_000) {
  const clock = { t: t0 };
  const s = new ChartStore(mem(), { now: () => clock.t });
  return { s, clock };
}
async function group(s, n, expected = n) {
  const c = await s.create({ id: 'AbCdEf12', themeId: THEMES[0].id, name: 'Ana', expected, hours: 24 });
  const people = [{ name: 'Ana', token: c.token, id: c.memberId }];
  for (let i = 1; i < n; i++) {
    const name = ['Ben', 'Cai', 'Dev', 'Eli', 'Fay'][i - 1];
    const j = await s.join('', { name });
    people.push({ name, token: j.token, id: j.memberId });
  }
  return people;
}
const placeAll = (s, p, people, pos) => s.place(p.token, { placements: Object.fromEntries(people.map((q) => [q.id, pos(q)])) });

test('themes: 40, unique ids, valid grids', () => {
  assert.equal(THEMES.length, 40);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, 40);
  for (const t of THEMES) if (t.kind === 'grid') assert.equal(t.cells.length, 9, t.id);
  assert.ok(themeById(THEMES[3].id));
});

test('no placements leak before the reveal', async () => {
  const { s } = setup();
  const ppl = await group(s, 4);
  await placeAll(s, ppl[0], ppl, () => [0.1, 0.1]);
  const v = await s.get(ppl[1].token);
  assert.equal(v.revealed, false);
  assert.deepEqual(v.me.placements, {});
  assert.equal(v.results, undefined);
  assert.equal(v.members.find((m) => m.id === ppl[0].id).done, true);
  assert.equal(JSON.stringify(v).includes('0.1'), false);
});

test('auto-reveals when everyone expected is in and done; averages exclude self', async () => {
  const { s } = setup();
  const ppl = await group(s, 3);
  // Everyone puts Ana at x=0.9 except Ana, who puts herself at 0.1.
  for (const p of ppl) await placeAll(s, p, ppl, (q) => (q.name === 'Ana' ? (p.name === 'Ana' ? [0.1, 0.5] : [0.9, 0.5]) : [0.5, 0.5]));
  const v = await s.get('');
  assert.equal(v.revealed, true);
  const ana = v.results.find((r) => r.name === 'Ana');
  assert.deepEqual(ana.avg, [0.9, 0.5]);
  assert.deepEqual(ana.self, [0.1, 0.5]);
  assert.equal(ana.n, 2);
  assert.equal(v.awards[0].key, 'misjudged');
  assert.equal(v.awards[0].id, ppl[0].id);
  await assert.rejects(() => s.place(ppl[1].token, { placements: {} }), HttpError);
  await assert.rejects(() => s.join('', { name: 'Zed' }), /revealed/);
});

test('waits for the expected group size, then the deadline reveals', async () => {
  const { s, clock } = setup();
  const ppl = await group(s, 3, 5);
  for (const p of ppl) await placeAll(s, p, ppl, () => [0.3, 0.3]);
  assert.equal((await s.get('')).revealed, false);
  clock.t += 25 * 3600000;
  assert.equal((await s.get('')).revealed, true);
});

test('deadline does not reveal with fewer than 3 active placers', async () => {
  const { s, clock } = setup();
  const ppl = await group(s, 3, 3);
  await placeAll(s, ppl[0], ppl, () => [0.3, 0.3]);
  clock.t += 100 * 3600000;
  const v = await s.get('');
  assert.equal(v.revealed, false);
  assert.equal(v.canReveal, false);
});

test('only the creator can reveal early or delete; hidden members leave the chart', async () => {
  const { s } = setup();
  const ppl = await group(s, 4, 6);
  await s.setHidden(ppl[3].token, { hidden: true });
  for (const p of ppl.slice(0, 3)) await placeAll(s, p, ppl.slice(0, 3), () => [0.2, 0.8]);
  await assert.rejects(() => s.reveal(ppl[1].token), /Only the person/);
  const v = await s.reveal(ppl[0].token);
  assert.equal(v.revealed, true);
  assert.equal(v.results.length, 3);
  assert.ok(!v.results.some((r) => r.id === ppl[3].id));
  await assert.rejects(() => s.remove(ppl[1].token), /Only/);
  await s.remove(ppl[0].token);
  await assert.rejects(() => s.get(''), /does not exist/);
});

test('names: duplicates and unkind words refused', async () => {
  const { s } = setup();
  await group(s, 2, 3);
  await assert.rejects(() => s.join('', { name: 'ana' }), /already called/);
  await assert.rejects(() => s.join('', { name: 'Stupid' }), /kinder/);
  await assert.rejects(() => setup().s.create({ id: 'X', custom: { x: ['ugly', 'nice'], y: ['a', 'b'] }, name: 'Q', expected: 3 }), /kinder/);
  assert.equal(isBlocked('Grinch'), false);
  assert.equal(isBlocked('fuck off'), true);
  assert.equal(isBlocked('St00pid'), false);
});

test('describe positions', () => {
  const grid = THEMES.find((t) => t.kind === 'grid');
  assert.equal(describe(grid, [0.01, 0.01]), grid.cells[0]);
  assert.equal(describe(grid, [0.99, 0.99]), grid.cells[8]);
  const ax = { kind: 'axes', x: ['Grinch', 'Elf'], y: ['plans', 'wings it'] };
  assert.equal(describe(ax, [0.5, 0.5]), 'right in the middle');
  assert.equal(describe(ax, [0.95, 0.3]), 'Elf · leaning plans');
});

test('awards: one per person, consensus vs wildcard', () => {
  const chart = {
    members: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })),
    placements: {
      a: { b: [0.5, 0.5], c: [0.1, 0.1], d: [0.2, 0.2] },
      b: { a: [0.2, 0.2], c: [0.9, 0.9], d: [0.2, 0.2] },
      c: { a: [0.2, 0.2], b: [0.5, 0.5], d: [0.21, 0.2] },
      d: { a: [0.2, 0.2], b: [0.5, 0.51], c: [0.5, 0.1] },
    },
  };
  const aw = computeAwards(computeResults(chart));
  const ids = aw.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(aw.find((a) => a.key === 'wildcard').id, 'c');
});
