// Car geometry, authored once and shared by the traffic stream and the hero coupe.
//
// A car here is ONE sculpture: a lofted shell swept along z, its cross-section at every station a
// rounded rectangle (superellipse) spanning the sill (y0) up to the beltline (y1). Every other part
// is derived from that same table, in the body's own local space, so nothing can float:
//
//   shell     — the lower body. Its lower edge is CUT BY THE WHEEL ARCH: y0(z) rides up over each
//               axle on the circle of the tyre plus a clearance, so the body can never intersect a
//               tyre, and the arch is a real opening in the geometry rather than a painted decal.
//   haunch    — the width table swells over each axle, so the flanks have shoulders.
//   cabin     — a closed shell (windscreen, roof, rear screen, two flanks with A/B/C pillars) whose
//               bottom edge is sampled off the beltline at its own z. The roof is part of the same
//               shell as the screens, so it cannot read as a plane hovering over the car.
//   lamps     — quads computed INSIDE the nose/tail section's own silhouette, sitting 4 mm proud
//               of the cap they sit on. Never in front of the body, never beside it.
//   arches    — a dark liner ring swept on the tyre's own circle inside each arch, closing the gap
//               between the tyre and the body's lower edge.
//   wheels    — four groups at (±wheelTrack, R, ±wheelBase) with R the tyre radius: the tyre's
//               lowest vertex is exactly y = 0, the car's own ground line. They spin about local x.
//
// Absolute heights: ground is y = 0, the wheel centres sit at the tyre radius, the sill runs from
// about 0.30 m up, the beltline near 1.0 m and the roof at 1.34-1.66 m depending on the shape.

const RING = 24;

/** How far inside the fender's flank line a tyre's outer face sits, in metres. */
const FLUSH_INSIDE = 0.045;

/**
 * Concatenate parts into one non-indexed geometry.
 *
 * A part that already baked its own per-vertex colours KEEPS them — that is what makes the shell's
 * shade ramp, the chrome's warm tint and the arch liner's near-black survive assembly. `color` is
 * only a fallback for a part that arrives uncoloured. (Overriding a baked colour here is how every
 * tyre arch and sill rail used to come out pure white.)
 */
export function bake(parts) {
  let total = 0;
  const prepared = [];
  for (const part of parts) {
    const raw = part.geometry ?? part;
    const source = raw.index ? raw.toNonIndexed() : raw;
    prepared.push({ source, count: source.getAttribute('position').count, tint: part.color });
    total += prepared[prepared.length - 1].count;
  }
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);
  let offset = 0;
  for (const { source, count, tint } of prepared) {
    position.set(source.getAttribute('position').array, offset * 3);
    const nrm = source.getAttribute('normal');
    if (nrm) normal.set(nrm.array, offset * 3);
    const tex = source.getAttribute('uv');
    if (tex) uv.set(tex.array, offset * 2);
    const own = source.getAttribute('color');
    if (own) {
      color.set(own.array, offset * 3);
    } else {
      const c = tint instanceof THREE.Color ? tint : new THREE.Color(tint ?? 0xffffff);
      for (let i = 0; i < count; i += 1) {
        color[(offset + i) * 3] = c.r;
        color[(offset + i) * 3 + 1] = c.g;
        color[(offset + i) * 3 + 2] = c.b;
      }
    }
    offset += count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.computeBoundingSphere();
  return merged;
}

function smooth(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ------------------------------------------------------------------ cross-sections

/**
 * One point on a section ring. `theta` = 0 is +x (the flank), pi/2 is the top of the section and
 * -pi/2 the bottom, so the ring is a closed loop and the superellipse identity
 * |x/w|^n + |dy/h|^n = 1 holds with dy measured from the section's own waist.
 */
function sectionPoint(sec, theta) {
  const waist = (sec.y0 + sec.y1) * 0.5;
  const h = (sec.y1 - sec.y0) * 0.5;
  const e = 2 / sec.n;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    x: sec.w * Math.sign(c) * Math.pow(Math.abs(c), e),
    y: waist + h * Math.sign(s) * Math.pow(Math.abs(s), e),
  };
}

/** Half width of the section at height y — used to keep decals inside the body's own silhouette. */
export function flankX(sec, y) {
  const waist = (sec.y0 + sec.y1) * 0.5;
  const h = Math.max(1e-6, (sec.y1 - sec.y0) * 0.5);
  const t = Math.abs((y - waist) / h);
  if (t >= 1) return 0;
  return sec.w * Math.pow(1 - Math.pow(t, sec.n), 1 / sec.n);
}

