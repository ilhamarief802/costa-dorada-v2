// Car geometry audit, measured instead of eyeballed.
//
// Boots the game in headless Chromium and asks the live scene two questions the brief makes
// mandatory:
//
//   1. For every wheel of every vehicle in the shot: what is its world-space y, and does the tyre's
//      lowest vertex touch the road? A wheel is allowed at most TOUCH_TOLERANCE of clearance, and is
//      never allowed below the asphalt.
//   2. Do any two vehicles in the shot overlap by more than OVERLAP_LIMIT metres? Measured as the
//      separation along the ground of two oriented boxes, which for two cars on a street is the
//      distance between their footprints — not the distance between their centres.
//
// It also prints, per shape, every geometry bucket's local bounds, so a part that leaves the body's
// own box (a bumper past the nose, a roof plane above the roof, a liner below the road) is named.
//
//   node serve.ts &
//   node tools/caraudit.mjs [shot] [--json]
//
// Exits non-zero when a wheel does not touch the road or two vehicles overlap.

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';

const args = process.argv.slice(2);
const shot = args.find((a) => !a.startsWith('--')) ?? 'cover';
const asJson = args.includes('--json');

/** A tyre may not hover more than this above the road, and may not sink below it. */
const TOUCH_TOLERANCE = 0.02;
/** The brief's own limit: no two vehicles in a shot may overlap by more than this. */
const OVERLAP_LIMIT = 0.2;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${base}/?shot=${shot}&seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 180000 });

