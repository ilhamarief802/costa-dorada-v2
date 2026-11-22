// Flat-shaded orthographic views of the hero car: no lighting, no shading, just the silhouette and
// its vertex colours. If the mesh is right this reads as a car instantly; if a part is detached or
// inside-out it is obvious here, without a lighting model to hide behind.
//
//   node tools/silhouette.mjs /tmp/sil.jpg

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const [out = '/tmp/sil.jpg'] = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/?seed=1&capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 60000 });

await page.evaluate(() => {
  const g = window.__GAME;
  for (const child of g.scene.children) {
    if (child.name !== 'hero-car' && !child.isLight) child.visible = false;
  }
  g.scene.fog = null;
  g.scene.background = new THREE.Color(0xffffff);
  if (g.weather) g.weather.setHour(17.35, true);
  g.scene.background = new THREE.Color(0xffffff);
  g.scene.fog = null;
  const car = g.vehicle;
  car.reset(0, 0, 0);

  // Flat vertex-colour material everywhere, so nothing is hidden by shading and glass is opaque.
  car.root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    const src = child.material;
    const hasColour = child.geometry.getAttribute('color');
    child.material = new THREE.MeshBasicMaterial({
      color: hasColour ? 0xffffff : src.color ?? 0x333333,
      vertexColors: Boolean(hasColour),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  });

  const cam = g.camera;
  window.__FLAT = (angle, dist, height, fov, targetY) => {
    cam.position.set(Math.sin(angle) * dist, height, Math.cos(angle) * dist);
    cam.lookAt(0, targetY, 0);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    g.renderer.render(g.scene, cam);
  };

  // Vertex-colour bounds, so a part that pokes out is caught numerically.
  const box = new THREE.Box3().setFromObject(car.root);
  window.__BOUNDS = { min: box.min.toArray(), max: box.max.toArray() };
});

const views = [
  { angle: Math.PI / 2, dist: 9, height: 0.9, fov: 30, targetY: 0.7 }, // pure side
  { angle: 0, dist: 10, height: 0.7, fov: 26, targetY: 0.7 }, // front
  { angle: -0.5, dist: 9, height: 3.4, fov: 32, targetY: 0.6 }, // rear high
  { angle: Math.PI / 2, dist: 8, height: 8, fov: 30, targetY: 0.7 }, // plan
];

const shots = [];
for (const view of views) {
  await page.evaluate((v) => window.__FLAT(v.angle, v.dist, v.height, v.fov, v.targetY), view);
  shots.push((await page.screenshot({ type: 'jpeg', quality: 90 })).toString('base64'));
}
const bounds = await page.evaluate(() => window.__BOUNDS);

const sheet = await page.evaluate(async (images) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1280, 720);
  for (let i = 0; i < images.length; i += 1) {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${images[i]}`;
    await img.decode();
    ctx.drawImage(img, (i % 2) * 640, Math.floor(i / 2) * 360, 640, 360);
    ctx.strokeStyle = '#bbbbbb';
    ctx.strokeRect((i % 2) * 640, Math.floor(i / 2) * 360, 640, 360);
  }
  return canvas.toDataURL('image/jpeg', 0.92);
}, shots);

const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
console.log(JSON.stringify({ out, bounds }));
await browser.close();
