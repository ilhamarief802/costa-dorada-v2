// Isolated asset turnaround: hides the whole city, parks the hero coupe (or builds a traffic car
// of each shape) at the origin, and photographs it from four angles on a neutral backdrop. This is
// the honest way to judge a mesh: no city, no HUD, no other cars.
//
//   node tools/carview.mjs coupe /tmp/x.jpg

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const [shape = 'coupe', out = '/tmp/carview.jpg'] = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/?seed=1&capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 60000 });

const info = await page.evaluate(async (shapeName) => {
  const g = window.__GAME;
  const scene = g.camera.parent ?? g.scene;
  void scene;
  for (const child of g.scene.children) {
    if (child.name && child.name !== 'hero-car' && child.name !== 'traffic' && !child.isLight) child.visible = false;
  }
  // Neutral studio: flat sky, no fog.
  g.scene.fog = null;
  g.scene.background = new THREE.Color(0x8d99a6);
  if (g.weather) g.weather.setHour(17.35, true);
  g.scene.background = new THREE.Color(0x8d99a6);
  g.scene.fog = null;

  const car = g.vehicle;
  car.reset(0, 0, 0);
  car.model?.reset?.(0, 0, 0);
  car.root.traverse((child) => {
    if (child.isMesh) child.castShadow = false;
  });
  car.setNight(false);

  // A wide ground plane so the car has a horizon to sit on.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.scene.add(ground);

  const cam = g.camera;
  window.__ORBIT = (angle, dist = 7.2, height = 1.9) => {
    cam.position.set(Math.sin(angle) * dist, height, Math.cos(angle) * dist);
    cam.lookAt(0, 0.62, 0);
    cam.fov = 34;
    cam.updateProjectionMatrix();
    g.renderer.render(g.scene, cam);
  };
  window.__ORBIT(Math.PI * 0.78);
  const box = new THREE.Box3().setFromObject(car.root);
  return {
    shape: shapeName,
    bounds: {
      min: box.min.toArray().map((v) => Number(v.toFixed(2))),
      max: box.max.toArray().map((v) => Number(v.toFixed(2))),
    },
    calls: g.renderer.info.render.calls,
  };
}, shape);

// 2x2 contact sheet of four angles.
const views = [Math.PI * 0.78, Math.PI * 1.28, Math.PI * 0.28, Math.PI * 1.78];
const cells = [];
for (let i = 0; i < views.length; i += 1) {
  await page.evaluate((a) => window.__ORBIT(a), views[i]);
  const buffer = await page.screenshot({ type: 'jpeg', quality: 88 });
  cells.push(buffer.toString('base64'));
}

const sheet = await page.evaluate(async (images) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, 1280, 720);
  for (let i = 0; i < images.length; i += 1) {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${images[i]}`;
    await img.decode();
    ctx.drawImage(img, (i % 2) * 640, Math.floor(i / 2) * 360, 640, 360);
  }
  return canvas.toDataURL('image/jpeg', 0.9);
}, cells);

const base64 = sheet.split(',')[1];
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(base64, 'base64'));
console.log(JSON.stringify(info));
await browser.close();
