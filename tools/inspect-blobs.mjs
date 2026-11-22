import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = 'http://localhost:8080';
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?shot=cover&seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const b = window.__GAME.blobs;
  const m = b.mesh;
  const tex = b.material.map;
  const img = tex.image;
  const ctx = img.getContext('2d');
  const px = ctx.getImageData(128, 128, 1, 1).data;
  const px2 = ctx.getImageData(4, 4, 1, 1).data;
  const mat4 = new THREE.Matrix4();
  m.getMatrixAt(0, mat4);
  return {
    used: b.used,
    capacity: b.capacity,
    count: m.count,
    visible: m.visible,
    opacity: b.material.opacity,
    transparent: b.material.transparent,
    color: b.material.color.getHexString(),
    mapSize: [img.width, img.height],
    centrePixel: [...px],
    edgePixel: [...px2],
    matrix0: mat4.elements.map((v) => Number(v.toFixed(2))),
    renderOrder: m.renderOrder,
    depthTest: b.material.depthTest,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
