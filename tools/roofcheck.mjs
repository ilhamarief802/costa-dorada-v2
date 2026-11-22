// Roof check: frames one car from directly above and from a high three-quarter, so "the roof is an
// open trough" can be confirmed or dismissed. Prints the roof plane's own height and the glass
// bucket's bounds alongside, so the picture and the numbers come from the same run.
//
//   node tools/roofcheck.mjs [shape] [out.jpg]
import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const [shape = 'wagon', out = '/tmp/roof.jpg'] = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/?seed=1&capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });

const info = await page.evaluate(async (shapeName) => {
  const kits = await import('/src/core/carkit.js');
  const g = window.__GAME;
  for (const child of g.scene.children) {
    if (child.name && !['hero-car', 'traffic', 'police'].includes(child.name) && !child.isLight) child.visible = false;
  }
  if (g.pedestrians?.group) g.pedestrians.group.visible = false;
  if (g.traffic?.group) g.traffic.group.visible = false;
  if (g.police?.group) g.police.group.visible = false;
  if (g.hud?.root) g.hud.root.style.display = 'none';

  g.scene.fog = null;
  g.scene.background = new THREE.Color(0x60666e);
  const kit = kits.buildCar(shapeName);
  const group = new THREE.Group();
  const mats = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.3, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.9, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2a4450, roughness: 0.1, metalness: 0.5, side: THREE.DoubleSide }),
    head: new THREE.MeshBasicMaterial({ vertexColors: true }),
    tail: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  for (const b of ['body', 'trim', 'dark', 'glass', 'head', 'tail']) group.add(new THREE.Mesh(kit[b], mats[b]));
  g.scene.add(group);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(0, 14, 4);
  g.scene.add(key);
  g.scene.add(new THREE.HemisphereLight(0xd8e8ff, 0x40454c, 1.4));

  const cam = g.camera;
  window.__VIEW = (pos, look, fov) => {
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.lookAt(look[0], look[1], look[2]);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    g.renderer.render(g.scene, cam);
  };
  window.__VIEW([0, 34, 0.01], [0, 0, 0], 16);

  const glassBox = new THREE.Box3().setFromObject(new THREE.Mesh(kit.glass));
  return {
    roof: kit.spec.canopy.yTop,
    glassBounds: {
      min: glassBox.min.toArray().map((v) => +v.toFixed(3)),
      max: glassBox.max.toArray().map((v) => +v.toFixed(3)),
    },
  };
}, shape);

await page.evaluate(() => window.__VIEW([0, 34, 0.01], [0, 0, 0], 16));
const top = (await page.screenshot({ type: 'jpeg', quality: 90 })).toString('base64');
await page.evaluate(() => window.__VIEW([5.5, 8.5, 6.5], [0, 0.5, 0], 30));
const hi = (await page.screenshot({ type: 'jpeg', quality: 90 })).toString('base64');

const sheet = await page.evaluate(async ([a, b]) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e1014';
  ctx.fillRect(0, 0, 1280, 720);
  for (const [i, data] of [a, b].entries()) {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${data}`;
    await img.decode();
    ctx.drawImage(img, i * 640, 0, 640, 720);
  }
  return canvas.toDataURL('image/jpeg', 0.92);
}, [top, hi]);

const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
console.log(JSON.stringify(info));
await browser.close();
