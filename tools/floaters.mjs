// Floating-geometry audit against real volumes. Each instanced part is checked against the set of
// solid volumes in the city (building masses including tower tiers, plus the plaza pads); an
// instance counts as floating when its centre is outside every volume AND more than a metre above
// the ground under it. That is the "y against its parent" test the brief asks for, without
// flagging facade detail that is legitimately ten storeys up.
//
//   node tools/floaters.mjs [shot]

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';
const shot = process.argv[2] ?? 'cover';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?shot=${shot}&seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 120000 });
await page.waitForTimeout(200);

const report = await page.evaluate(() => {
  const g = window.__GAME;
  const plan = g.plan;

  // Solid volumes: every building mass, including the tier blocks a tower stacks above itself.
  const solids = [];
  for (const lot of plan.lots) {
    if (lot.height <= 0) continue;
    solids.push({ x: lot.x, z: lot.z, w: lot.w, d: lot.d, y0: 0.17, y1: 0.17 + lot.height });
    if (lot.style === 'tower' && lot.tiers > 1) {
      for (let t = 1; t < lot.tiers; t += 1) {
        const shrink = t * 1.55;
        const h = lot.height * (0.12 + t * 0.05);
        const y0 = 0.17 + lot.height;
        solids.push({ x: lot.x, z: lot.z, w: Math.max(6, lot.w - shrink * 2), d: Math.max(6, lot.d - shrink * 2), y0, y1: y0 + h });
      }
    }
  }
  // The elevated highway deck and the landmark towers are solid too.
  const { z: hz, y: hy, from, to } = plan.highway;
  solids.push({ x: (from + to) / 2, z: hz, w: to - from, d: 14.5, y0: hy - 0.4, y1: hy + 0.4 });
  solids.push({ x: plan.landmarks.mirador.x, z: plan.landmarks.mirador.z, w: 26, d: 26, y0: 0.17, y1: 100 });

  const inSolid = (x, y, z, margin) => {
    for (const s of solids) {
      if (Math.abs(x - s.x) > s.w / 2 + margin) continue;
      if (Math.abs(z - s.z) > s.d / 2 + margin) continue;
      if (y < s.y0 - margin || y > s.y1 + margin) continue;
      return true;
    }
    return false;
  };

  const matrix = new THREE.Matrix4();
  const findings = [];
  const walk = (object, path) => {
    object.children.forEach((child) => {
      const label = `${path}/${child.name || child.material?.type || child.type}`;
      if (child.isInstancedMesh) {
        let floating = 0;
        let worst = null;
        for (let i = 0; i < child.count; i += 1) {
          child.getMatrixAt(i, matrix);
          const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
          const ground = plan.groundHeight(pos.x, pos.z);
          const highEnough = pos.y - ground > 1.0;
          if (!highEnough) continue;
          if (inSolid(pos.x, pos.y, pos.z, 1.2)) continue;
          floating += 1;
          if (!worst || pos.y > worst.y) worst = { x: Number(pos.x.toFixed(1)), y: Number(pos.y.toFixed(1)), z: Number(pos.z.toFixed(1)) };
        }
        if (floating > 0) findings.push({ label, count: child.count, floating, worst });
      }
      walk(child, label);
    });
  };
  walk(g.scene, '');
  return { total: findings.length, findings: findings.slice(0, 30) };
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
