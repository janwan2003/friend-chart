// Display-only spreading of revealed dots, so names never cover each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadOut } from '../../public/common.js';

const ok = (out, minD, ky) => {
  for (let i = 0; i < out.length; i++) {
    assert.ok(out[i].every((v) => v >= 0 && v <= 1), 'stays on the chart');
    for (let j = i + 1; j < out.length; j++) {
      const d = Math.hypot(out[i][0] - out[j][0], (out[i][1] - out[j][1]) * ky);
      assert.ok(d >= minD * 0.98, `points ${i} and ${j} are ${d.toFixed(3)} apart`);
    }
  }
};

test('16 people on the same spot fan out', () => {
  const out = spreadOut(Array(16).fill([0.5, 0.5]), 0.1, 0.72);
  ok(out, 0.1, 0.72);
});

test('people piled in a corner fan out and stay on the chart', () => {
  const out = spreadOut(Array(8).fill([1, 1]), 0.1, 0.72);
  ok(out, 0.1, 0.72);
});

test('points already far apart do not move', () => {
  const pts = [[0.1, 0.1], [0.9, 0.9], [0.1, 0.9]];
  assert.deepEqual(spreadOut(pts, 0.1).map((p) => p.map((v) => Math.round(v * 1000) / 1000)), pts);
});
