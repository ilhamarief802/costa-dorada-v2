// Pedestrian bodies, authored once, as closed solids.
//
// The body is built from watertight pieces only: every part is a closed shell whose every edge is
// shared by exactly two triangles, wound so the normals face outward. A limb is a lathe (a capped
// tube) and a hand or a shoe is a box with all six faces — there are no open-ended cylinders in
// here, because an open cylinder is a one-sided shell: from outside you see its far inner wall, the
// near wall is culled, and the part reads as a hole. That was the defect in the cover frame: the
// torso loft was wound inside out (both caps and the whole side wall), so the white jacket in the
// bottom-left showed an empty shell instead of a body.
//
// Each silhouette is lofted vertically: hips narrow, shoulders wide, a jacket hem that flares past
// the waist, a collar standing up around the neck. Arms and legs are tapered lathes rather than
// tubes so wrists and ankles read at a distance. Four silhouettes (slim, broad, long coat, short
// jacket) times per-person height, girth and colour give the crowd variety; the caller instances
// them and drives the joints.
//
// Winding convention, used by every builder below: rings run counter-clockwise seen from +y
// (x = cos, z = sin), a side quad is (a_i, b_i, b_j) + (a_i, b_j, a_j), the bottom cap fan is
// (centre, i, j) and the top cap fan is (centre, j, i). `closeShell` then measures the signed
// volume and flips every triangle if the shell came out inward, so a slip in an author's numbers
// cannot ship an inside-out body again.

import { mergeGeometries } from '../core/geom.js';

const RING = 12;

/** A ring of RING points on an ellipse, at height y, optionally offset sideways. */
function ellipse(y, w, d, ox = 0, oz = 0) {
  const points = [];
  for (let i = 0; i < RING; i += 1) {
    const angle = (i / RING) * Math.PI * 2;
    points.push({ x: Math.cos(angle) * w + ox, y, z: Math.sin(angle) * d + oz });
  }
  return points;
}

/** Signed volume of a triangle soup: positive when the shell faces outward. */
function signedVolume(positions) {
  let volume = 0;
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
    volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return volume / 6;
}

/**
 * Turn a triangle soup into a BufferGeometry with vertex colours, and guarantee the shell faces
 * outward: if the signed volume is negative every triangle is reversed before normals are built.
 */
