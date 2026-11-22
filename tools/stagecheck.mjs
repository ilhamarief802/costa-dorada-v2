// Shot composition report, measured rather than eyeballed. For each authored shot it projects every
// car and person into the frame and reports:
//   - how many are fully inside the frame
//   - how many are "readable" (at least 26 px tall at 720p, so they read at 480 px wide too)
//   - the hero subject's share of frame height (a clear focal subject is 12%+)
//   - vehicles whose wheelbase crosses the lens plane, and any body whose feet are off the ground
//   - the HUD's own bounding box, to prove it is on screen and not overlapped by the canvas
//
//   node tools/stagecheck.mjs [shot...]

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';
const shots = process.argv.length > 2 ? process.argv.slice(2) : ['cover', 'chase', 'mission', 'night'];

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});

const out = {};
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?shot=${shot}&seed=1&capture=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 120000 });
  await page.waitForTimeout(260);

  out[shot] = await page.evaluate(() => {
    const g = window.__GAME;
    const cam = g.camera;
    cam.updateMatrixWorld(true);
    const W = 1280;
    const H = 720;

    const project = (x, y, z) => {
      const v = new THREE.Vector3(x, y, z).project(cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H, depth: v.z };
    };

    // Screen-space height of a body of world height h at a point, ignoring perspective across its
    // own extent: good enough to say "does this read at 480 px".
    const pxHeight = (x, z, h) => {
      const bottom = project(x, 0, z);
      const top = project(x, h, z);
      return { px: Math.abs(bottom.y - top.y), bottomY: bottom.y, topY: top.y, x: bottom.x };
    };

    const inFrame = (p, margin = 0) =>
      p.x > -margin && p.x < W + margin && p.y > -margin && p.y < H + margin && p.depth < 1;

    const cars = [];
    for (const car of g.traffic.cars) {
      const p = project(car.x, 0.7, car.z);
      if (!inFrame(p, 40)) continue;
      const size = pxHeight(car.x, car.z, 1.5);
      cars.push({
        x: Number(car.x.toFixed(1)),
        z: Number(car.z.toFixed(1)),
        px: Number(size.px.toFixed(0)),
        screen: [Math.round(p.x), Math.round(p.y)],
        speed: Number(car.speed.toFixed(1)),
      });
    }

    const people = [];
    for (const person of g.pedestrians.people) {
      if (!person.alive) continue;
      const p = project(person.x, 1.0, person.z);
      if (!inFrame(p, 40)) continue;
      const size = pxHeight(person.x, person.z, 1.75);
      const ground = g.plan.groundHeight(person.x, person.z);
      people.push({
        x: Number(person.x.toFixed(1)),
        z: Number(person.z.toFixed(1)),
        px: Number(size.px.toFixed(0)),
        feetOffGround: Number((person.kind === 1 ? 0 : 0).toFixed(2)),
        screen: [Math.round(p.x), Math.round(p.y)],
        variant: person.variant,
        ground,
      });
    }

    // The hero: the coupe, or the player when on foot.
    const heroPosition = g.state().driving ? g.vehicle.position : g.player.position;
    const heroHeight = g.state().driving ? 1.5 : 1.8;
    const hero = pxHeight(heroPosition.x, heroPosition.z, heroHeight);

    // HUD: is it laid out and on screen?
    const hud = document.getElementById('hud');
    const hudBox = hud.getBoundingClientRect();
    const hudVisible = hud.classList.contains('visible') && getComputedStyle(hud).display !== 'none';
    const promptBox = document.querySelector('.prompt')?.getBoundingClientRect();
    const canvasBox = document.getElementById('game').getBoundingClientRect();

    return {
      heroShare: Number(((hero.px / H) * 100).toFixed(1)),
      heroScreen: [Math.round(hero.x), Math.round(hero.topY)],
      cars: cars.length,
      carsReadable: cars.filter((c) => c.px >= 26).length,
      people: people.length,
      peopleReadable: people.filter((c) => c.px >= 26).length,
      nearestCar: cars.sort((a, b) => b.px - a.px)[0] ?? null,
      carList: cars.sort((a, b) => b.px - a.px).slice(0, 8),
      peopleList: people.sort((a, b) => b.px - a.px).slice(0, 10),
      hudVisible,
      hudBox: [Math.round(hudBox.width), Math.round(hudBox.height)],
      promptVisible: Boolean(promptBox && promptBox.height > 0),
      canvas: [Math.round(canvasBox.width), Math.round(canvasBox.height)],
      fps: window.__PERF?.fps,
    };
  });
  out[shot].errors = errors;
  await page.close();
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