const report = await page.evaluate(
  async ({ OVERLAP_LIMIT }) => {
    const kits = await import('/src/core/carkit.js');
    const g = window.__GAME;
    const out = { shapes: {}, wheels: [], overlaps: [], roadY: null };

    // ---------------------------------------------------------------- per-shape local bounds
    const bounds = (geometry) => {
      if (!geometry) return null;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const b = geometry.boundingBox;
      return {
        min: [b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(3)),
        max: [b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(3)),
        triangles: (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3,
      };
    };
    for (const shape of ['sedan', 'wagon', 'coupe']) {
      const kit = kits.buildCar(shape);
      const spec = kit.spec;
      out.shapes[shape] = {
        spec: {
          wheelRadius: spec.wheelRadius,
          wheelBase: spec.wheelBase,
          wheelTrack: spec.wheelTrack,
          sill: +spec.sill.toFixed(3),
          roof: spec.canopy.yTop,
          noseZ: +spec.noseZ.toFixed(3),
          tailZ: +spec.tailZ.toFixed(3),
        },
        buckets: {
          body: bounds(kit.body),
          trim: bounds(kit.trim),
          dark: bounds(kit.dark),
          glass: bounds(kit.glass),
          head: bounds(kit.head),
          tail: bounds(kit.tail),
        },
      };
    }

    // ---------------------------------------------------------------- wheels, in world space
    // Every vehicle in the frame: the hero coupe and the traffic cast. For each wheel the tyre's
    // mesh is measured in world space, so body roll, suspension and scale are all included — a
    // wheel that merely *was* at y = 0 in the local frame but floats after the pose still fails.
    const box = new THREE.Box3();
    const pushVehicle = (label, root) => {
      const wheels = [];
      root.updateMatrixWorld(true);
      root.traverse((child) => {
        if (!child.isMesh) return;
        const name = child.geometry?.type ?? '';
        if (!child.userData?.isWheel && name !== 'CylinderGeometry') return;
        box.setFromObject(child);
        wheels.push({
          vehicle: label,
          name: child.userData?.wheelName ?? 'wheel',
          minY: +box.min.y.toFixed(4),
          maxY: +box.max.y.toFixed(4),
        });
      });
      return wheels;
    };

    // The hero coupe exposes its wheels as groups whose tyres are meshes tagged below.
    const hero = g.vehicle;
    if (hero && hero.wheels?.length) {
      const ground = g.plan.groundHeight(hero.position.x, hero.position.z);
      out.roadY = +ground.toFixed(4);
      hero.root.updateMatrixWorld(true);
      for (const wheel of hero.wheels) {
        const tyre = wheel.group.children.find((c) => c.isMesh);
        if (!tyre) continue;
        box.setFromObject(tyre);
        out.wheels.push({
          vehicle: `hero#${hero.wheels.indexOf(wheel)}`,
          name: `tyre(${wheel.front ? 'front' : 'rear'},${wheel.side > 0 ? 'right' : 'left'})`,
          minY: +box.min.y.toFixed(4),
          maxY: +box.max.y.toFixed(4),
          road: +ground.toFixed(4),
          clearance: +(box.min.y - ground).toFixed(4),
        });
      }
    }

    // Traffic cars: each tyre/rim instance is read out of its instance matrix.
    const traffic = g.traffic;
    if (traffic?.meshes) {
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      for (const [shapeName, bucket] of Object.entries(traffic.meshes)) {
        const spec = bucket.spec;
        for (const car of traffic.cars) {
          if (car.shape !== shapeName) continue;
          // A staged frame draws only its cast; an uncast car is under the world and is not a
          // vehicle "in the shot", so it cannot be the one that fails the overlap check.
          if (traffic.stagedOnly && !car.castAt && !car.driven) continue;
          const index = car.shapeIndex;
          for (let slot = 0; slot < 4; slot += 1) {
            bucket.tyre.getMatrixAt(index * 4 + slot, m);
            v.setFromMatrixPosition(m);
            const ground = g.plan.groundHeight(v.x, v.z);
            out.wheels.push({
              vehicle: `traffic#${car.index}(${shapeName})`,
              name: `tyre[${slot}]`,
              minY: +(v.y - spec.wheelRadius * car.scale).toFixed(4),
              maxY: +(v.y + spec.wheelRadius * car.scale).toFixed(4),
              road: +ground.toFixed(4),
              clearance: +(v.y - spec.wheelRadius * car.scale - ground).toFixed(4),
            });
          }
        }
      }
    }

    // ---------------------------------------------------------------- pair overlap
    // Two vehicles overlap when the distance between their footprint rectangles (each rotated to its
    // own heading) is negative; the penetration depth is what the brief caps at 0.2 m.
    const footprint = (x, z, heading, halfLength, halfWidth) => {
      const fx = -Math.sin(heading);
      const fz = -Math.cos(heading);
      const rx = Math.cos(heading);
      const rz = -Math.sin(heading);
      return { x, z, fx, fz, rx, rz, halfLength, halfWidth };
    };
    const separation = (a, b) => {
      // Along each of the four axes (both cars' forward and right), the gap on that axis.
      let worst = -Infinity;
      for (const axis of [
        { x: a.fx, z: a.fz },
        { x: a.rx, z: a.rz },
        { x: b.fx, z: b.fz },
        { x: b.rx, z: b.rz },
      ]) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const centre = Math.abs(dx * axis.x + dz * axis.z);
        const halfA = Math.abs(a.fx * axis.x + a.fz * axis.z) * a.halfLength + Math.abs(a.rx * axis.x + a.rz * axis.z) * a.halfWidth;
        const halfB = Math.abs(b.fx * axis.x + b.fz * axis.z) * b.halfLength + Math.abs(b.rx * axis.x + b.rz * axis.z) * b.halfWidth;
        worst = Math.max(worst, centre - (halfA + halfB));
      }
      return -worst; // positive = penetration depth
    };

    const placed = [];
    if (traffic?.meshes) {
      for (const [shapeName, bucket] of Object.entries(traffic.meshes)) {
        const spec = bucket.spec;
        for (const car of traffic.cars) {
          if (car.shape !== shapeName) continue;
          if (traffic.stagedOnly && !car.castAt && !car.driven) continue;
          placed.push(
            footprint(
              car.x,
              car.z,
              car.heading,
              (spec.halfLength ?? spec.length * 0.5) * car.scale,
              spec.waistW * car.scale,
            ),
          );
          placed[placed.length - 1].label = `traffic#${car.index}(${shapeName})`;
        }
      }
    }
    if (hero) {
      placed.push(footprint(hero.position.x, hero.position.z, hero.heading, hero.spec.halfLength, hero.spec.waistW));
      placed[placed.length - 1].label = 'hero';
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const depth = separation(placed[i], placed[j]);
        if (depth > 0.0001) {
          out.overlaps.push({
            a: placed[i].label,
            b: placed[j].label,
            depth: +depth.toFixed(3),
            over: depth > OVERLAP_LIMIT,
          });
        }
      }
    }

    return out;
  },
  { OVERLAP_LIMIT },
);

