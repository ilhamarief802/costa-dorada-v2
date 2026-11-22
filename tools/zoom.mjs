// Zoomed capture: frames a shot, then re-shoots it cropped to a region and upscaled, so a small
// piece of the frame (a car, a pedestrian, a building base) can be inspected at pixel level.
//
//   node tools/zoom.mjs cover 380 300 520 300 3 /tmp/hero-zoom.jpg
//     shot  x   y   w   h   scale  out

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';
const [shot = 'cover', x = '380', y = '300', w = '520', h = '300', scale = '3', out = '/tmp/zoom.jpg'] = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(scale) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?shot=${shot}&seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 120000 });
await page.waitForTimeout(300);
await page.screenshot({
  path: out,
  type: 'jpeg',
  quality: 90,
  clip: { x: Number(x), y: Number(y), width: Number(w), height: Number(h) },
});
console.log(out);
await browser.close();