/** The section at an arbitrary z, interpolated between its neighbours. */
export function stationAt(sections, z) {
  if (z <= sections[0].z) return sections[0];
  const last = sections[sections.length - 1];
  if (z >= last.z) return last;
  for (let i = 0; i < sections.length - 1; i += 1) {
    const a = sections[i];
    const b = sections[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      const m = (x, y) => x + (y - x) * t;
      return { z, w: m(a.w, b.w), y0: m(a.y0, b.y0), y1: m(a.y1, b.y1), n: m(a.n, b.n) };
    }
  }
  return last;
}

// ------------------------------------------------------------------ geometry primitives

/** A quad, wound once, with a flat colour. */
function facet(quads, color) {
  const positions = [];
  const colors = [];
  const tint = new THREE.Color(color);
  for (const [a, b, c, d] of quads) {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i += 1) colors.push(tint.r, tint.g, tint.b);
  }
  return bundle(positions, colors);
}

/** A triangle list, wound once, with a flat colour. */
function triangles(list, color) {
  const positions = [];
  const colors = [];
  const tint = new THREE.Color(color);
  for (const [a, b, c] of list) {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i += 1) colors.push(tint.r, tint.g, tint.b);
  }
  return bundle(positions, colors);
}

/**
 * A two-sided strip: every quad is emitted once each way, so a strip can never be an invisible
 * backwards face — the failure mode that makes a bumper vanish while its part still exists.
 */
function strips(quads, color) {
  const positions = [];
  const colors = [];
  const tint = new THREE.Color(color);
  for (const [a, b, c, d] of quads) {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    positions.push(...a, ...c, ...b, ...a, ...d, ...c);
    for (let i = 0; i < 12; i += 1) colors.push(tint.r, tint.g, tint.b);
  }
  return bundle(positions, colors);
}

function bundle(positions, colors) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const count = positions.length / 3;
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(count * 2).fill(0), 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** A box whose origin is its base centre, positioned in the car's local space. */
function box(w, h, d, x, y, z, color) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y + h * 0.5, z);
  return { geometry, color };
}

// ------------------------------------------------------------------ the lower body

