// Local verification probe: boots the game in headless Chromium, captures the authored shots,
// simulates play (walk, steal a car, fire, get a pursuit), and reports console errors plus
// renderer statistics.

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const errors = [];
const warnings = [];
const requests = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
  else if (message.type() === 'warning') warnings.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('request', (request) => requests.push(request.url()));

async function shot(name, file) {
  const before = errors.length;
  await page.goto(`${base}/?shot=${name}&seed=1&capture=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 120000 });
  await page.waitForTimeout(320);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
  const stats = await page.evaluate(() => ({
    calls: window.__GAME.renderer.info.render.calls,
    triangles: window.__GAME.renderer.info.render.triangles,
    geometries: window.__GAME.renderer.info.memory.geometries,
    textures: window.__GAME.renderer.info.memory.textures,
    state: window.__GAME.state(),
  }));
  stats.errors = errors.slice(before);
  return stats;
}

const cover = await shot('cover', '/tmp/probe.jpg');
const night = await shot('night', '/tmp/probe-night.jpg');
const drive = await shot('drive', '/tmp/probe-drive.jpg');
const chase = await shot('chase', '/tmp/probe-chase.jpg');
const mission = await shot('mission', '/tmp/probe-mission.jpg');

await page.goto(`${base}/?seed=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 60000 });

const simulation = await page.evaluate(() => {
  const walked = window.__TEST.simulate(6, ['KeyW']);
  const stolen = window.__GAME.stealNearest();
  const driven = window.__TEST.simulate(4, ['KeyW']);
  const fired = window.__TEST.gunshot();
  const pursuit = window.__TEST.wanted(3);
  const escaped = window.__TEST.simulate(3, ['KeyW']);
  return { walked, stolen, driven, fired, pursuit, escaped };
});

const frames = [];
for (let i = 0; i < 24; i += 1) {
  frames.push(await page.evaluate(() => window.__PERF.frameMs));
  await page.waitForTimeout(100);
}
const perf = await page.evaluate(() => ({ ...window.__PERF }));
await page.screenshot({ path: '/tmp/probe-play.jpg', type: 'jpeg', quality: 92 });

const external = requests.filter((url) => !url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('blob:'));
const ours = requests.filter((url) => url.startsWith(base));
const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
const max = Math.max(...frames);

console.log(JSON.stringify({
  cover,
  night,
  drive,
  chase,
  mission,
  simulation: {
    stolen: simulation.stolen,
    stars: simulation.pursuit.stars,
    police: simulation.pursuit.police,
    mission: simulation.escaped.mission?.title,
    heat: simulation.escaped.heat,
    driving: simulation.escaped.driving,
  },
  perf,
  frames: { avg: Number(avg.toFixed(2)), max: Number(max.toFixed(2)) },
  errors,
  warnings: warnings.filter((w) => !w.includes('deprecated') && !w.includes('GL Driver Message')),
  external,
  localRequests: ours.length,
}, null, 2));

await browser.close();
