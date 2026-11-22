// End-to-end test in real Chromium (Playwright): a creator and 3 friends, phone and desktop widths.
// Creator makes a chart, 3 friends join from the link, everyone taps everyone onto the chart, the chart
// auto-reveals, results + share card render. Also checks the live link preview and that nothing leaks
// before the reveal. Usage: BASE=http://127.0.0.1:8780 node tests/e2e/run.mjs  (default: local dev)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8780';
const SHOTS = new URL('../../shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const exe = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const errors = [];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0' };
const DESK = { viewport: { width: 1280, height: 860 } };

async function page(opts, label) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  return p;
}
const shot = (p, name) => p.screenshot({ path: SHOTS + name + '.png', fullPage: true });

/** Tap every unplaced person onto the board at positions given by fn(index). */
async function placeAll(p, fn) {
  const board = p.locator('.board');
  await board.waitFor();
  for (let i = 0; i < 20; i++) {
    const ask = await p.locator('#ask').innerText();
    if (ask.startsWith('✅')) return;
    const box = await board.boundingBox();
    const [x, y] = fn(i);
    await p.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await p.waitForTimeout(120);
  }
  throw new Error('could not place everyone');
}

let id;
try {
  // Home
  const home = await page(DESK, 'home');
  await home.goto(BASE + '/');
  await shot(home, 'home-desktop');
  const homePhone = await page(PHONE, 'home-phone');
  await homePhone.goto(BASE + '/');
  await shot(homePhone, 'home-phone');

  // 1. Creator (phone) makes the Christmas chart for 4 people
  const ana = await page(PHONE, 'ana');
  await ana.goto(BASE + '/');
  await ana.click('#xmas');
  await ana.fill('input[name=name]', 'Ana');
  await ana.click('.stepper [data-d="-1"]'); // 5 -> 4
  await shot(ana, 'create-phone');
  await ana.click('button[type=submit]');
  await ana.waitForURL(/\/c\/[A-Za-z0-9]{8}$/);
  id = ana.url().split('/c/')[1];
  await ana.locator('#ask').waitFor();
  assert.match(await ana.locator('#ask').innerText(), /yourself/);
  await placeAll(ana, () => [0.85, 0.2]); // Ana thinks she is a planner elf
  await shot(ana, 'play-creator-phone');

  // Link preview reflects live state
  const html = await (await fetch(`${BASE}/c/${id}`)).text();
  assert.match(html, /og:title" content="🎄 Grinch or Elf\? · where does the group put you\?"/);
  assert.match(html, /Ana wants you on the chart/);

  // 2. Three friends join (two phones, one desktop)
  const friends = [];
  for (const [name, opts] of [['Ben', PHONE], ['Cai', DESK], ['Dev', PHONE]]) {
    const p = await page(opts, name);
    await p.goto(`${BASE}/c/${id}`);
    await p.locator('#join').waitFor();
    if (name === 'Ben') await shot(p, 'join-phone');
    await p.fill('input[name=name]', name);
    await p.click('#join button');
    await p.locator('#ask').waitFor();
    friends.push({ name, p });
  }
  // Nothing leaks before the reveal: API for Ben shows only his own (empty) placements
  const pre = await friends[0].p.evaluate(async (cid) => {
    const k = JSON.parse(localStorage.getItem('fc:' + cid)).token;
    return (await fetch('/api/charts/' + cid, { headers: { 'x-token': k } })).json();
  }, id);
  assert.equal(pre.revealed, false);
  assert.equal(pre.results, undefined);
  assert.deepEqual(pre.me.placements, {});

  // Ana places the newcomers after they join (she was done with just herself)
  await ana.reload();
  await ana.locator('#ask').waitFor();
  await placeAll(ana, (i) => [0.3 + i * 0.1, 0.6]);

  // Everyone else puts Ana as a Grinch who wings it (bottom-left) and others in the middle-ish.
  for (const { name, p } of friends) {
    await p.reload();
    await p.locator('#ask').waitFor();
    await placeAll(p, (i) => {
      // order: self first, then members in join order (Ana first among others)
      const ask = i;
      return ask === 1 ? [0.1, 0.9] : [0.2 + 0.2 * i, 0.3 + 0.15 * i];
    });
    if (name === 'Cai') await shot(p, 'play-desktop');
  }
  // Last save triggers the reveal. Wait for the results on Dev's page.
  const dev = friends[2].p;
  await dev.locator('.mine').waitFor({ timeout: 15000 });
  await dev.waitForTimeout(1800);
  await shot(dev, 'reveal-phone');

  // Ana's view shows she is misjudged
  await ana.reload();
  await ana.locator('.mine').waitFor();
  const mine = await ana.locator('.mine .big').innerText();
  assert.match(mine, /You said: .*Elf/);
  assert.match(mine, /Your friends said: .*Grinch/);
  assert.match(await ana.locator('.awards').innerText(), /Most misjudged\s+Ana/i);
  await ana.waitForTimeout(1600);
  await shot(ana, 'reveal-creator-phone');

  const cai = friends[1].p;
  await cai.reload();
  await cai.locator('.mine').waitFor();
  await cai.waitForTimeout(1600);
  await shot(cai, 'reveal-desktop');

  // Share cards render at 1080×1350
  const card = await cai.evaluate(async () => {
    const m = await import('/common.js');
    const cid = location.pathname.split('/c/')[1];
    const k = JSON.parse(localStorage.getItem('fc:' + cid)).token;
    const v = await (await fetch('/api/charts/' + cid, { headers: { 'x-token': k } })).json();
    const c = m.groupCard(v);
    return { w: c.width, h: c.height, png: c.toDataURL('image/png') };
  });
  assert.equal(card.w, 1080);
  assert.equal(card.h, 1350);
  fs.writeFileSync(SHOTS + 'card-group.png', Buffer.from(card.png.split(',')[1], 'base64'));
  const mecard = await ana.evaluate(async () => {
    const m = await import('/common.js');
    const { describe } = await import('/lib/chart.js');
    const cid = location.pathname.split('/c/')[1];
    const k = JSON.parse(localStorage.getItem('fc:' + cid)).token;
    const v = await (await fetch('/api/charts/' + cid, { headers: { 'x-token': k } })).json();
    const r = v.results.find((x) => x.id === v.me.id);
    return m.meCard(v, r, { self: describe(v.theme, r.self), group: describe(v.theme, r.avg) }).toDataURL('image/png');
  });
  fs.writeFileSync(SHOTS + 'card-me.png', Buffer.from(mecard.split(',')[1], 'base64'));

  // Revealed preview + placements are locked
  const html2 = await (await fetch(`${BASE}/c/${id}`)).text();
  assert.match(html2, /Revealed · 4 people charted · Most misjudged: Ana/);
  const late = await page(PHONE, 'late');
  await late.goto(`${BASE}/c/${id}`);
  await late.locator('#other').waitFor();
  assert.equal(await late.locator('.mine').count(), 0);

  // 3. Next chart for the same group (Cai picks it), Ana sees the link
  await cai.click('#nextbtn');
  await cai.click('[data-theme="classic-alignment"]');
  await cai.click('button[type=submit]');
  await cai.waitForURL((u) => !u.pathname.endsWith(id));
  const nextId = cai.url().split('/c/')[1];
  await ana.reload();
  await ana.locator('.next[href]').waitFor();
  assert.equal(await ana.locator('.next[href]').getAttribute('href'), `/c/${nextId}`);

  // 4. Creator deletes the next chart (cleanup), and the first one.
  for (const [p, cid] of [[cai, nextId], [ana, id]]) {
    const r = await p.evaluate(async (c) => {
      const k = JSON.parse(localStorage.getItem('fc:' + c)).token;
      return (await fetch(`/api/charts/${c}/delete`, { method: 'POST', headers: { 'x-token': k }, body: '{}' })).status;
    }, cid);
    assert.equal(r, 200);
  }
  assert.equal((await fetch(`${BASE}/api/charts/${id}`)).status, 404);

  const real = errors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 40[49]/.test(e));
  if (real.length) throw new Error('Console errors:\n' + real.join('\n'));
  console.log('E2E PASS', BASE, 'chart', id);
} catch (e) {
  console.error('E2E FAIL', e);
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
