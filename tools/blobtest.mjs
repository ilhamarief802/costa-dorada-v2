import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

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
const out = await page.evaluate(() => {
  const g = window.__GAME;
  const b = g.blobs;
  // Replace the shader with something unmissable: plain opaque red, no discard.
  b.material.fragmentShader = 'void main(){ gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }';
  b.material.transparent = false;
  b.material.depthWrite = true;
  b.material.needsUpdate = true;
  b.write(0, 25.4, 2.5, 143.5, 8, 1);
  b.write(1, 28.2, 2.5, 145.0, 4, 1);
  b.commit();
  b.mesh.visible = true;
  window.__HOLD = true;
  const paint = () => {
    if (!window.__HOLD) return;
    g.renderer.render(g.scene, g.camera);
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
  return { program: Boolean(b.material.program), visible: b.mesh.visible, count: b.mesh.count };
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/magenta.jpg', type: 'jpeg', quality: 92 });
await page.evaluate(() => { window.__HOLD = false; });
console.log(JSON.stringify(out));
await browser.close();