await browser.close();

const wheelsTouching = report.wheels.filter((w) => Math.abs(w.clearance) <= TOUCH_TOLERANCE);
const wheelsFloating = report.wheels.filter((w) => w.clearance > TOUCH_TOLERANCE);
const wheelsSunk = report.wheels.filter((w) => w.clearance < -TOUCH_TOLERANCE);
const overlaps = report.overlaps.filter((o) => o.over);
const ok = wheelsFloating.length === 0 && wheelsSunk.length === 0 && overlaps.length === 0 && errors.length === 0;

if (asJson) {
  console.log(JSON.stringify({ ok, ...report, errors }, null, 1));
} else {
  console.log(`car audit — shot ${shot}`);
  console.log('');
  for (const [shape, data] of Object.entries(report.shapes)) {
    const s = data.spec;
    console.log(
      `${shape.padEnd(6)} R=${s.wheelRadius} wb=${s.wheelBase} track=${s.wheelTrack} sill=${s.sill} roof=${s.roof} nose=${s.noseZ} tail=${s.tailZ}`,
    );
    for (const [bucket, b] of Object.entries(data.buckets)) {
      if (!b) continue;
      console.log(
        `  ${bucket.padEnd(6)} y ${String(b.min[1]).padStart(7)}..${String(b.max[1]).padStart(6)}  x ${String(b.min[0]).padStart(6)}..${String(b.max[0]).padStart(6)}  z ${String(b.min[2]).padStart(6)}..${String(b.max[2]).padStart(6)}  tris ${b.triangles}`,
      );
    }
  }
  console.log('');
  console.log(`wheels — ${report.wheels.length} measured, tolerance ±${TOUCH_TOLERANCE} m`);
  for (const w of report.wheels) {
    const verdict = Math.abs(w.clearance) <= TOUCH_TOLERANCE ? 'ON ROAD' : w.clearance > 0 ? 'FLOATING' : 'SUNK';
    console.log(
      `  ${w.vehicle.padEnd(24)} ${w.name.padEnd(26)} world y ${String(w.minY.toFixed(3)).padStart(7)}..${w.maxY.toFixed(3)}  road ${w.road.toFixed(3)}  clearance ${(w.clearance >= 0 ? '+' : '') + w.clearance.toFixed(4)}  ${verdict}`,
    );
  }
  console.log('');
  console.log(`overlaps — limit ${OVERLAP_LIMIT} m`);
  if (!report.overlaps.length) console.log('  none: no two vehicles share any ground footprint');
  for (const o of report.overlaps) {
    console.log(`  ${o.a} x ${o.b}  depth ${o.depth.toFixed(3)} m  ${o.over ? 'OVER LIMIT' : 'within limit'}`);
  }
  if (errors.length) {
    console.log('');
    console.log('console errors:');
    for (const e of errors) console.log(`  ${e}`);
  }
  console.log('');
  console.log(
    `verdict: ${ok ? 'PASS' : 'FAIL'} — ${wheelsTouching.length}/${report.wheels.length} wheels on the road, ` +
      `${wheelsFloating.length} floating, ${wheelsSunk.length} sunk, ${overlaps.length} overlapping over ${OVERLAP_LIMIT} m`,
  );
}

if (!ok) process.exitCode = 1;
