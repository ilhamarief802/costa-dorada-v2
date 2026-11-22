// Section-table dump: prints, for each shape, the shell's width and sill/beltline at every station,
// so a "pinched nose" or a "melted flank" is a number instead of an impression.
//
//   node tools/sections.mjs [shape]
import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const shape = process.argv[2];

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto('http://localhost:8080/?seed=1&capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });

const report = await page.evaluate(async (only) => {
  const kits = await import('/src/core/carkit.js');
  const out = {};
  for (const name of only ? [only] : ['sedan', 'wagon', 'coupe']) {
    const spec = kits.carSpec(name);
    out[name] = spec.stations.map((s) => ({
      z: +s.z.toFixed(2),
      w: +s.w.toFixed(3),
      y0: +s.y0.toFixed(3),
      y1: +s.y1.toFixed(3),
      n: +s.n.toFixed(2),
    }));
  }
  return out;
}, shape);

for (const [name, rows] of Object.entries(report)) {
  console.log(`\n${name}`);
  console.log('     z     w    y0    y1     n   height');
  for (const r of rows) {
    console.log(
      `${String(r.z).padStart(6)} ${String(r.w).padStart(5)} ${String(r.y0).padStart(5)} ${String(r.y1).padStart(5)} ${String(r.n).padStart(4)}  ${(r.y1 - r.y0).toFixed(3)}`,
    );
  }
}

await browser.close();
