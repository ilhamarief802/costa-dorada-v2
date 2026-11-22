import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'node:fs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/?shot=cover&seed=1&capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 90000 });

// A composited rAF loop, so Playwright's screenshot actually sees each render.
await page.evaluate(() => {
  const g = window.__GAME;
  window.__HIDE = false;
  const paint = () => {
    g.blobs.mesh.visible = !window.__HIDE;
    g.renderer.render(g.scene, g.camera);
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
});

async function capture(name, hidden) {
  await page.evaluate((hide) => { window.__HIDE = hide; }, hidden);
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
  writeFileSync(`/tmp/diff-${name}.jpg`, buf);
}

await capture('with', false);
await capture('without', true);
console.log('captured');
await browser.close();
