// Isolated asset turnaround on a neutral studio backdrop: one car shape, four angles, no city, no
// HUD, no other cars. This is the only honest way to judge a mesh.
//
//   node tools/carview.mjs [shape] [out.jpg] [--zoom]
//
// Prints the model's bounds, per-bucket triangle counts and each wheel group's world-space y, so a
// "the wheels float" claim can be checked against numbers instead of impressions.

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const shape = positional[0] ?? 'coupe';
const out = positional[1] ?? '/tmp/carview.jpg';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto('http://localhost:8080/?seed=1&capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__GAME), null, { timeout: 90000 });

const info = await page.evaluate(async (shapeName) => {
  const kits = await import('/src/core/carkit.js');
  const g = window.__GAME;
  // Hide the city, the crowd and the traffic: only the one car is drawn.
  for (const child of g.scene.children) {
    if (child.name && !['hero-car', 'traffic', 'police'].includes(child.name) && !child.isLight) child.visible = false;
  }
  if (g.pedestrians?.group) g.pedestrians.group.visible = false;
  if (g.traffic?.group) g.traffic.group.visible = false;
  if (g.police?.group) g.police.group.visible = false;
  if (g.hud?.root) g.hud.root.style.display = 'none';
  const vignette = document.getElementById('vignette');
  if (vignette) vignette.style.display = 'none';

  g.scene.fog = null;
  g.scene.background = new THREE.Color(0x8d99a6);
  if (g.weather) g.weather.setHour(17.35, true);
  g.scene.background = new THREE.Color(0x8d99a6);
  g.scene.fog = null;

  // A plain car of the requested shape, parked at the origin, painted a readable colour.
  const kit = kits.buildCar(shapeName);
  const group = new THREE.Group();
  group.name = 'probe-car';
  const role = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.45 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff2d4, toneMapped: false }),
    // The game tints the tail bucket red per instance; the studio render must do the same or the
    // rear lamps read as a second pair of headlights.
    tail: new THREE.MeshBasicMaterial({ color: 0xc4161c, toneMapped: false }),
  };
  for (const bucket of ['body', 'trim', 'dark', 'head', 'tail']) {
    group.add(new THREE.Mesh(kit[bucket], role[bucket]));
  }
  // The greenhouse is a shader; give it a plain dark glass so the shape is legible.
  group.add(new THREE.Mesh(kit.glass, new THREE.MeshStandardMaterial({ color: 0x243a46, roughness: 0.08, metalness: 0.7 })));
  if (shapeName === 'coupe') {
    const c = kit.body.getAttribute('color').array;
    for (let i = 0; i < c.length; i += 3) {
      c[i] *= 0.12;
      c[i + 1] *= 0.55;
      c[i + 2] *= 0.58;
    }
    kit.body.getAttribute('color').needsUpdate = true;
  }
  g.scene.add(group);

  // Wheels, as their own groups, exactly as the hero coupe builds them.
  const spec = kit.spec;
  const wheelMeshes = [];
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(side * spec.wheelTrack, spec.wheelRadius, axle * spec.wheelBase);
      const tyre = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, spec.tyreWidth, 24),
        new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.95 }),
      );
      tyre.rotation.z = Math.PI / 2;
      w.add(tyre);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.wheelRadius * 0.58, spec.wheelRadius * 0.58, spec.tyreWidth + 0.012, 20),
        new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.24, metalness: 0.95 }),
      );
      rim.rotation.z = Math.PI / 2;
      w.add(rim);
      group.add(w);
      wheelMeshes.push({ w, tyre });
    }
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x6b7077, roughness: 0.92 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.scene.add(ground);

  // A contact shadow under the car, so "does it touch the road" is answerable by eye as well as by
  // the printed wheel heights: four soft pools, one per tyre patch, plus a body pool.
  const shadowTexture = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.78)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.34)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  })();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  });
  const bodyPool = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 5.4), shadowMaterial);
  bodyPool.rotation.x = -Math.PI / 2;
  bodyPool.position.y = 0.004;
  g.scene.add(bodyPool);
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.0), shadowMaterial);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(side * spec.wheelTrack, 0.006, axle * spec.wheelBase);
      g.scene.add(pool);
    }
  }

  // A key light from the front-left and a sky fill, so the shell's shoulders and the roof read.
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  key.position.set(6, 9, 7);
  g.scene.add(key);
  const fill = new THREE.HemisphereLight(0xcfe4ff, 0x5a5348, 1.6);
  g.scene.add(fill);

  const cam = g.camera;
  window.__ORBIT = (angle, dist = 7.0, height = 1.75) => {
    cam.position.set(Math.sin(angle) * dist, height, Math.cos(angle) * dist);
    cam.lookAt(0, 0.6, 0);
    cam.fov = 32;
    cam.updateProjectionMatrix();
    g.renderer.render(g.scene, cam);
  };
  window.__ORBIT(Math.PI * 0.78);

  const box = new THREE.Box3().setFromObject(group);
  group.updateMatrixWorld(true);
  const wheels = wheelMeshes.map(({ tyre }, i) => {
    const b = new THREE.Box3().setFromObject(tyre);
    return { i, minY: +b.min.y.toFixed(4), maxY: +b.max.y.toFixed(4) };
  });
  return {
    shape: shapeName,
    bounds: {
      min: box.min.toArray().map((v) => +v.toFixed(3)),
      max: box.max.toArray().map((v) => +v.toFixed(3)),
    },
    spec: { wheelRadius: spec.wheelRadius, wheelTrack: spec.wheelTrack, wheelBase: spec.wheelBase, sill: +spec.sill.toFixed(3) },
    wheels,
    triangles: {
      body: kit.body.getAttribute('position').count / 3,
      trim: kit.trim.getAttribute('position').count / 3,
      dark: kit.dark.getAttribute('position').count / 3,
      glass: kit.glass.getAttribute('position').count / 3,
    },
  };
}, shape);

const views = [Math.PI * 0.78, Math.PI * 1.28, Math.PI * 0.28, Math.PI * 1.78];
const cells = [];
for (const a of views) {
  await page.evaluate((angle) => window.__ORBIT(angle), a);
  cells.push((await page.screenshot({ type: 'jpeg', quality: 88 })).toString('base64'));
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
if (errors.length) for (const e of errors) console.log(e);
console.log(JSON.stringify(info));
await browser.close();
