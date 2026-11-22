// In-page geometry diagnostics: builds every car shape and silhouette away from the city and
// reports bounds, triangle counts, and a winding test (does each shell triangle face outward?),
// so an inside-out or detached part is caught numerically instead of by eye.
//
//   node tools/shapeprobe.mjs

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 60000 });

const report = await page.evaluate(async () => {
  const kits = await import('/src/core/carkit.js');
  const peds = await import('/src/entities/pedkit.js');
  const out = { cars: {}, peds: {} };

  const analyse = (geometry) => {
    const pos = geometry.getAttribute('position');
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.count; i += 1) {
      for (let a = 0; a < 3; a += 1) {
        const v = pos.array[i * 3 + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    // Winding: for a shell swept about the z axis, the triangle normal should point away from the
    // axis (x,z) on average. Count triangles whose normal points inward.
    let inward = 0;
    let outward = 0;
    const idx = geometry.index ? geometry.index.array : null;
    const triangles = idx ? idx.length / 3 : pos.count / 3;
    for (let t = 0; t < triangles; t += 1) {
      const ia = idx ? idx[t * 3] : t * 3;
      const ib = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ax = pos.array[ia * 3];
      const ay = pos.array[ia * 3 + 1];
      const az = pos.array[ia * 3 + 2];
      const bx = pos.array[ib * 3];
      const by = pos.array[ib * 3 + 1];
      const bz = pos.array[ib * 3 + 2];
      const cx = pos.array[ic * 3];
      const cy = pos.array[ic * 3 + 1];
      const cz = pos.array[ic * 3 + 2];
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      // Centroid in the xy plane relative to the loft axis.
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      void my;
      const dot = nx * mx + nz * 0 * 0;
      if (Math.abs(nx) + Math.abs(nz) < 1e-9) continue;
      if (dot >= 0) outward += 1;
      else inward += 1;
    }
    return {
      triangles,
      min: min.map((v) => Number(v.toFixed(3))),
      max: max.map((v) => Number(v.toFixed(3))),
      inward,
      outward,
      inwardRatio: Number((inward / Math.max(1, inward + outward)).toFixed(3)),
    };
  };

  for (const shape of ['sedan', 'wagon', 'coupe']) {
    const kit = kits.buildCar(shape);
    out.cars[shape] = {};
    for (const key of ['body', 'trim', 'dark', 'glass', 'head', 'tail']) {
      out.cars[shape][key] = analyse(kit[key]);
    }
    out.cars[shape].spec = { width: kit.spec.width, sill: kit.sill, beltline: kit.spec.beltline };
  }

  for (const variant of peds.PED_VARIANTS) {
    const kit = peds.pedKit(variant);
    out.peds[variant] = {};
    for (const key of ['torso', 'head', 'upperArm', 'thigh', 'shin']) {
      out.peds[variant][key] = analyse(kit[key]);
    }
  }
  return out;
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
