// Pedestrian bodies, authored once. Each silhouette is lofted vertically: hips narrow, shoulders
// wide, a jacket hem that flares past the waist, a collar standing up around the neck. Arms and
// legs are tapered cones rather than tubes so wrists and ankles read at a distance. Four
// silhouettes (slim, broad, long coat, short jacket) times per-person height, girth and colour
// give the crowd variety; the caller instances them and drives the joints.

import { mergeGeometries } from '../core/geom.js';

const RING = 12;

function ell(angle, w, d) {
  return { x: Math.cos(angle) * w, z: Math.sin(angle) * d };
}

/** Sweep an ellipse along +y. `slices` = [{ y, w, d, ox, oz }]. */
function loftY(slices, tintFor) {
  const positions = [];
  const colors = [];
  const uvs = [];
  const rings = slices.map((slice) => {
    const points = [];
    for (let i = 0; i < RING; i += 1) {
      const p = ell((i / RING) * Math.PI * 2, slice.w, slice.d);
      points.push({ x: p.x + (slice.ox ?? 0), z: p.z + (slice.oz ?? 0) });
    }
    return points;
  });

  const push = (x, y, z, t) => {
    positions.push(x, y, z);
    uvs.push(0.5, 0.5);
    const v = tintFor(y, t);
    colors.push(v[0], v[1], v[2]);
  };

  for (let r = 0; r < rings.length - 1; r += 1) {
    const a = rings[r];
    const b = rings[r + 1];
    const ya = slices[r].y;
    const yb = slices[r + 1].y;
    for (let i = 0; i < RING; i += 1) {
      const j = (i + 1) % RING;
      push(a[i].x, ya, a[i].z, r);
      push(a[j].x, ya, a[j].z, r);
      push(b[j].x, yb, b[j].z, r + 1);

      push(a[i].x, ya, a[i].z, r);
      push(b[j].x, yb, b[j].z, r + 1);
      push(b[i].x, yb, b[i].z, r + 1);
    }
  }
  // Caps.
  const first = rings[0];
  const last = rings[rings.length - 1];
  const y0 = slices[0].y;
  const y1 = slices[slices.length - 1].y;
  for (let i = 0; i < RING; i += 1) {
    const j = (i + 1) % RING;
    push(0, y0, 0, 0);
    push(first[j].x, y0, first[j].z, 0);
    push(first[i].x, y0, first[i].z, 0);
    push(0, y1, 0, slices.length - 1);
    push(last[i].x, y1, last[i].z, slices.length - 1);
    push(last[j].x, y1, last[j].z, slices.length - 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** A taper from `r0` at the top down to `r1`, with an optional sideways offset for a knee/elbow. */
function taper(r0, r1, length, segments = 4) {
  const geometry = new THREE.CylinderGeometry(r0, r1, length, 7, segments);
  geometry.translate(0, -length / 2, 0);
  return geometry;
}

function shade(y, top, bottom, t) {
  return [t, t, t];
}

/** Variant torso: a jacket with a flared hem, a waist and a standing collar. */
function torsoGeometry(variant) {
  const cfg = {
    // All numbers are metres in body space: feet at y = 0, a 1.75 m adult.
    slim: { hip: 0.15, waist: 0.128, chest: 0.19, shoulder: 0.215, collar: 0.072, hem: 0.9, waistY: 1.02, top: 1.44, flare: 0.02 },
    broad: { hip: 0.185, waist: 0.168, chest: 0.235, shoulder: 0.265, collar: 0.082, hem: 0.9, waistY: 1.02, top: 1.43, flare: 0.045 },
    coat: { hip: 0.18, waist: 0.152, chest: 0.215, shoulder: 0.24, collar: 0.076, hem: 0.68, waistY: 1.0, top: 1.44, flare: 0.06 },
    short: { hip: 0.155, waist: 0.142, chest: 0.205, shoulder: 0.23, collar: 0.078, hem: 0.94, waistY: 1.02, top: 1.43, flare: 0.035 },
  }[variant] ?? variant;

  const slices = [
    { y: cfg.hem, w: cfg.hip + cfg.flare, d: (cfg.hip + cfg.flare) * 0.62 },
    { y: cfg.hem + 0.12, w: cfg.hip, d: cfg.hip * 0.6 },
    { y: cfg.waistY, w: cfg.waist, d: cfg.waist * 0.6 },
    { y: cfg.top - 0.1, w: cfg.chest, d: cfg.chest * 0.56 },
    { y: cfg.top, w: cfg.shoulder, d: cfg.shoulder * 0.5 },
    { y: cfg.top + 0.08, w: cfg.shoulder * 0.96, d: cfg.shoulder * 0.5 },
  ];
  const jacket = loftY(slices, (y, t) => {
    // Hem and shoulders catch light; the waist sits in shadow.
    const v = t >= 5 ? 0.92 : 0.7 + (y - cfg.hem) * 0.36;
    return [v, v, v];
  });

  const collar = new THREE.CylinderGeometry(cfg.collar, cfg.collar * 1.24, 0.11, 9, 1, true);
  collar.translate(0, cfg.top + 0.13, 0);
  const collarMesh = { geometry: collar, color: 0xfaf6ee };

  // Lapel wedges: two angled slabs down the chest, a shade darker than the jacket.
  const lapels = [];
  for (const side of [-1, 1]) {
    const wedge = new THREE.BoxGeometry(0.065, 0.26, 0.02);
    wedge.rotateZ(side * 0.22);
    wedge.translate(side * 0.062, cfg.top - 0.16, cfg.chest * 0.5);
    lapels.push({ geometry: wedge, color: 0x9a9a9a });
  }

  // Belt line, so a coat reads as a coat rather than a tube.
  const belt = new THREE.CylinderGeometry(cfg.waist * 1.06, cfg.waist * 1.06, 0.035, 10, 1, true);
  belt.translate(0, cfg.waistY, 0);

  return mergeGeometries([
    { geometry: jacket, color: 0xffffff },
    collarMesh,
    ...lapels,
    { geometry: belt, color: 0xa8a49a },
  ]);
}

function headGeometry(variant) {
  const long = variant === 'coat' || variant === 'slim';
  const skull = new THREE.SphereGeometry(0.132, 12, 10);
  skull.scale(0.92, 1.12, long ? 1.04 : 0.98);
  const jaw = new THREE.SphereGeometry(0.082, 8, 7);
  jaw.scale(1.05, 0.82, 1.1);
  jaw.translate(0, -0.098, 0.028);
  const nose = new THREE.ConeGeometry(0.026, 0.062, 5);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, -0.024, 0.126);
  const ear = new THREE.SphereGeometry(0.028, 6, 5);
  ear.scale(0.5, 1.15, 0.8);
  const left = ear.clone();
  left.translate(-0.116, 0.005, -0.012);
  const right = ear.clone();
  right.translate(0.116, 0.005, -0.012);
  return mergeGeometries([
    { geometry: skull, color: 0xffffff },
    { geometry: jaw, color: 0xf2f2f2 },
    { geometry: nose, color: 0xe4e4e4 },
    { geometry: left, color: 0xf6f6f6 },
    { geometry: right, color: 0xf6f6f6 },
  ]);
}

/** Hair: a cap with a fringe and a couple of locks, so profiles are not bald spheres. */
function hairGeometry(variant) {
  const cap = new THREE.SphereGeometry(0.139, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  cap.scale(0.96, 1.05, 1.03);
  cap.translate(0, 0.012, -0.008);
  const slice = [
    { geometry: cap, color: 0xffffff },
  ];
  if (variant === 'coat' || variant === 'broad') {
    const tail = new THREE.BoxGeometry(0.11, 0.1, 0.05);
    tail.translate(0, -0.02, -0.13);
    slice.push({ geometry: tail, color: 0xe0e0e0 });
  }
  if (variant === 'slim' || variant === 'short') {
    const fringe = new THREE.BoxGeometry(0.19, 0.035, 0.055);
    fringe.translate(0, 0.075, 0.104);
    fringe.rotateX(-0.12);
    slice.push({ geometry: fringe, color: 0xf4f4f4 });
  }
  return mergeGeometries(slice);
}

function upperArmGeometry() {
  const sleeve = taper(0.055, 0.042, 0.28);
  sleeve.translate(0, 0, 0);
  const cuff = new THREE.CylinderGeometry(0.045, 0.045, 0.028, 8);
  cuff.translate(0, -0.284, 0);
  return mergeGeometries([
    { geometry: sleeve, color: 0xffffff },
    { geometry: cuff, color: 0xfdfbf6 },
  ]);
}

function foreArmGeometry() {
  const skin = taper(0.038, 0.03, 0.26);
  const hand = new THREE.SphereGeometry(0.036, 7, 6);
  hand.scale(1, 0.86, 1.16);
  hand.translate(0, -0.272, 0.006);
  const thumb = new THREE.SphereGeometry(0.016, 5, 4);
  thumb.translate(0.026, -0.256, 0.03);
  return mergeGeometries([
    { geometry: skin, color: 0xffffff },
    { geometry: hand, color: 0xf2f2f2 },
    { geometry: thumb, color: 0xececec },
  ]);
}

// Leg segment lengths are exported so the rig and the geometry can never disagree: the hip pivot
// sits at the waist, the knee at THIGH below it, and the sole at THIGH + SHIN below that — which
// is exactly the waist height, so the feet are always on the ground.
export const THIGH_LEN = 0.5;
export const SHIN_LEN = 0.52;

function thighGeometry() {
  const thigh = taper(0.092, 0.062, THIGH_LEN, 5);
  return mergeGeometries([{ geometry: thigh, color: 0xffffff }]);
}

function shinGeometry() {
  const shin = taper(0.058, 0.036, SHIN_LEN, 5);
  const ankle = new THREE.CylinderGeometry(0.036, 0.032, 0.045, 6);
  ankle.translate(0, -SHIN_LEN + 0.012, 0);
  const shoe = new THREE.BoxGeometry(0.078, 0.05, 0.21);
  shoe.translate(0, -SHIN_LEN - 0.018, 0.042);
  const heel = new THREE.BoxGeometry(0.072, 0.03, 0.05);
  heel.translate(0, -SHIN_LEN - 0.02, -0.05);
  return mergeGeometries([
    { geometry: shin, color: 0xffffff },
    { geometry: ankle, color: 0xdedede },
    { geometry: shoe, color: 0x27292e },
    { geometry: heel, color: 0x1a1c20 },
  ]);
}

function hatGeometry(kind) {
  if (kind === 'cap') {
    const crown = new THREE.SphereGeometry(0.136, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
    crown.scale(1.02, 0.92, 1.04);
    crown.translate(0, 0.02, 0);
    const brim = new THREE.BoxGeometry(0.17, 0.014, 0.1);
    brim.translate(0, 0.018, 0.128);
    return mergeGeometries([{ geometry: crown, color: 0xffffff }, { geometry: brim, color: 0xf0f0f0 }]);
  }
  const brim = new THREE.CylinderGeometry(0.25, 0.25, 0.016, 14);
  brim.translate(0, 0.02, 0);
  const crown = new THREE.CylinderGeometry(0.115, 0.132, 0.11, 12);
  crown.translate(0, 0.082, 0);
  const band = new THREE.CylinderGeometry(0.134, 0.134, 0.026, 12);
  band.translate(0, 0.038, 0);
  return mergeGeometries([
    { geometry: brim, color: 0xffffff },
    { geometry: crown, color: 0xf2efe8 },
    { geometry: band, color: 0x6d6a62 },
  ]);
}

function bagGeometry() {
  const body = new THREE.BoxGeometry(0.2, 0.24, 0.1);
  body.translate(0, -0.16, 0);
  const flap = new THREE.BoxGeometry(0.21, 0.06, 0.11);
  flap.translate(0, -0.05, 0);
  const strap = new THREE.BoxGeometry(0.03, 0.3, 0.022);
  strap.rotateZ(0.06);
  strap.translate(0, 0.06, -0.01);
  return mergeGeometries([
    { geometry: body, color: 0xffffff },
    { geometry: flap, color: 0xdcd8d0 },
    { geometry: strap, color: 0x2c2823 },
  ]);
}

export const PED_VARIANTS = ['slim', 'broad', 'coat', 'short'];

const cache = new Map();

/** Waist, collar top and shoulder heights per variant, in absolute body space (metres). */
export const PED_WAIST = {
  slim: THIGH_LEN + SHIN_LEN,
  broad: THIGH_LEN + SHIN_LEN,
  coat: THIGH_LEN + SHIN_LEN,
  short: THIGH_LEN + SHIN_LEN,
};
const WAIST = THIGH_LEN + SHIN_LEN;
export const PED_TORSO_TOP = { slim: WAIST + 0.5, broad: WAIST + 0.49, coat: WAIST + 0.5, short: WAIST + 0.49 };
export const PED_SHOULDER = { slim: WAIST + 0.42, broad: WAIST + 0.41, coat: WAIST + 0.42, short: WAIST + 0.41 };

/**
 * Shift a geometry so its joint pivot sits at the origin. Every part is authored in absolute body
 * space (a 1.75 m adult, feet at y = 0) because that is the only way to keep the proportions
 * honest; the rig then needs each part relative to the joint that drives it, and this is the
 * conversion. Forgetting it is what makes a torso hang a full waist-height above its own hips.
 */
function rebase(geometry, dy) {
  geometry.translate(0, -dy, 0);
  return geometry;
}

/** All the shared geometries for one silhouette variant, each relative to its driving joint. */
export function pedKit(variant) {
  if (cache.has(variant)) return cache.get(variant);
  const waist = PED_WAIST[variant] ?? 1.02;
  const kit = {
    variant,
    waist,
    // Torso pivots at the waist; head, hair, hat and bag pivot at the neck.
    torso: rebase(torsoGeometry(variant), waist),
    head: headGeometry(variant),
    hair: hairGeometry(variant),
    upperArm: upperArmGeometry(),
    foreArm: foreArmGeometry(),
    thigh: thighGeometry(),
    shin: shinGeometry(),
    hat: hatGeometry('brim'),
    cap: hatGeometry('cap'),
    bag: bagGeometry(),
  };
  cache.set(variant, kit);
  return kit;
}
