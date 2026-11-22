import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';
const query = process.argv[2] ?? '?shot=cover&seed=1&capture=1';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message, '\n', e.stack));
await page.goto(`${base}/${query}`, { waitUntil: 'load' });
await page.waitForTimeout(Number(process.env.PROBE_WAIT ?? 9000));
const status = await page.evaluate(() => ({
  ready: window.__SHOT_READY,
  game: Boolean(window.__GAME),
  state: window.__GAME?.state?.(),
  calls: window.__GAME?.renderer?.info?.render?.calls,
}));
console.log(JSON.stringify(status, null, 2));
await page.screenshot({ path: '/tmp/debug.jpg', type: 'jpeg', quality: 90 });
await browser.close();
