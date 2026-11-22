// Floating-geometry audit.
//
// Every drawn part gets a world-space bounding box, then is held up when one of three things is
// true:
//
//   1. it reaches the ground — the terrain height field under its own footprint, a pier deck, the
//      promenade, or the water surface;
//   2. it intersects a *structural* part — a building mass, a tower tier, a roof cap, a facade
//      ledge, a landmark shaft, the elevated deck and its pillars, the marina board;
//   3. it intersects another part that is already held up (a lamp globe on its post, a sign panel
//      on its own legs, a shoe on a shin).
//
// Structural parts are the ones the modules tag with `userData.structural`, so the audit can never
// disagree with the renderer about where a wall is: they are the same boxes. A merged *candidate*
// mesh is split into 12 m clusters first, so one mesh holding every panel in the city is audited
// once per place it appears rather than as one city-wide smear.
//
//   node tools/geometry-audit.mjs [shot] [--json] [--verbose]
//
// Exit code 1 when anything floats, so it can gate a commit.

import { chromium } from '/home/ilham/.hermes/hermes-agent/node_modules/playwright-core/index.mjs';

const executablePath = '/home/ilham/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const base = process.env.PROBE_BASE ?? 'http://localhost:8080';

const args = process.argv.slice(2);
const shot = args.find((a) => !a.startsWith('--')) ?? 'cover';
const asJson = args.includes('--json');
const verbose = args.includes('--verbose');
const selfTest = args.includes('--selftest');

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`${base}/?shot=${shot}&seed=1&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__SHOT_READY === true, null, { timeout: 120000 });

const report = await page.evaluate(({ selfTest }) => {
  const g = window.__GAME;
  const plan = g.plan;
  const CLUSTER = 12;

  // Self-test: drop one deliberately detached panel 30 m up beside the boulevard. A passing audit
  // reports exactly this one part; an audit that reports nothing is broken, not clean.
  if (selfTest) {
    const probe = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshBasicMaterial({ color: 0xff00ff }),
    );
    probe.position.set(28.4, 31.0, 118.0);
    probe.name = 'selftest-floater';
    g.scene.add(probe);
    // The probe is placed after boot, so its world matrix has to be brought up to date before it
    // is measured — otherwise it is audited at the origin and reported as sitting on the ground.
    g.scene.updateMatrixWorld(true);
  }

  const parts = [];
  const matrix = new THREE.Matrix4();
  const world = new THREE.Matrix4();

  const add = (group, label, structural, min, max, extra = {}) => {
    parts.push({
      group,
      label,
      structural,
      min: [min.x, min.y, min.z],
      max: [max.x, max.y, max.z],
      span: Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z),
      ...extra,
    });
  };

  /** Cluster a geometry into 12 m buckets of whole triangles, measured in world space. */
  const clustersOf = (geometry, meshMatrix) => {
    const pos = geometry.getAttribute('position');
    const index = geometry.index;
    const tris = (index ? index.count : pos.count) / 3;
    const buckets = new Map();
    const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let t = 0; t < tris; t += 1) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < 3; k += 1) {
        const at = index ? index.getX(t * 3 + k) : t * 3 + k;
        tri[k].set(pos.getX(at), pos.getY(at), pos.getZ(at)).applyMatrix4(meshMatrix);
        cx += tri[k].x;
        cy += tri[k].y;
        cz += tri[k].z;
      }
      const key = `${Math.floor(cx / 3 / CLUSTER)},${Math.floor(cy / 3 / CLUSTER)},${Math.floor(cz / 3 / CLUSTER)}`;
      let entry = buckets.get(key);
      if (!entry) {
        entry = { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity) };
        buckets.set(key, entry);
      }
      for (let k = 0; k < 3; k += 1) {
        entry.min.min(tri[k]);
        entry.max.max(tri[k]);
      }
    }
    return [...buckets.values()];
  };

  // Celestial bodies hang in the sky by definition: the dome, the star field, the moon and the sun
  // sprite are atmosphere, not matter, and auditing them for "support" is a category error.
  const CELESTIAL = new Set(['moon', 'stars', 'sky']);
  const isCelestial = (object, group, label) =>
    CELESTIAL.has(group) || CELESTIAL.has(label) || label.includes('ShaderMaterial') || object.isSprite;

  g.scene.traverse((object) => {
    if (!object.isMesh) return;
    let owner = object.parent;
    while (owner && !owner.name && owner.parent) owner = owner.parent;
    const group = owner?.name || 'scene';
    const label = object.name || `${object.material?.type ?? object.type}#${object.material?.color?.getHexString?.() ?? ''}`;
    if (isCelestial(object, group, label)) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();

    // Structure is whatever the modules tagged as such, plus the highway and landmark masses in
    // the plan (which are one mesh per feature and already per-place boxes).
    const structural = object.userData?.structural === true;
    if (group === 'terrain' || group === 'roads' || group === 'blocks') return;

    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i += 1) {
        object.getMatrixAt(i, matrix);
        world.multiplyMatrices(object.matrixWorld, matrix);
        const b = new THREE.Box3().copy(object.geometry.boundingBox).applyMatrix4(world);
        add(group, label, structural, b.min, b.max, { kind: 'instance', index: i });
      }
      return;
    }
    for (const entry of clustersOf(object.geometry, object.matrixWorld)) {
      add(group, label, structural, entry.min, entry.max, { kind: 'mesh' });
    }
  });

  // Landmark structure is one mesh per feature and is not tagged: a shaft is structural when it
  // is tall and its base reaches the plaza, a rail or a board when it is bolted to one.
  const WALL_LABELS = new Set(['masses', 'roof-caps', 'ledges']);
  const structure = parts.filter((p) => p.structural || WALL_LABELS.has(p.label));
  const candidates = parts.filter((p) => !p.structural && !WALL_LABELS.has(p.label));

  const groundUnder = (p) => {
    let y = -Infinity;
    for (const x of [p.min[0], (p.min[0] + p.max[0]) / 2, p.max[0]]) {
      for (const z of [p.min[2], (p.min[2] + p.max[2]) / 2, p.max[2]]) {
        y = Math.max(y, plan.groundHeight(x, z));
      }
    }
    return y;
  };

  // Broad phase: rasterise each box into every X/Z cell it spans, so a 456 m deck is visible to a
  // rail bolted at its far end.
  const CELL = 16;
  const bucketOf = (list) => {
    const map = new Map();
    list.forEach((p, i) => {
      const x0 = Math.floor(p.min[0] / CELL);
      const x1 = Math.floor(p.max[0] / CELL);
      const z0 = Math.floor(p.min[2] / CELL);
      const z1 = Math.floor(p.max[2] / CELL);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 8192) {
        const k = `${Math.floor((p.min[0] + p.max[0]) / 2 / CELL)},${Math.floor((p.min[2] + p.max[2]) / 2 / CELL)}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(i);
        return;
      }
      for (let x = x0; x <= x1; x += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const k = `${x},${z}`;
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(i);
        }
      }
    });
    return map;
  };
  const wallBuckets = bucketOf(structure);
  const propBuckets = bucketOf(candidates);

  const around = (map, list, p) => {
    const bx = Math.floor((p.min[0] + p.max[0]) / 2 / CELL);
    const bz = Math.floor((p.min[2] + p.max[2]) / 2 / CELL);
    const out = [];
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        const hit = map.get(`${bx + ox},${bz + oz}`);
        if (hit) for (const j of hit) out.push(j);
      }
    }
    return out;
  };

  const tol = 0.1;
  const overlaps = (a, b, m = tol) =>
    a.min[0] <= b.max[0] + m && a.max[0] >= b.min[0] - m &&
    a.min[1] <= b.max[1] + m && a.max[1] >= b.min[1] - m &&
    a.min[2] <= b.max[2] + m && a.max[2] >= b.min[2] - m;

  const held = new Uint8Array(candidates.length);
  const why = new Array(candidates.length).fill(null);
  const settle = () => {
    let changed = false;
    candidates.forEach((p, i) => {
      if (held[i]) return;
      if (p.min[1] <= groundUnder(p) + 0.08) {
        held[i] = 1;
        why[i] = 'ground';
        changed = true;
        return;
      }
      for (const j of around(wallBuckets, structure, p)) {
        if (overlaps(p, structure[j])) {
          held[i] = 1;
          why[i] = `wall:${structure[j].label}`;
          changed = true;
          return;
        }
      }
      for (const j of around(propBuckets, candidates, p)) {
        if (j === i || !held[j]) continue;
        if (overlaps(p, candidates[j], 0.05)) {
          held[i] = 1;
          why[i] = 'prop';
          changed = true;
          return;
        }
      }
    });
    return changed;
  };
  for (let pass = 0; pass < 10 && settle(); pass += 1);

  const floating = candidates.filter((p, i) => !held[i]);
  const grouped = new Map();
  for (const p of floating) {
    const k = `${p.group}/${p.label}`;
    if (!grouped.has(k)) grouped.set(k, { where: k, count: 0, worst: null, sample: [] });
    const entry = grouped.get(k);
    entry.count += 1;
    const y = (p.min[1] + p.max[1]) / 2;
    if (!entry.worst || y > entry.worst.y) {
      entry.worst = {
        y: Number(y.toFixed(2)),
        x: Number(((p.min[0] + p.max[0]) / 2).toFixed(1)),
        z: Number(((p.min[2] + p.max[2]) / 2).toFixed(1)),
        baseY: Number(p.min[1].toFixed(2)),
        topY: Number(p.max[1].toFixed(2)),
        ground: Number(groundUnder(p).toFixed(2)),
        span: Number(p.span.toFixed(1)),
      };
    }
    if (entry.sample.length < 12) {
      entry.sample.push({
        at: [Number(((p.min[0] + p.max[0]) / 2).toFixed(1)), Number(p.min[1].toFixed(2)), Number(((p.min[2] + p.max[2]) / 2).toFixed(1))],
        size: [Number((p.max[0] - p.min[0]).toFixed(1)), Number((p.max[1] - p.min[1]).toFixed(1)), Number((p.max[2] - p.min[2]).toFixed(1))],
      });
    }
  }

  const counts = {};
  for (const r of why) if (r) counts[r] = (counts[r] ?? 0) + 1;

  return {
    parts: parts.length,
    structure: structure.length,
    candidates: candidates.length,
    counts,
    floating: floating.length,
    groups: [...grouped.values()].sort((a, b) => b.count - a.count),
    probe: parts.filter((p) => p.label.includes('selftest')).map((p) => ({ label: p.label, min: p.min, structural: p.structural, held: held[candidates.indexOf(p)] })),
  };
}, { selfTest });

await browser.close();

if (asJson) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`geometry audit — shot ${shot}`);
  console.log(`  parts ${report.parts}   structure ${report.structure}   audited ${report.candidates}`);
  console.log(`  held ${JSON.stringify(report.counts)}`);
  if (!report.floating) {
    console.log('  nothing floats.');
  } else {
    console.log(`  FLOATING ${report.floating} part(s) in ${report.groups.length} group(s)`);
    for (const group of report.groups) {
      const w = group.worst;
      console.log(`   ${String(group.count).padStart(4)}  ${group.where}  y ${w.baseY}..${w.topY} (ground ${w.ground}) at (${w.x}, ${w.z}) span ${w.span}`);
      if (verbose) console.log(`         ${JSON.stringify(group.sample)}`);
    }
  }
  if (pageErrors.length) console.log(`  page errors: ${pageErrors.join(' | ')}`);
}

process.exit(report.floating > 0 ? 1 : 0);
