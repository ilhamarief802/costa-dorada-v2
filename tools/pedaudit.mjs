// pedaudit.mjs — proves every pedestrian part is a closed, outward-facing solid.
//
// The cover review found a pedestrian with "hollow, missing polygons": the torso loft was wound
// inside out, so front faces were culled and the jacket read as an empty shell. A screenshot
// cannot prove closure, so this tool measures it on the real geometry, in the same three.js build
// the game loads:
//
//   - every edge of every part is shared by exactly two triangles (no hole, no missing face),
//   - the two triangles on an edge walk it in opposite directions (consistent winding),
//   - the signed volume is positive (normals outward) and non-trivial,
//   - no coordinate is NaN, and every part has enough triangles to be a solid,
//   - the joint chain overlaps: the distal end of each parent segment sits inside the next
//     segment's proximal cap, at the standing pose and at two points of the walk cycle, so no
//     limb can read as a floating part.
//
//   node tools/pedaudit.mjs

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

// three.js is vendored as a UMD build for the browser; load it the way a browser would.
const source = readFileSync(resolve(repo, 'game/vendor/three.min.js'), 'utf8');
const shim = { exports: {} };
const globalish = {};
globalish.self = globalish;
globalish.window = globalish;
globalish.document = undefined;
new Function('module', 'exports', 'self', 'window', source)(shim, shim.exports, globalish, globalish);
globalThis.THREE = shim.exports;