/** Sweep the sections along z into a closed shell, tinted by a vertical ramp. */
function loft(sections, { dark = 0.42, ring = RING } = {}) {
  const positions = [];
  const colors = [];
  const uvs = [];
  const rings = sections.map((sec) => {
    const points = [];
    for (let i = 0; i < ring; i += 1) points.push(sectionPoint(sec, (i / ring) * Math.PI * 2));
    return points;
  });

  const low = Math.min(...sections.map((s) => s.y0));
  const high = Math.max(...sections.map((s) => s.y1));
  const shade = (y) => {
    const t = clamp((y - low) / Math.max(0.001, high - low), 0, 1);
    return Math.min(1, dark + (1 - dark) * Math.pow(t, 0.62));
  };

  const push = (x, y, z) => {
    positions.push(x, y, z);
    uvs.push(0.5 + x * 0.1, z * 0.1);
    const v = shade(y);
    colors.push(v, v, v);
  };

  // Body: quads between consecutive rings, wound so the normal points away from the axis.
  for (let r = 0; r < sections.length - 1; r += 1) {
    const a = rings[r];
    const b = rings[r + 1];
    const za = sections[r].z;
    const zb = sections[r + 1].z;
    for (let i = 0; i < ring; i += 1) {
      const j = (i + 1) % ring;
      push(a[i].x, a[i].y, za);
      push(a[j].x, a[j].y, za);
      push(b[j].x, b[j].y, zb);
      push(a[i].x, a[i].y, za);
      push(b[j].x, b[j].y, zb);
      push(b[i].x, b[i].y, zb);
    }
  }
  // End caps: a fan from the section's waist, facing out along -z at the nose and +z at the tail.
  for (const [index, forward] of [[0, false], [sections.length - 1, true]]) {
    const sec = sections[index];
    const points = rings[index];
    const waist = (sec.y0 + sec.y1) * 0.5;
    for (let i = 0; i < ring; i += 1) {
      const j = (i + 1) % ring;
      if (forward) {
        push(0, waist, sec.z);
        push(points[i].x, points[i].y, sec.z);
        push(points[j].x, points[j].y, sec.z);
      } else {
        push(0, waist, sec.z);
        push(points[j].x, points[j].y, sec.z);
        push(points[i].x, points[i].y, sec.z);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** A chrome band hugging the shell's flank at a stated height, sampled from the section table. */
function flankRibbon(spec, y, thickness, color) {
  const sections = spec.stations;
  const quads = [];
  const inset = 0.004;
  for (const side of [-1, 1]) {
    for (let i = 0; i < sections.length - 1; i += 1) {
      const sa = sections[i];
      const sb = sections[i + 1];
      const za = sa.z;
      const zb = sb.z;
      const yaTop = clamp(y + thickness, sa.y0 + 0.02, sa.y1 - 0.02);
      const yaBot = clamp(y, sa.y0 + 0.02, sa.y1 - 0.02);
      const ybTop = clamp(y + thickness, sb.y0 + 0.02, sb.y1 - 0.02);
      const ybBot = clamp(y, sb.y0 + 0.02, sb.y1 - 0.02);
      if (yaTop - yaBot < 1e-3 || ybTop - ybBot < 1e-3) continue;
      const xaTop = side * (flankX(sa, yaTop) + inset);
      const xaBot = side * (flankX(sa, yaBot) + inset);
      const xbTop = side * (flankX(sb, ybTop) + inset);
      const xbBot = side * (flankX(sb, ybBot) + inset);
      if (Math.abs(xaTop) < 1e-4 || Math.abs(xbTop) < 1e-4) continue;
      quads.push([[xaBot, yaBot, za], [xaTop, yaTop, za], [xbTop, ybTop, zb], [xbBot, ybBot, zb]]);
    }
  }
  return strips(quads, color);
}

/** A dark ring on the tyre's own circle, inside the arch, closing the tyre-to-body gap. */
function archLiner(spec, side, zAxle, color) {
  const radius = spec.wheelRadius + 0.05;
  // The liner spans the arch from its inboard wall out to just INSIDE the fender's outer lip, so
  // the arch is closed to the paint on both sides and there is never sky between tyre and body.
  // It stops short of the lip: a liner drawn proud of the paint reads as a tyre sticking out.
  const xIn = side * Math.max(0.05, spec.wheelTrack - spec.tyreWidth * 0.5 - 0.03);
  const xOut = side * (spec.flareW - 0.012);
  const quads = [];
  const arc = (t) => {
    const angle = Math.PI * t;
    return { y: spec.wheelRadius + Math.sin(angle) * radius, z: zAxle + Math.cos(angle) * radius };
  };
  const segments = 18;
  for (let i = 0; i < segments; i += 1) {
    const a = arc(i / segments);
    const b = arc((i + 1) / segments);
    // The roof of the arch: a band from the outboard lip to the inboard wall.
    quads.push([[xOut, a.y, a.z], [xIn, a.y, a.z], [xIn, b.y, b.z], [xOut, b.y, b.z]]);
    // An inner wall so the arch is a hole with a side, not a window to the far side of the car.
    quads.push([[xIn, a.y, a.z], [xIn, b.y, b.z], [xIn, b.y - 0.09, b.z], [xIn, a.y - 0.09, a.z]]);
  }
  return strips(quads, color);
}

// ------------------------------------------------------------------ shapes

/**
 * A shape is a handful of scalars; the station table is generated from them. `y0` at each station
 * is cut by the wheel arches, `y1` traces hood → beltline → deck, and the width traces nose →
 * waist → tail with a shallow haunch over each axle.
 */
function makeSections(p) {
  const zFront = -p.length * 0.5;
  const zBack = p.length * 0.5;
  const R = p.wheelRadius;
  const Ra = R + p.archClear;
  const axles = [-p.wheelBase, p.wheelBase];

  const beltAt = (z) => {
    const u = (z - zFront) / (zBack - zFront);
    if (u <= 0.5) return p.hoodY + (p.beltY - p.hoodY) * smooth(u / 0.5);
    return p.beltY + (p.deckY - p.beltY) * smooth((u - 0.5) / 0.5);
  };
  /**
   * The flank line. A car is WIDEST OVER ITS WHEELS, not at the middle of its doors: the fenders
   * have to enclose the tyres. The taper runs nose → tail, and over each axle it swells to
   * `flareW`, which is also what the wheel track is derived from — so a tyre can never stand proud
   * of its own arch. (Getting this backwards is what put the wheels outside the bodywork.)
   */
  const widthAt = (z) => {
    const u = (z - zFront) / (zBack - zFront);
    const taper =
      u <= 0.5
        ? p.noseW + (p.waistW - p.noseW) * smooth(u / 0.5)
        : p.waistW + (p.tailW - p.waistW) * smooth((u - 0.5) / 0.5);
    let flare = 0;
    for (const za of axles) flare = Math.max(flare, Math.exp(-Math.pow((z - za) / 0.62, 2)));
    // Ease the whole transition so the flank has no crease where the swell meets the door skin.
    return taper + (p.flareW - taper) * smooth(flare);
  };
  const nAt = (z) => {
    const u = (z - zFront) / (zBack - zFront);
    if (u <= 0.5) return p.noseN + (p.midN - p.noseN) * smooth(u / 0.5);
    return p.midN + (p.tailN - p.midN) * smooth((u - 0.5) / 0.5);
  };
  // The arch: the body's lower edge rides on the tyre's circle plus a clearance, then falls to
  // the rocker over a short ramp at the arch's edge.
  const sillAt = (z) => {
    let best = p.rockerY;
    for (const za of axles) {
      const d = Math.abs(z - za);
      if (d > Ra + 0.16) continue;
      const arch = R + Math.sqrt(Math.max(0, Ra * Ra - d * d));
      const fade = d <= Ra ? 1 : 1 - (d - Ra) / 0.16;
      best = Math.max(best, p.rockerY + (arch - p.rockerY) * smooth(fade));
    }
    return best;
  };

  const zs = new Set();
  const add = (z) => zs.add(Math.round(clamp(z, zFront, zBack) * 1000) / 1000);
  add(zFront);
  add(zFront + 0.1);
  add(zFront + 0.28);
  add(zFront + 0.52);
  for (const za of axles) {
    for (const off of [0, 0.1, 0.19, 0.26, 0.33, 0.38, Ra, Ra + 0.02, Ra + 0.16, Ra + 0.34]) {
      add(za - off);
      add(za + off);
    }
  }
  add(0);
  add(zBack - 0.52);
  add(zBack - 0.28);
  add(zBack - 0.1);
  add(zBack);

  const list = [...zs].sort((a, b) => a - b);
  const sections = [];
  for (const z of list) {
    const y1 = beltAt(z);
    const y0 = Math.min(sillAt(z), y1 - 0.09);
    sections.push({ z, w: widthAt(z), y0, y1, n: nAt(z) });
  }
  return sections;
}

export const CAR_SHAPES = {
  sedan: {
    length: 4.72,
    width: 1.9,
    wheelRadius: 0.34,
    wheelBase: 1.38,
    tyreWidth: 0.22,
    archClear: 0.018,
    rockerY: 0.19,
    hoodY: 0.83,
    beltY: 1.0,
    deckY: 0.9,
    noseW: 0.6,
    waistW: 0.87,
    tailW: 0.7,
    flareW: 1.0,
    noseN: 3.2,
    midN: 4.6,
    tailN: 3.4,
    cabin: { zFront: -0.98, zRoofFront: -0.2, zRoofBack: 0.86, zBack: 1.62, roofY: 1.44, beltW: 0.8, roofW: 0.79 },
  },
  wagon: {
    length: 4.98,
    width: 2.0,
    wheelRadius: 0.36,
    wheelBase: 1.48,
    tyreWidth: 0.24,
    archClear: 0.02,
    rockerY: 0.2,
    hoodY: 0.87,
    beltY: 1.05,
    deckY: 1.03,
    noseW: 0.64,
    waistW: 0.9,
    tailW: 0.82,
    flareW: 1.04,
    noseN: 3.2,
    midN: 4.8,
    tailN: 3.8,
    cabin: { zFront: -1.06, zRoofFront: -0.24, zRoofBack: 1.5, zBack: 2.24, roofY: 1.66, beltW: 0.84, roofW: 0.83 },
  },
  coupe: {
    length: 4.4,
    width: 1.88,
    wheelRadius: 0.34,
    wheelBase: 1.32,
    tyreWidth: 0.23,
    archClear: 0.018,
    rockerY: 0.18,
    hoodY: 0.79,
    beltY: 0.96,
    deckY: 0.86,
    noseW: 0.58,
    waistW: 0.86,
    tailW: 0.68,
    flareW: 0.99,
    noseN: 3.0,
    midN: 4.4,
    tailN: 3.2,
    cabin: { zFront: -0.88, zRoofFront: -0.16, zRoofBack: 0.64, zBack: 1.36, roofY: 1.34, beltW: 0.79, roofW: 0.77 },
  },
};

/** Resolve a shape name into a fully materialised spec, sections included. */
export function carSpec(name) {
  const profile = CAR_SHAPES[name] ?? CAR_SHAPES.sedan;
  if (profile.spec) return profile.spec;
  // The track follows the fender, not the other way round: a tyre's outer face sits FLUSH_INSIDE
  // of the flank line over its axle, so the wheel is enclosed by its own arch and never proud of
  // the paint. The tyre half width is what closes the last few centimetres.
  profile.wheelTrack = profile.flareW - profile.tyreWidth * 0.5 - FLUSH_INSIDE;
  const sections = makeSections(profile);
  const nose = sections[0];
  const tail = sections[sections.length - 1];
  const spec = {
    ...profile,
    name: CAR_SHAPES[name] ? name : 'sedan',
    stations: sections,
    sill: Math.min(...sections.map((s) => s.y0)),
    beltline: profile.beltY,
    halfLength: profile.length * 0.5,
    noseZ: nose.z,
    tailZ: tail.z,
    canopy: {
      yBottom: stationAt(sections, profile.cabin.zFront).y1 - 0.01,
      yTop: profile.cabin.roofY,
      roofZ0: profile.cabin.zRoofFront,
      roofZ1: profile.cabin.zRoofBack,
      w: profile.cabin.roofW,
      zFront: profile.cabin.zFront,
      zBack: profile.cabin.zBack,
    },
    lamps: {
      headY: (nose.y0 + nose.y1) * 0.5 - 0.01,
      headZ: nose.z,
      headW: Math.min(0.46, nose.w * 1.1),
      headH: Math.min(0.14, (nose.y1 - nose.y0) * 0.34),
      tailY: (tail.y0 + tail.y1) * 0.5 - 0.01,
      tailZ: tail.z,
      tailW: Math.min(0.44, tail.w * 1.0),
      tailH: Math.min(0.13, (tail.y1 - tail.y0) * 0.3),
    },
  };
  profile.spec = spec;
  return spec;
}

// ------------------------------------------------------------------ the cabin

/**
 * The greenhouse, as ONE closed loft.
 *
 * Four cross-sections along z — the cowl, the roof's front edge, the roof's back edge and the deck
 * — and at each one the greenhouse spans from the body's own beltline (`yBottom`, sampled off the
 * shell) up to its own top edge (`yTop`). The top edge traces the profile: cowl → roof → roof →
 * deck, so the windscreen and the rear screen are the RAKED sides of one closed shell and the roof
 * is the top surface of that same shell.
 *
 * Written this way the cabin cannot come apart: every face between two neighbouring sections
 * shares its two edge vertices with them, the pillars are drawn ON the flank faces rather than
 * propped between the body and a floating plane, and the roof is a face of the loft, not a decal
 * laid above it. (The previous version hung the roof off two large pillar triangles, which read as
 * white fins jutting out of the rear deck.)
 */
function cabinShell(spec) {
  const { cabin, stations } = spec;
  // The greenhouse's four stations and the top edge at each.
  const zs = [cabin.zFront, cabin.zRoofFront, cabin.zRoofBack, cabin.zBack];
  const beltTs = zs.map((z) => stationAt(stations, z).y1 - 0.014);
  const roofY = cabin.roofY;
  const tops = [beltTs[0] + 0.03, roofY, roofY, beltTs[3] + 0.03];
  // The greenhouse narrows towards the screens, so the glazing rakes in plan as well as in profile.
  const widths = [cabin.beltW * 0.94, cabin.roofW, cabin.roofW, cabin.beltW * 0.94];
  const secs = zs.map((z, i) => ({ z, x: widths[i], yBottom: beltTs[i], yTop: tops[i] }));

  /** One corner of a section, `side` = -1 left / +1 right. */
  const corner = (s, side, top) => [side * s.x, top ? s.yTop : s.yBottom, s.z];

  const paint = [];
  const glass = [];

  // Top surface: the roof, between the roof's two edges. Closed, painted.
  paint.push([corner(secs[1], -1, true), corner(secs[1], 1, true), corner(secs[2], 1, true), corner(secs[2], -1, true)]);
  // Front surface (cowl → roof front): the windscreen.
  glass.push([corner(secs[0], -1, true), corner(secs[0], 1, true), corner(secs[1], 1, true), corner(secs[1], -1, true)]);
  // Rear surface (roof back → deck): the rear screen.
  glass.push([corner(secs[2], -1, true), corner(secs[2], 1, true), corner(secs[3], 1, true), corner(secs[3], -1, true)]);

  // The two flanks: the glazing between the belt and the roof, cowl to deck. This is the side glass,
  // and it is a band of REAL quads — one per pair of sections, spanning belt to roof at both ends.
  // (A ring of `[a, b, b, a]` quads is zero-area and draws nothing at all, which is how a car ends
  // up with an open, skeleton-like greenhouse while the side-glass part still exists.)
  for (const side of [-1, 1]) {
    for (let i = 0; i < secs.length - 1; i += 1) {
      glass.push([
        corner(secs[i], side, false),
        corner(secs[i], side, true),
        corner(secs[i + 1], side, true),
        corner(secs[i + 1], side, false),
      ]);
    }
  }

  // A floor under the greenhouse, closing the shell: the belt plane between the two flanks.
  for (let i = 0; i < secs.length - 1; i += 1) {
    paint.push([
      corner(secs[i], -1, false),
      corner(secs[i], 1, false),
      corner(secs[i + 1], 1, false),
      corner(secs[i + 1], -1, false),
    ]);
  }

  return {
    glass: strips(glass, 0xffffff),
    paint: strips(paint, 0xffffff),
    secs,
    // Kept for the roof rail and the mirror, which anchor to the cabin's own surfaces.
    roofAt: secs.map((s) => ({ z: s.z, x: s.x, y: s.yTop })),
    beltAt: secs.map((s) => ({ z: s.z, x: s.x, y: s.yBottom })),
  };
}

/**
 * Pillars: the A, B and C frames, each a narrow post standing on the flank's own belt edge and
 * running up to the roof's own edge at the same z. They are inset a hair outboard of the glass and
 * anchored to both edges, so they are part of the cabin's frame and never a free-standing sliver.
 */
function pillars(spec, secs) {
  const parts = [];
  const inset = 0.006;
  /** A post at station `s`, on `side`, spanning its own belt → roof edge. */
  const post = (s, side, thickness) => {
    const x = side * (s.x + inset);
    const quads = [
      // Outboard face of the post.
      [[x, s.yBottom, s.z - thickness], [x, s.yBottom, s.z + thickness], [x, s.yTop, s.z + thickness], [x, s.yTop, s.z - thickness]],
      // Its two side faces, folded back in to the glass, so the post has depth.
      [[x, s.yBottom, s.z - thickness], [x, s.yTop, s.z - thickness], [x - side * inset * 2, s.yTop, s.z - thickness], [x - side * inset * 2, s.yBottom, s.z - thickness]],
      [[x, s.yBottom, s.z + thickness], [x, s.yTop, s.z + thickness], [x - side * inset * 2, s.yTop, s.z + thickness], [x - side * inset * 2, s.yBottom, s.z + thickness]],
    ];
    for (const q of quads) parts.push(q);
  };
  for (const side of [-1, 1]) {
    post(secs[0], side, 0.045); // A
    post(secs[2], side, 0.045); // C
    // B: midway between the A and C posts, on the same belt→roof span.
    const a = secs[1];
    const c = secs[2];
    const mid = {
      z: (a.z + c.z) * 0.5,
      x: (a.x + c.x) * 0.5,
      yBottom: (a.yBottom + c.yBottom) * 0.5,
      yTop: (a.yTop + c.yTop) * 0.5,
    };
    post(mid, side, 0.038);
  }
  void spec;
  return parts;
}


/**
 * The roof rails: a thin lip standing on the roof panel's own surface, running between the roof's
 * front and rear edges. It starts at the panel's height, not above it, and its inner face is the
 * panel's edge — so it reads as a pressed seam in the roof rather than a bar laid on top of it.
 */
function roofRail(spec, roofAt) {
  const quads = [];
  const height = 0.026;
  for (const side of [-1, 1]) {
    const a = roofAt[1];
    const b = roofAt[2];
    const x = side * (a.x - 0.014);
    // Outer face, rooted 6 mm INTO the panel so there is no hairline gap under the rail...
    quads.push([[x, a.y - 0.006, a.z], [x, a.y - 0.006, b.z], [x, a.y + height, b.z], [x, a.y + height, a.z]]);
    // ...and a crest folded back inward over the panel, so the rail has a top and not just a wall.
    quads.push([[x, a.y + height, a.z], [x, a.y + height, b.z], [x + side * 0.03, a.y + height, b.z], [x + side * 0.03, a.y + height, a.z]]);
  }
  void spec;
  return quads;
}

// ------------------------------------------------------------------ decals on the caps

/** A slim bar across the nose cap, clamped inside the cap's own silhouette. */
function noseBar(sec, spec) {
  const y = clamp(spec.lamps.headY - spec.lamps.headH * 1.4, sec.y0 + 0.04, sec.y1 - 0.04);
  const halfW = Math.max(0.05, Math.min(flankX(sec, y), flankX(sec, y + 0.035)) * 0.66);
  const z = sec.z - 0.004;
  return strips([[[-halfW, y, z], [halfW, y, z], [halfW, y + 0.035, z], [-halfW, y + 0.035, z]]], 0xd6d2c8);
}

/**
 * Number plates: one on the tail cap and one on the nose. A single flat quad sitting flush on the
 * paint reads as a recess, not a plate, so each plate is a raised slab — a bright face 12 mm proud
 * of the cap with a dark surround behind it, the way a plate on a bracket actually looks.
 */
function plates(nose, tail, spec) {
  const parts = { bright: [], dark: [] };
  const build = (sec, which) => {
    const head = which === 'head';
    const sign = head ? -1 : 1;
    const centreY = head ? spec.lamps.headY : spec.lamps.tailY;
    const lampH = head ? spec.lamps.headH : spec.lamps.tailH;
    const h = 0.1;
    const y = clamp(centreY - lampH * 1.7 - h, sec.y0 + 0.03, sec.y1 - h - 0.02);
    const maxX = Math.min(flankX(sec, y), flankX(sec, y + h)) - 0.02;
    const halfW = Math.max(0.045, Math.min(0.18, maxX * 0.62));
    if (halfW < 0.05) return;
    const z0 = sec.z + sign * 0.002;
    const z1 = sec.z + sign * 0.014;
    // Dark surround, set into the cap.
    parts.dark.push([
      [-halfW - 0.012, y - 0.012, z0],
      [halfW + 0.012, y - 0.012, z0],
      [halfW + 0.012, y + h + 0.012, z0],
      [-halfW - 0.012, y + h + 0.012, z0],
    ]);
    // Bright plate face, standing proud of that surround.
    parts.bright.push([[-halfW, y, z1], [halfW, y, z1], [halfW, y + h, z1], [-halfW, y + h, z1]]);
  };
  build(nose, 'head');
  build(tail, 'tail');
  return parts;
}

/** Two exhaust tips, recessed into the tail cap's lower corners. */
function exhausts(sec, spec) {
  void spec;
  const quads = [];
  const y = sec.y0 + 0.04;
  for (const side of [-1, 1]) {
    const cx = side * Math.max(0.12, flankX(sec, y + 0.03) * 0.42);
    quads.push([
      [cx - 0.04, y, sec.z + 0.004],
      [cx + 0.04, y, sec.z + 0.004],
      [cx + 0.04, y + 0.05, sec.z + 0.004],
      [cx - 0.04, y + 0.05, sec.z + 0.004],
    ]);
  }
  return strips(quads, 0xa8a49a);
}

/** A dark pan between the arches, above the road and below the sill. */
function underbody(spec) {
  const z0 = -spec.wheelBase + spec.wheelRadius + 0.12;
  const z1 = spec.wheelBase - spec.wheelRadius - 0.12;
  const y = spec.rockerY + 0.005;
  const halfW = Math.max(0.3, spec.waistW * 0.62);
  return strips([[[-halfW, y, z0], [halfW, y, z0], [halfW, y, z1], [-halfW, y, z1]]], 0x0b0d10);
}

/** Door shut lines: a thin dark strip sampled off the flank's own curve. */
function seams(spec) {
  const quads = [];
  for (const side of [-1, 1]) {
    for (const z of [-0.38, 0.88]) {
      const sec = stationAt(spec.stations, z);
      if (sec.y1 - sec.y0 < 0.3) continue;
      const yb = clamp(0.6, sec.y0 + 0.04, sec.y1 - 0.06);
      const yt = clamp(0.92, sec.y0 + 0.04, sec.y1 - 0.04);
      if (yt - yb < 0.05) continue;
      const xb = side * (flankX(sec, yb) + 0.003);
      const xt = side * (flankX(sec, yt) + 0.003);
      if (Math.abs(xb) < 1e-4 || Math.abs(xt) < 1e-4) continue;
      quads.push([[xb, yb, z], [xb + side * 0.014, yb, z], [xt + side * 0.014, yt, z], [xt, yt, z]]);
    }
  }
  return strips(quads, 0x0f1114);
}

/**
 * A lamp face on the nose or tail cap. Its corners are placed inside the cap's silhouette at their
 * own height, so the face always lies on the body and never beside it.
 *
 * Emitted two-sided: a cap decal is a flat quad on a curved end, and a single winding that happens
 * to face into the car is silently culled — which is exactly how "the headlights are missing" gets
 * reported while the geometry is present.
 */
function lampFace(sec, spec, side, which) {
  const head = which === 'head';
  const centreY = head ? spec.lamps.headY : spec.lamps.tailY;
  const height = head ? spec.lamps.headH : spec.lamps.tailH;
  const z = head ? sec.z - 0.004 : sec.z + 0.004;
  const yb = centreY - height * 0.5;
  const yt = centreY + height * 0.5;
  const limit = Math.min(flankX(sec, yb), flankX(sec, yt)) - 0.02;
  if (limit <= 0.03) return strips([], 0xffffff);
  const inner = Math.min(limit * 0.9, limit * 0.42);
  const outer = Math.min(limit * 0.94, limit * 0.42 + Math.min(0.34, limit * 0.6));
  const a = side * inner;
  const b = side * outer;
  const x0 = Math.min(a, b);
  const x1 = Math.max(a, b);
  return strips([[[x0, yb, z], [x1, yb, z], [x1, yt, z], [x0, yt, z]]], 0xffffff);
}

// ------------------------------------------------------------------ assembly

/**
 * Build one car shape. Returns geometry buckets:
 *   body   — paint, tinted per instance
 *   trim   — chrome: sill rails, grille bar, plate, exhaust
 *   dark   — arch liners, underbody pan, door seams, mirrors, roof rails
 *   glass  — the greenhouse's glazing
 *   head   — headlight faces
 *   tail   — tail light faces
 *   spec   — the shape's scalar table, including `stations`, `sill`, `wheelTrack`
 */
export function buildCar(shapeName) {
  const spec = carSpec(shapeName);
  const stations = spec.stations;
  const nose = stations[0];
  const tail = stations[stations.length - 1];
  const { cabin } = spec;

  // ---- lower body: the shell.
  const body = loft(stations, { dark: 0.4 });

  // ---- cabin.
  const cabinParts = cabinShell(spec);

  // ---- trim.
  const chrome = [];
  chrome.push({ geometry: flankRibbon(spec, spec.rockerY + 0.015, 0.05, 0xd8d4c8), color: 0xffffff });
  chrome.push({ geometry: noseBar(nose, spec), color: 0xffffff });
  const plateParts = plates(nose, tail, spec);
  chrome.push({ geometry: strips(plateParts.bright, 0xe8e4d8), color: 0xffffff });
  chrome.push({ geometry: exhausts(tail, spec), color: 0xffffff });

  // ---- dark.
  const dark = [];
  dark.push({ geometry: strips(plateParts.dark, 0x0f1114), color: 0xffffff });
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) dark.push({ geometry: archLiner(spec, side, axle * spec.wheelBase, 0x0b0d10), color: 0xffffff });
  }
  dark.push({ geometry: underbody(spec), color: 0xffffff });
  // Pillars: the cabin's own frame, anchored belt → roof on the flank at the A, B and C stations.
  dark.push({ geometry: strips(pillars(spec, cabinParts.secs), 0x15181c), color: 0xffffff });
  // Mirrors: the arm starts INSIDE the cabin's own flank panel (its inboard end is at 40% of the
  // belt half width, well within the paint) and runs out to a shell, so neither can detach.
  for (const side of [-1, 1]) {
    const z = cabin.zFront + 0.34;
    const y = spec.canopy.yBottom + 0.04;
    const x0 = side * cabin.beltW * 0.4;
    const x1 = side * (cabin.beltW + 0.075);
    const mid = (x0 + x1) * 0.5;
    const span = Math.abs(x1 - x0);
    dark.push(box(span, 0.026, 0.032, mid, y, z, 0x1a1d22));
    dark.push(box(0.055, 0.075, 0.13, x1, y - 0.01, z, 0x22262c));
    // A small panel seam where the arm leaves the body, so it reads as a bolted-on part.
    dark.push(box(0.02, 0.09, 0.13, side * cabin.beltW * 0.92, y - 0.02, z, 0x14171b));
  }
  dark.push({ geometry: seams(spec), color: 0xffffff });
  dark.push({ geometry: strips(roofRail(spec, cabinParts.roofAt), 0x15181c), color: 0xffffff });

  // ---- cabin paint (A/C pillars) joins the body paint bucket.
  const bodyParts = [{ geometry: body }, { geometry: cabinParts.paint }];

  // ---- lamps, flush with the caps they sit on.
  const head = [];
  const tailParts = [];
  for (const side of [-1, 1]) {
    head.push({ geometry: lampFace(nose, spec, side, 'head'), color: 0xffffff });
    tailParts.push({ geometry: lampFace(tail, spec, side, 'tail'), color: 0xffffff });
  }

  return {
    body: bake(bodyParts),
    trim: bake(chrome),
    dark: bake(dark),
    glass: cabinParts.glass,
    head: bake(head),
    tail: bake(tailParts),
    spec,
  };
}
