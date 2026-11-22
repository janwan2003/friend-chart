// Renders public/og.png (1200×630) and the PNG icons from our own HTML/SVG. Run: node tools/render-images.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const exe = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;
const b = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + root + 'tools/og.html');
await p.waitForFunction(() => document.getElementById('art').complete && document.getElementById('art').naturalWidth > 0);
await p.screenshot({ path: root + 'public/og.png' });
for (const s of [180, 512]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<body style="margin:0"><img src="file://${root}public/icon.svg" width="${s}" height="${s}"></body>`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${root}public/icon-${s}.png`, omitBackground: true });
}
await b.close();
console.log('ok');
