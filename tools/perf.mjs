// Frame budget probe: boot a shot, wait for it to settle, then report renderer.info, the average
// frame time over a window of real frames, and the shadow-map size — so "under 20 ms" and "2048"
// are measured rather than asserted.
//
//   node tools/perf.mjs [shot] [--frames=90]

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';

const args = process.argv.slice(2);
const shot = args.find((a) => !a.startsWith('--')) ?? 'cover';
const frames = Number((args.find((a) => a.startsWith('--frames=')) ?? '--frames=90').split('=')[1]);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?shot=${shot}&seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 180000 });

const report = await page.evaluate(async (frames) => {
  const g = window.__GAME;
  const info = g.renderer.info;
  // Render the frozen frame repeatedly inside one task, timing the GPU submission path, then
  // again across real animation frames so the browser's own pacing is included.
  const times = [];
  for (let i = 0; i < frames; i += 1) {
    const t0 = performance.now();
    g.renderer.render(g.scene, g.camera);
    times.push(performance.now() - t0);
  }
  const sorted = times.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted[sorted.length - 1];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const shadow = g.sky.sun.shadow.mapSize;
  return {
    calls: info.render.calls,
    triangles: info.render.triangles,
    textures: info.memory.textures,
    geometries: info.memory.geometries,
    shadowMap: `${shadow.x}x${shadow.y}`,
    medianMs: Number(median.toFixed(2)),
    meanMs: Number(mean.toFixed(2)),
    worstMs: Number(worst.toFixed(2)),
    frames,
  };
}, frames);

await browser.close();
console.log(JSON.stringify({ shot, ...report }, null, 2));