function closeShell(positions, colors) {
  const volume = signedVolume(positions);
  if (volume < 0) {
    for (let i = 0; i < positions.length; i += 9) {
      for (let k = 0; k < 3; k += 1) {
        const p = positions[i + 3 + k];
        positions[i + 3 + k] = positions[i + 6 + k];
        positions[i + 6 + k] = p;
        const c = colors[i + 3 + k];
        colors[i + 3 + k] = colors[i + 6 + k];
        colors[i + 6 + k] = c;
      }
    }
  } else if (volume === 0) {
    // A zero-volume shell is degenerate: a closed shape with no interior cannot be a limb.
    throw new Error('pedkit: closed shell has zero volume');
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const uv = new Float32Array((positions.length / 3) * 2).fill(0.5);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A closed solid of revolution: `slices` run bottom to top as { y, w, d, ox, oz } and the shell is
 * capped at both ends, so the part has no rim a camera can see into. This single builder makes the
 * torso, the collar, the limbs, the sleeves' cuffs, the belt and the hat crowns.
 */
function latheSolid(slices, tint) {
  const rings = slices.map((slice) => ellipse(slice.y, slice.w, slice.d, slice.ox ?? 0, slice.oz ?? 0));
  const positions = [];
  const colors = [];
  const push = (p, ring) => {
    positions.push(p.x, p.y, p.z);
    const c = tint(ring, p.y);
    colors.push(c[0], c[1], c[2]);
  };

  // Side wall: two triangles per ring step, outward-facing in the convention above.
  for (let r = 0; r < rings.length - 1; r += 1) {
    const a = rings[r];
    const b = rings[r + 1];
    for (let i = 0; i < RING; i += 1) {
      const j = (i + 1) % RING;
      push(a[i], r);
      push(b[i], r + 1);
      push(b[j], r + 1);
      push(a[i], r);
      push(b[j], r + 1);
      push(a[j], r);
    }
  }

  // Caps: a triangle fan to the ring's own centre, each triangle one face of the lid.
  const first = rings[0];
  const last = rings[rings.length - 1];
  const bottomCentre = { x: slices[0].ox ?? 0, y: slices[0].y, z: slices[0].oz ?? 0 };
  const topCentre = {
    x: slices[slices.length - 1].ox ?? 0,
    y: slices[slices.length - 1].y,
    z: slices[slices.length - 1].oz ?? 0,
  };
  for (let i = 0; i < RING; i += 1) {
    const j = (i + 1) % RING;
    push(bottomCentre, 0);
    push(first[i], 0);
    push(first[j], 0);
    push(topCentre, slices.length - 1);
    push(last[j], slices.length - 1);
    push(last[i], slices.length - 1);
  }

  return closeShell(positions, colors);
}

/** A capped tapered limb from its joint at y = 0 down to y = -length. */
function limb(rTop, rBot, length, tint, segments = RING) {
  // Bottom ring first, then the joint ring: a two-ring capped lathe, one segment long.
  return latheAt(
    [
      { y: -length, w: rBot, d: rBot },
      { y: 0, w: rTop, d: rTop },
    ],
    tint,
    segments,
  );
}

/** latheSolid with a chosen ring resolution (12 for the body, 8 for small trims). */
function latheAt(slices, tint, segments) {
  const rings = [];
  for (const slice of slices) {
    const ring = [];
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push({ x: Math.cos(angle) * slice.w, y: slice.y, z: Math.sin(angle) * slice.d });
    }
    rings.push(ring);
  }
  const positions = [];
  const colors = [];
  const push = (p, r) => {
    positions.push(p.x, p.y, p.z);
    const c = tint(r, p.y);
    colors.push(c[0], c[1], c[2]);
  };
  for (let r = 0; r < rings.length - 1; r += 1) {
    const a = rings[r];
    const b = rings[r + 1];
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      push(a[i], r);
      push(b[i], r + 1);
      push(b[j], r + 1);
      push(a[i], r);
      push(b[j], r + 1);
      push(a[j], r);
    }
  }
  const first = rings[0];
  const last = rings[rings.length - 1];
  const y0 = slices[0].y;
  const y1 = slices[slices.length - 1].y;
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    push({ x: 0, y: y0, z: 0 }, 0);
    push(first[i], 0);
    push(first[j], 0);
    push({ x: 0, y: y1, z: 0 }, slices.length - 1);
    push(last[j], slices.length - 1);
    push(last[i], slices.length - 1);
  }
  return closeShell(positions, colors);
}

const flat = (value) => () => [value, value, value];

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
  // Hem and shoulders catch light; the waist sits in shadow.
  const jacket = latheSolid(slices, (r, y) => {
    const v = r >= 5 ? 0.92 : 0.7 + (y - cfg.hem) * 0.36;
    return [v, v, v];
  });

  // Collar: a closed tapering shell around the neck, cream, capped top and bottom so no rim shows
  // the inside of the jacket when the camera looks down it.
  const collar = latheAt(
    [
      { y: cfg.top + 0.055, w: cfg.collar * 1.24, d: cfg.collar * 1.18 },
      { y: cfg.top + 0.19, w: cfg.collar, d: cfg.collar * 0.95 },
    ],
    flat(0.98),
    9,
  );

  // Lapel wedges: two angled slabs down the chest, a shade darker than the jacket. A box has all
  // six faces, so each wedge is a closed solid on its own.
  const lapels = [];
  for (const side of [-1, 1]) {
    const wedge = new THREE.BoxGeometry(0.065, 0.26, 0.02);
    wedge.rotateZ(side * 0.22);
    wedge.translate(side * 0.062, cfg.top - 0.16, cfg.chest * 0.5);
    lapels.push({ geometry: wedge, color: 0x9a9a9a });
  }

  // Belt line, so a coat reads as a coat rather than a tube: a closed capped ring at the waist.
  const belt = latheAt(
    [
      { y: cfg.waistY - 0.018, w: cfg.waist * 1.06, d: cfg.waist * 0.64 },
      { y: cfg.waistY + 0.018, w: cfg.waist * 1.06, d: cfg.waist * 0.64 },
    ],
    flat(0.66),
    10,
  );

  return mergeGeometries([
    { geometry: jacket, color: 0xffffff },
    { geometry: collar, color: 0xfaf6ee },
    ...lapels,
    { geometry: belt, color: 0xa8a49a },
  ]);
}

