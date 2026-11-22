// Projecting tool: turns world positions into screen positions for the current shot, so staging
// claims ("ten people, six cars, two brake lights") can be measured instead of eyeballed.
//
//   node tools/project.mjs [shot] [--json] [--right] [--w=1280] [--h=720]
//
// Prints, for the shot's camera: every pedestrian and car with its screen x/y, whether it is
// inside the frame, and its depth; then a summary with the counts the frame has to satisfy.
// With --right it also lists every window, sign, awning and prop whose box lands in the right
// third of the frame, which is how a stray facade part is named rather than guessed.

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';

const args = process.argv.slice(2);
const shot = args.find((a) => !a.startsWith('--')) ?? 'cover';
const asJson = args.includes('--json');
const wantRight = args.includes('--right');
const width = Number((args.find((a) => a.startsWith('--w=')) ?? '--w=1280').split('=')[1]);
const height = Number((args.find((a) => a.startsWith('--h=')) ?? '--h=720').split('=')[1]);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?shot=${shot}&seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 120000 });

const report = await page.evaluate(({ width, height, wantRight }) => {
  const g = window.__GAME;
  const camera = g.camera;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: Math.round((v.x * 0.5 + 0.5) * width),
      y: Math.round((-v.y * 0.5 + 0.5) * height),
      depth: +new THREE.Vector3(x, y, z).distanceTo(camera.position).toFixed(1),
      front: v.z > -1 && v.z < 1,
    };
  };
  const inside = (p) => p.front && p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;

  // Pedestrians: inside means the body's mid-height point is in frame.
  const people = g.pedestrians.people.filter((p) => p.alive).map((p) => {
    const box = project(p.x, g.plan.groundHeight(p.x, p.z) + 0.95, p.z);
    return {
      id: p.slot ?? -1,
      x: Math.round(p.x * 10) / 10,
      z: Math.round(p.z * 10) / 10,
      screen: box,
      inside: inside(box),
      stride: p.kind === 0 ? 'walk' : p.kind === 1 ? 'sit' : 'lean',
      phase: Math.round(p.phase * 100) / 100,
    };
  });
  const peopleInside = people.filter((p) => p.inside);

  // Cars: the body centre at lamp height, plus whether the brake lamp is lit.
  const cars = g.traffic.cars.map((c) => {
    const point = project(c.x, g.plan.groundHeight(c.x, c.z) + 0.75, c.z);
    return {
      index: c.index,
      shape: c.shape,
      x: Math.round(c.x * 10) / 10,
      z: Math.round(c.z * 10) / 10,
      speed: Math.round(c.speed * 10) / 10,
      brake: c.brakeFade > 0.02,
      screen: point,
      inside: inside(point),
      depth: point.depth,
    };
  });
  const carsInside = cars.filter((c) => c.inside);

  // What is drawn on the right third of the frame, by part family.
  let right = null;
  if (wantRight) {
    const from = width * 0.66;
    const hits = [];
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    g.scene.traverse((object) => {
      if (!object.isMesh) return;
      let owner = object.parent;
      while (owner && !owner.name && owner.parent) owner = owner.parent;
      const group = owner?.name ?? 'scene';
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const label = object.name || `${object.material?.type ?? object.type}#${object.material?.color?.getHexString?.() ?? ''}`;
      const count = object.isInstancedMesh ? object.count : 1;
      for (let i = 0; i < count; i += 1) {
        if (object.isInstancedMesh) {
          object.getMatrixAt(i, matrix);
          const world = new THREE.Matrix4().multiplyMatrices(object.matrixWorld, matrix);
          box.copy(object.geometry.boundingBox).applyMatrix4(world);
        } else {
          box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
        }
        const centre = project(box.getCenter(new THREE.Vector3()).x, box.getCenter(new THREE.Vector3()).y, box.getCenter(new THREE.Vector3()).z);
        if (!inside(centre) || centre.x < from) continue;
        if (centre.depth > 120) continue;
        hits.push({ where: `${group}/${label}`, i, screen: centre, minY: +box.min.y.toFixed(1), maxY: +box.max.y.toFixed(1) });
      }
    });
    const byWhere = new Map();
    for (const hit of hits) {
      if (!byWhere.has(hit.where)) byWhere.set(hit.where, []);
      byWhere.get(hit.where).push(hit);
    }
    right = [...byWhere.entries()].map(([where, list]) => ({ where, count: list.length, nearest: list.sort((a, b) => a.screen.depth - b.screen.depth)[0] })).sort((a, b) => a.nearest.screen.depth - b.nearest.screen.depth);
  }

  return {
    camera: { position: camera.position.toArray().map((v) => +v.toFixed(2)), yaw: +g.follow.yaw.toFixed(2), pitch: +g.follow.pitch.toFixed(2) },
    people: peopleInside,
    cars: carsInside,
    totals: {
      peopleInFrame: peopleInside.length,
      carsInFrame: carsInside.length,
      brakesInFrame: carsInside.filter((c) => c.brake).length,
      peopleAll: people.length,
      carsAll: cars.length,
    },
    right,
  };
}, { width, height, wantRight });

await browser.close();

if (asJson) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`projection — shot ${shot} at ${width}x${height}`);
  console.log(`  camera ${JSON.stringify(report.camera)}`);
  console.log(`  people in frame ${report.totals.peopleInFrame} / ${report.totals.peopleAll}`);
  for (const p of report.people) console.log(`    person #${p.id}  screen (${p.screen.x}, ${p.screen.y})  d=${p.screen.depth}  ${p.stride}`);
  console.log(`  cars in frame ${report.totals.carsInFrame} / ${report.totals.carsAll}   brakes lit ${report.totals.brakesInFrame}`);
  for (const c of report.cars) console.log(`    car #${c.index} ${c.shape}  screen (${c.screen.x}, ${c.screen.y})  d=${c.depth}  speed ${c.speed}${c.brake ? '  BRAKE' : ''}`);
  if (report.right) {
    console.log(`  right third (x > ${Math.round(width * 0.66)}):`);
    for (const entry of report.right) {
      console.log(`    ${String(entry.count).padStart(4)}  ${entry.where}  nearest screen (${entry.nearest.screen.x}, ${entry.nearest.screen.y}) d=${entry.nearest.screen.depth} y ${entry.nearest.minY}..${entry.nearest.maxY}`);
    }
  }
}