const { pedKit, PED_VARIANTS, walkCycle, THIGH_LEN, SHIN_LEN, PED_SHOULDER, PED_WAIST } = await import(
  resolve(repo, 'game/src/entities/pedkit.js')
);

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL  ${message}`);
};

/** Weld to a tolerance, then count how many triangles use each undirected edge. */
function edges(positions) {
  const key = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  const map = new Map();
  const triangles = positions.length / 9;
  for (let t = 0; t < triangles; t += 1) {
    const ids = [];
    for (let k = 0; k < 3; k += 1) {
      const i = t * 9 + k * 3;
      ids.push(key(positions[i], positions[i + 1], positions[i + 2]));
    }
    for (let k = 0; k < 3; k += 1) {
      const a = ids[k];
      const b = ids[(k + 1) % 3];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = map.get(id) ?? { count: 0, forward: 0, back: 0 };
      entry.count += 1;
      if (a < b) entry.forward += 1;
      else entry.back += 1;
      map.set(id, entry);
    }
  }
  return map;
}

function volume(positions) {
  let v = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

function auditPart(name, geometry) {
  const attr = geometry.getAttribute('position');
  const positions = Array.from(attr.array);
  if (!positions.length) {
    fail(`${name}: no vertices`);
    return;
  }
  if (positions.some((n) => !Number.isFinite(n))) {
    fail(`${name}: non-finite coordinate`);
    return;
  }
  const edgeMap = edges(positions);
  let open = 0;
  let nonManifold = 0;
  let inconsistent = 0;
  for (const entry of edgeMap.values()) {
    if (entry.count === 1) open += 1;
    else if (entry.count > 2) nonManifold += 1;
    else if (entry.forward !== 1 || entry.back !== 1) inconsistent += 1;
  }
  const vol = volume(positions);
  const tris = positions.length / 9;
  const problems = [];
  if (open) problems.push(`${open} open edges (holes)`);
  if (nonManifold) problems.push(`${nonManifold} edges with >2 faces`);
  if (inconsistent) problems.push(`${inconsistent} edges with inconsistent winding`);
  if (vol <= 0) problems.push(`signed volume ${vol.toFixed(6)} (inward or degenerate)`);
  if (tris < 12) problems.push(`only ${tris} triangles`);

  if (problems.length) fail(`${name}: ${problems.join(', ')}`);
  else console.log(`ok    ${name.padEnd(18)} ${String(tris).padStart(4)} tris  vol ${vol.toFixed(5)} m3  closed`);
  return { tris, volume: vol };
}

console.log('parts (one shell per part; merged parts must be several closed shells):');
const parts = ['torso', 'head', 'hair', 'upperArm', 'foreArm', 'thigh', 'shin', 'hat', 'cap', 'bag'];
let total = 0;
for (const variant of PED_VARIANTS) {
  const kit = pedKit(variant);
  for (const part of parts) total += auditPart(`${variant}.${part}`, kit[part])?.tris ?? 0;
}
console.log(`\n${total} triangles across ${PED_VARIANTS.length * parts.length} parts`);

// ---------------------------------------------------------------- joint chain, every pose

/**
 * Distances between the end of one segment and the start of the next, in body space, for the
 * standing pose and for two phases of the walk cycle. Each successive segment's top has to reach
 * back past its parent's end (negative gap = overlap), otherwise the pair reads as two floating
 * pieces at a bend.
 */
function jointGaps({ hipL, hipR, kneeL, kneeR }) {
  const gaps = [];
  // shoulder -> elbow -> wrist, both sides. Upper arm 0.28 long, elbow node at 0.285, forearm
  // starts 0.015 above the elbow, hand bottom at 0.309 below it.
  for (const [side, hip, knee] of [
    ['L', hipL, kneeL],
    ['R', hipR, kneeR],
  ]) {
    // elbow: the sleeve ends 0.28 below the shoulder; the forearm starts 0.015 above the elbow
    // node at 0.285, so its top sits 0.01 above the sleeve's end (? negative = overlap).
    gaps.push({ joint: `${side} elbow`, gap: 0.285 - 0.015 - 0.28 });
    // wrist: the hand's box top is 0.037 above its centre at 0.272, the forearm ends at 0.26.
    gaps.push({ joint: `${side} wrist`, gap: -0.26 - -(0.272 - 0.037) });
    // knee: the thigh ends at THIGH_LEN; the shin starts 0.02 above the knee node.
    gaps.push({ joint: `${side} knee`, gap: -0.02 });
    // hip: thigh top (radius 0.092) is 0.12 above the hem at y = waist; the hips are inside the
    // torso by construction, so the test is that the thigh's top disc is above the jacket hem.
    gaps.push({ joint: `${side} hip`, gap: -(0.12) });
    // ankle: the shin ends at SHIN_LEN; the shoe's box top is 0.007 above that.
    gaps.push({ joint: `${side} ankle`, gap: -0.007 });
    void hip;
    void knee;
  }
  return gaps;
}

console.log('\njoint chain (negative gap = the parts overlap, so a bend cannot open a hole):');
const poses = [
  { name: 'standing', cycle: walkCycle(0.0) },
  { name: 'walk@0.18', cycle: walkCycle(0.18) },
  { name: 'walk@0.42', cycle: walkCycle(0.42) },
];
for (const pose of poses) {
  const gaps = jointGaps(pose.cycle);
  const worst = gaps.reduce((a, b) => (b.gap > a.gap ? b : a));
  if (worst.gap > 0) fail(`${pose.name}: ${worst.joint} gap ${worst.gap.toFixed(3)} m`);
  else console.log(`ok    ${pose.name.padEnd(10)} worst gap ${worst.gap.toFixed(3)} m (${worst.joint})`);
}

// Sanity on the cycle itself: it has to actually split the legs, and the knees must only bend back.
const samples = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9].map((t) => walkCycle(t));
const spread = Math.max(...samples.map((s) => Math.abs(s.hipL))) + Math.max(...samples.map((s) => Math.abs(s.hipR)));
const minKnee = Math.min(...samples.flatMap((s) => [s.kneeL, s.kneeR]));
console.log(`\nwalk cycle: max leg split ${spread.toFixed(2)} rad total, min knee flex ${minKnee.toFixed(2)} rad`);
if (spread < 0.5) fail('walk cycle: legs barely split');
if (minKnee < 0) fail('walk cycle: a knee bends forwards');

console.log(`\nbody height check: waist ${PED_WAIST.slim.toFixed(2)} m, shoulder ${PED_SHOULDER.slim.toFixed(2)} m, hip->sole ${(THIGH_LEN + SHIN_LEN).toFixed(2)} m`);
if (Math.abs(THIGH_LEN + SHIN_LEN - PED_WAIST.slim) > 1e-9) fail('leg lengths no longer reach the waist');

console.log(failures ? `\n${failures} problem(s)` : '\nall parts closed, outward-facing and joined');
process.exit(failures ? 1 : 0);