function headGeometry(variant) {
  const long = variant === 'coat' || variant === 'slim';
  // Skull and jaw are lathed ellipsoids rather than three.js spheres: a sphere's pole rows carry
  // degenerate triangles whose welded edges meet three faces at once, which is a shading artefact
  // and, to any closure test, a defect. A capped lathe has clean poles and a flat, hidden lid.
  const skull = latheSolid(
    ellipsoidSlices(0.132 * 1.12, 0.132 * 0.92, 0.132 * (long ? 1.04 : 0.98), 7),
    flat(1),
  );
  const jaw = latheSolid(ellipsoidSlices(0.082 * 0.82, 0.082 * 1.05, 0.082 * 1.1, 5), flat(0.95));
  jaw.translate(0, -0.098, 0.028);
  // The nose is a lathed cone with a small flat tip rather than a three.js cone: a cone's apex is
  // five coincident vertices, and a welded closure test reads that point as five faces meeting.
  const nose = latheAt(
    [
      { y: -0.031, w: 0.026, d: 0.026 },
      { y: 0.031, w: 0.006, d: 0.006 },
    ],
    flat(0.92),
    6,
  );
  nose.rotateX(Math.PI / 2);
  nose.translate(0, -0.024, 0.126);
  const ear = new THREE.BoxGeometry(0.03, 0.055, 0.03);
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

/**
 * Horizontal slices of an ellipsoid, bottom to top, for `latheSolid`. The top and bottom rings keep
 * a small radius instead of collapsing to a point, so each is a real lid rather than a fan of
 * zero-area triangles.
 */
function ellipsoidSlices(ry, rx, rz, rows) {
  const slices = [];
  const limit = 1.45; // radians from the equator: a ~0.12 r lid at each pole
  for (let i = 0; i <= rows; i += 1) {
    const phi = -limit + (i / rows) * limit * 2;
    slices.push({ y: Math.sin(phi) * ry, w: Math.cos(phi) * rx, d: Math.cos(phi) * rz });
  }
  return slices;
}

/** Hair: a closed cap with a fringe and a couple of locks, so profiles are not bald spheres. */
function hairGeometry(variant) {
  // A closed dome: rings up from a rim just inside the skull, capped at the crown and at the rim,
  // never a one-sided hemisphere.
  const cap = latheAt(
    [
      { y: -0.05, w: 0.095, d: 0.1 },
      { y: 0.0, w: 0.135, d: 0.14 },
      { y: 0.07, w: 0.115, d: 0.12 },
      { y: 0.12, w: 0.065, d: 0.07 },
    ],
    flat(1),
    10,
  );
  cap.translate(0, 0.012, -0.008);
  const slice = [{ geometry: cap, color: 0xffffff }];
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
  const sleeve = limb(0.055, 0.042, 0.28, flat(1));
  // The cuff is a closed capped ring around the sleeve's end, not an open tube: a tube with no
  // caps is a hole the moment the camera sees the arm from below.
  const cuff = latheAt(
    [
      { y: -0.298, w: 0.0465, d: 0.0465 },
      { y: -0.27, w: 0.0465, d: 0.0465 },
    ],
    flat(0.99),
    8,
  );
  return mergeGeometries([
    { geometry: sleeve, color: 0xffffff },
    { geometry: cuff, color: 0xfdfbf6 },
  ]);
}

function foreArmGeometry() {
  // The forearm's top runs 15 mm back up inside the sleeve's cuff, so a bent elbow can never open
  // a gap between the sleeve and the arm: the two solids overlap at the joint instead of meeting.
  const skin = limb(0.04, 0.03, 0.275, flat(1));
  skin.translate(0, 0.015, 0);
  const hand = new THREE.BoxGeometry(0.062, 0.086, 0.05);
  hand.scale(1, 0.86, 1.16);
  hand.translate(0, -0.272, 0.006);
  const thumb = new THREE.BoxGeometry(0.026, 0.036, 0.026);
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
  return limb(0.092, 0.062, THIGH_LEN, flat(1));
}

function shinGeometry() {
  // 20 mm of shin sits above the knee inside the thigh, so a flexed knee stays covered.
  const shin = limb(0.062, 0.036, SHIN_LEN + 0.02, flat(1));
  shin.translate(0, 0.02, 0);
  const ankle = latheAt(
    [
      { y: -SHIN_LEN - 0.012, w: 0.033, d: 0.033 },
      { y: -SHIN_LEN + 0.033, w: 0.036, d: 0.036 },
    ],
    flat(0.88),
    8,
  );
  // Shoe and heel are boxes: all six faces each, closed, overlapping the shin's end.
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
    const crown = latheAt(
      [
        { y: -0.012, w: 0.137, d: 0.14 },
        { y: 0.03, w: 0.132, d: 0.135 },
        { y: 0.062, w: 0.096, d: 0.1 },
        { y: 0.082, w: 0.03, d: 0.032 },
      ],
      flat(1),
      9,
    );
    const brim = new THREE.BoxGeometry(0.17, 0.014, 0.1);
    brim.translate(0, 0.018, 0.128);
    return mergeGeometries([{ geometry: crown, color: 0xffffff }, { geometry: brim, color: 0xf0f0f0 }]);
  }
  const brim = new THREE.CylinderGeometry(0.25, 0.25, 0.016, 10);
  brim.translate(0, 0.02, 0);
  const crown = latheAt(
    [
      { y: 0.028, w: 0.132, d: 0.132 },
      { y: 0.1, w: 0.122, d: 0.122 },
      { y: 0.136, w: 0.115, d: 0.115 },
    ],
    flat(0.95),
    9,
  );
  const band = new THREE.CylinderGeometry(0.134, 0.134, 0.026, 9);
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

// ------------------------------------------------------------------ the walk cycle

/**
 * One walk cycle, in turns: 0 is left heel strike, 0.25 left mid-stance, 0.5 right heel strike,
 * 0.75 right mid-stance. Returns the joint angles a standing and a walking pose are both read
 * from, so the cover frame catches the foreground three at a known point of the stride instead of
 * at whatever angle an additive sine happened to be at when the shutter opened.
 *
 *   hipL / hipR   thigh swing, radians, positive forward
 *   kneeL / kneeR knee flex, radians, never negative (a knee does not bend forward)
 *   armL / armR   shoulder swing, opposed to the same-side leg
 *   bob           hip rise, metres (two per stride)
 *   twist         shoulder counter-rotation against the hips, radians
 */
export function walkCycle(turns) {
  const t = ((turns % 1) + 1) % 1;
  const a = t * Math.PI * 2;
  const hipL = Math.sin(a) * 0.44;
  const hipR = -hipL;
  const kneeL = 0.06 + Math.max(0, -Math.sin(a - 0.55)) * 1.05;
  const kneeR = 0.06 + Math.max(0, -Math.sin(a - 0.55 + Math.PI)) * 1.05;
  return {
    phase: t,
    hipL,
    hipR,
    kneeL,
    kneeR,
    armL: -hipL * 0.62,
    armR: -hipR * 0.62,
    bob: Math.abs(Math.cos(a)) * 0.035,
    twist: Math.sin(a) * 0.09,
    // The left leg's swing, signed, is what the rig's staged stride expects: the right leg takes
    // the opposite sign, exactly as the cycle has it.
    stride: hipL,
  };
}

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
