// Car geometry, authored once and shared by the traffic stream and the hero coupe. A car here is a
// lofted shell: a superellipse cross-section swept along the length with the width, height and
// corner sharpness changing station by station, so the body has shoulders, a tapered nose and a
// fastback tail. The greenhouse is a second loft sitting ON the shell's beltline, joined to it by
// pillars, and every other part — bumpers, arch flares, sill rails, lamp housings — is placed from
// the same station table, so nothing can end up floating clear of the body.
//
// Absolute heights: ground is y = 0, the wheel centres sit at the tyre radius, the shell runs from
// the sill (about 0.4 m) up to the beltline (about 1.0 m) and the roof peaks near 1.4 m.

import { mergeGeometries } from './geom.js';

/** Concatenate parts, keeping per-vertex colours where a part already baked them. */
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
    if (own && tint === undefined) {
      color.set(own.array, offset * 3);
    } else {
      const c = new THREE.Color(tint ?? 0xffffff);
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

const RING = 18;

/**
 * One point on a car section. The waist line is at y = 0 of the section; the ring rises `up`
 * above it and drops `down` below it, independently. That asymmetry is what lets the body's lower
 * edge lift over a wheel (an arch) while the rocker panel between the axles stays low.
 */
function superPoint(theta, w, up, down, n) {
  const e = 2 / n;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // `up` governs the half above the waist, `down` the half below it; both keep the sign of s so
  // the ring is a closed loop and not two stacked halves.
  const radius = s >= 0 ? up : down;
  return { x: w * Math.sign(c) * Math.pow(Math.abs(c), e), y: radius * Math.sign(s) * Math.pow(Math.abs(s), e) };
}

/**
 * Sweep a superellipse along z. `stations` = [{ z, w, cy, hh, n }]. Vertices are tinted with a
 * vertical ramp so the sill ridge sits in shadow and the shoulder catches the light; the paint
 * material multiplies that ramp by the car's colour.
 */
export function loft(stations, { dark = 0.45, shoulder = 1.1, ring = RING } = {}) {
  const positions = [];
  const colors = [];
  const uvs = [];
  const rings = stations.map((station) => {
    const points = [];
    const up = station.up ?? station.hh;
    const down = station.down ?? station.hh;
    for (let i = 0; i < ring; i += 1) {
      const p = superPoint((i / ring) * Math.PI * 2, station.w, up, down, station.n);
      points.push({ x: p.x, y: station.cy + p.y });
    }
    return points;
  });

  const low = Math.min(...stations.map((s) => s.cy - (s.down ?? s.hh)));
  const high = Math.max(...stations.map((s) => s.cy + (s.up ?? s.hh)));
  const shade = (y) => {
    const t = Math.max(0, Math.min(1, (y - low) / Math.max(0.001, high - low)));
    const base = dark + (1 - dark) * Math.pow(t, 0.5);
    return Math.min(1.15, base * (t > 0.5 ? shoulder : 1));
  };

  const push = (x, y, z) => {
    positions.push(x, y, z);
    uvs.push(0.5 + x * 0.12, z * 0.12);
    const v = shade(y);
    colors.push(v, v, v);
  };

  for (let r = 0; r < rings.length - 1; r += 1) {
    const a = rings[r];
    const b = rings[r + 1];
    const za = stations[r].z;
    const zb = stations[r + 1].z;
    for (let i = 0; i < ring; i += 1) {
      const j = (i + 1) % ring;
      // Counter-clockwise seen from outside: outward normals, so backface culling keeps the shell.
      push(a[i].x, a[i].y, za);
      push(b[j].x, b[j].y, zb);
      push(b[i].x, b[i].y, zb);
      push(a[i].x, a[i].y, za);
      push(a[j].x, a[j].y, za);
      push(b[j].x, b[j].y, zb);
    }
  }
  for (const [index, flip] of [[0, false], [rings.length - 1, true]]) {
    const ring0 = rings[index];
    const z = stations[index].z;
    const cy = stations[index].cy;
    for (let i = 0; i < ring; i += 1) {
      const j = (i + 1) % ring;
      if (flip) {
        push(0, cy, z);
        push(ring0[i].x, ring0[i].y, z);
        push(ring0[j].x, ring0[j].y, z);
      } else {
        push(0, cy, z);
        push(ring0[j].x, ring0[j].y, z);
        push(ring0[i].x, ring0[i].y, z);
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

/** Station lookup: interpolate the shell's half width and centre at an arbitrary z. */
function stationAt(stations, z) {
  if (z <= stations[0].z) return stations[0];
  const last = stations[stations.length - 1];
  if (z >= last.z) return last;
  for (let i = 0; i < stations.length - 1; i += 1) {
    const a = stations[i];
    const b = stations[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return {
        z,
        w: a.w + (b.w - a.w) * t,
        cy: a.cy + (b.cy - a.cy) * t,
        up: a.up + (b.up - a.up) * t,
        down: a.down + (b.down - a.down) * t,
        n: a.n,
      };
    }
  }
  return last;
}

/**
 * Make every triangle face away from the car's centre line. Hand-built quad strips are easy to
 * wind backwards, and a backwards quad is silently culled — which is exactly how a bumper ends up
 * invisible while its part still exists. This fixes the winding rather than papering over it with
 * a double-sided material.
 */
function orientOutward(geometry) {
  const pos = geometry.getAttribute('position');
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const read = (i) => (index ? index.getX(i) : i);
  const out = [];
  for (let t = 0; t < triCount; t += 1) {
    const ia = read(t * 3);
    const ib = read(t * 3 + 1);
    const ic = read(t * 3 + 2);
    const ax = pos.getX(ia);
    const ay = pos.getY(ia);
    const az = pos.getZ(ia);
    const bx = pos.getX(ib);
    const by = pos.getY(ib);
    const bz = pos.getZ(ib);
    const cx = pos.getX(ic);
    const cy = pos.getY(ic);
    const cz = pos.getZ(ic);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // Compare the normal against the direction from the loft axis out to the triangle. Near-flat
    // triangles (a bar's top face) are judged on their vertical normal instead.
    const mx = (ax + bx + cx) / 3;
    const mz = (az + bz + cz) / 3;
    const radial = nx * mx + nz * mz;
    const flip = Math.abs(ny) > 0.85 ? ny < 0 : radial < 0;
    if (flip) out.push(ia, ic, ib);
    else out.push(ia, ib, ic);
  }
  const rebuilt = new THREE.BufferGeometry();
  rebuilt.setAttribute('position', pos.clone());
  const colours = geometry.getAttribute('color');
  if (colours) rebuilt.setAttribute('color', colours.clone());
  const uv = geometry.getAttribute('uv');
  if (uv) rebuilt.setAttribute('uv', uv.clone());
  rebuilt.setIndex(out);
  rebuilt.computeVertexNormals();
  return rebuilt;
}

function box(w, h, d, x, y, z, color) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return { geometry, color };
}

/** A tapered slab: wide at the bottom, narrow at the top, optionally raked back in z. */
function slab(wBottom, wTop, h, dBottom, dTop, x, y, z, color, rake = 0) {
  const geometry = new THREE.CylinderGeometry(wTop * 0.5, wBottom * 0.5, h, 4, 1);
  geometry.rotateY(Math.PI / 4);
  geometry.scale(1, 1, (dBottom + dTop) * 0.5 / Math.max(0.001, (wBottom + wTop) * 0.5));
  if (rake) geometry.rotateX(rake);
  geometry.translate(x, y + h * 0.5, z);
  return { geometry, color };
}

/**
 * A bar that follows the shell's own width: a chain of trapezoid segments, each hugging the body
 * at its own z, so a bumper or sill rail can never stick out into thin air. `follow` is the
 * fraction of the shell half width to sit at (1.0 = flush, 1.03 = proud of the paint).
 */
function followBar(stations, z0, z1, follow, thickness, offsetY, height, color, steps = 5) {
  const positions = [];
  const colors = [];
  const tint = new THREE.Color(color);
  const at = (t) => {
    const z = z0 + (z1 - z0) * t;
    return { z, w: stationAt(stations, z).w * follow };
  };
  const quad = (a, b, c, d) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i += 1) colors.push(tint.r, tint.g, tint.b);
  };
  for (let i = 0; i < steps; i += 1) {
    const a = at(i / steps);
    const b = at((i + 1) / steps);
    const yTop = offsetY + height;
    // Outer face, left and right.
    for (const side of [-1, 1]) {
      const xa = side * a.w;
      const xb = side * b.w;
      const xo = side * (a.w + thickness);
      const xo2 = side * (b.w + thickness);
      quad([xa, offsetY, a.z], [xb, offsetY, b.z], [xo2, yTop, b.z], [xo, yTop, a.z]);
    }
    // Top and bottom faces, so the bar reads as a solid from above.
    quad([-a.w, yTop, a.z], [a.w, yTop, a.z], [b.w, yTop, b.z], [-b.w, yTop, b.z]);
    quad([-a.w, offsetY, a.z], [-b.w, offsetY, b.z], [b.w, offsetY, b.z], [a.w, offsetY, a.z]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The greenhouse: windshield, roof, rear screen and side glass, all pitched from the shell's
 * beltline up to the roof. Pillars in the dark bucket tie it to the body so the roof can never
 * read as a floating plane.
 */
/** One flank rail hugging the shell, from z0 to z1, at height y. */
function followBarSide(stations, z0, z1, side, follow, thickness, height, y, color, steps = 8) {
  const positions = [];
  const colors = [];
  const tint = new THREE.Color(color);
  const at = (t) => {
    const z = z0 + (z1 - z0) * t;
    return { z, w: stationAt(stations, z).w * follow };
  };
  const quad = (a, b, c, d) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i += 1) colors.push(tint.r, tint.g, tint.b);
  };
  for (let i = 0; i < steps; i += 1) {
    const a = at(i / steps);
    const b = at((i + 1) / steps);
    const xa = side * (a.w + 0.004);
    const xb = side * (b.w + 0.004);
    const xo = side * (a.w + thickness);
    const xo2 = side * (b.w + thickness);
    quad([xa, y, a.z], [xb, y, b.z], [xo2, y + height, b.z], [xo, y + height, a.z]);
    quad([xo, y, a.z], [xo2, y, b.z], [xo2, y - thickness, b.z], [xo, y - thickness, a.z]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  return orientOutward(geometry);
}

/**
 * Wheel-arch liner: a dark strip tucked just inside the paint, swept along the arch's own arc in
 * the YZ plane, so no sky shows between the tyre and the body. Written as an explicit arc rather
 * than a rotated cylinder — that keeps the arc's apex exactly at the arch's top and its two ends
 * exactly at the wheel's waist, with nothing dipping below the road.
 */
function archLiner(spec, side, z) {
  const radius = spec.wheelRadius + 0.05;
  const halfWidth = 0.115;
  const segments = 14;
  const x0 = side * (spec.width * 0.315 - halfWidth);
  const x1 = side * (spec.width * 0.315 + halfWidth);
  const positions = [];
  const colors = [];
  const tint = new THREE.Color(0x0b0d10);
  const arc = (t) => {
    const angle = Math.PI * t;
    return { y: spec.wheelRadius + Math.sin(angle) * radius, z: z + Math.cos(angle) * radius };
  };
  const quad = (a, b, c, d) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i += 1) colors.push(tint.r, tint.g, tint.b);
  };
  for (let i = 0; i < segments; i += 1) {
    const a = arc(i / segments);
    const b = arc((i + 1) / segments);
    // Inner face of the liner, both sides of the tyre.
    quad([x0, a.y, a.z], [x0, b.y, b.z], [x1, b.y, b.z], [x1, a.y, a.z]);
    // A short curtain down from the arc so the gap between tyre and arch has a wall.
    quad([x0, a.y, a.z], [x1, a.y, a.z], [x1, a.y - 0.11, a.z], [x0, a.y - 0.11, a.z]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  return orientOutward(geometry);
}

function canopy(spec) {
  const { w, zFront, zBack, yBottom, yTop, roofZ0, roofZ1, pillar } = spec;
  const positions = [];
  const normals = [];
  const half = w / 2;

  const quad = (a, b, c, d, flip = false) => {
    const tri = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
    for (const p of tri) positions.push(p[0], p[1], p[2]);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (let i = 0; i < 6; i += 1) normals.push(nx, ny, nz);
  };

  // Cowl, windshield, roof and rear screen form one surface; each panel is its own quad so the
  // normals change at the creases.
  const cowlZ = zFront - 0.24;
  quad([-half * 0.96, yBottom - 0.06, cowlZ], [half * 0.96, yBottom - 0.06, cowlZ], [half, yBottom, zFront], [-half, yBottom, zFront]);
  quad([-half, yBottom, zFront], [half, yBottom, zFront], [half * 0.9, yTop, roofZ0], [-half * 0.9, yTop, roofZ0]);
  quad([-half * 0.9, yTop, roofZ0], [half * 0.9, yTop, roofZ0], [half * 0.88, yTop, roofZ1], [-half * 0.88, yTop, roofZ1]);
  quad([half * 0.88, yTop, roofZ1], [-half * 0.88, yTop, roofZ1], [-half * 0.97, yBottom, zBack], [half * 0.97, yBottom, zBack]);

  // Side glass, split by a B-pillar, plus a bottom edge that follows the beltline.
  const mid = (roofZ0 + roofZ1) / 2;
  for (const side of [-1, 1]) {
    const x = side * half;
    quad(
      [x, yBottom, zFront + 0.1],
      [x, yTop, roofZ0],
      [x, yTop, mid - 0.1],
      [x, yBottom, mid - 0.16],
      side < 0,
    );
    quad(
      [x, yBottom, mid + 0.16],
      [x, yTop, mid + 0.1],
      [x, yTop, roofZ1],
      [x, yBottom, zBack - 0.14],
      side < 0,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  void pillar;
  return geometry;
}

/** A-pillar, B-pillar, C-pillar bars and the window rubber line, in the dark bucket. */
function pillars(spec) {
  const { w, zFront, zBack, yBottom, yTop, roofZ0, roofZ1 } = spec;
  const half = w / 2;
  const parts = [];
  const bar = (x0, y0, z0, x1, y1, z1, thickness = 0.045) => {
    const length = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const geometry = new THREE.BoxGeometry(thickness, length, thickness);
    const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    // Orient +y along the bar.
    const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...mid), quat, new THREE.Vector3(1, 1, 1));
    geometry.applyMatrix4(matrix);
    parts.push({ geometry, color: 0x15181c });
  };
  const mid = (roofZ0 + roofZ1) / 2;
  for (const side of [-1, 1]) {
    const x = side * half * 0.96;
    bar(x, yBottom, zFront, side * half * 0.92, yTop, roofZ0, 0.05); // A
    bar(x, yBottom, mid - 0.13, side * half * 0.9, yTop, mid - 0.09, 0.055); // B
    bar(x, yBottom, zBack, side * half * 0.9, yTop, roofZ1, 0.05); // C
    // Window rubber along the beltline, one continuous rail.
    bar(side * half * 1.0, yBottom, zFront, side * half * 1.0, yBottom, zBack, 0.035);
    // Mirror stalk and shell.
    const stalkZ = zFront + 0.06;
    parts.push(box(0.13, 0.035, 0.035, side * (half + 0.07), yBottom + 0.03, stalkZ, 0x1a1d22));
    parts.push(box(0.075, 0.085, 0.13, side * (half + 0.15), yBottom + 0.045, stalkZ, 0x22262c));
  }
  // Roof rails, so the roof reads as a panel with an edge rather than a decal.
  for (const side of [-1, 1]) {
    bar(side * half * 0.89, yTop + 0.012, roofZ0, side * half * 0.87, yTop + 0.012, roofZ1, 0.04);
  }
  return bake(parts);
}

/**
 * Section tables. `cy` is the waist line, `up` the rise to the shoulder and `down` the drop to the
 * body's lower edge. `down` collapses to about 0.12 over each axle — that is the wheel arch, cut
 * into the shell — and opens out to 0.34 on the rocker between the axles and at the bumpers.
 */
export const CAR_SHAPES = {
  sedan: {
    width: 1.84,
    wheelBase: 1.34,
    wheelRadius: 0.34,
    beltline: 1.0,
    stations: [
      { z: -2.26, w: 0.58, cy: 0.72, up: 0.13, down: 0.29, n: 3.0 },
      { z: -2.06, w: 0.76, cy: 0.72, up: 0.21, down: 0.31, n: 3.4 },
      { z: -1.86, w: 0.86, cy: 0.72, up: 0.25, down: 0.1, n: 4.0 },
      { z: -1.34, w: 0.9, cy: 0.72, up: 0.28, down: 0.04, n: 4.6 },
      { z: -0.86, w: 0.9, cy: 0.72, up: 0.29, down: 0.14, n: 4.8 },
      { z: -0.3, w: 0.9, cy: 0.72, up: 0.29, down: 0.32, n: 5.0 },
      { z: 0.5, w: 0.9, cy: 0.72, up: 0.29, down: 0.32, n: 5.0 },
      { z: 1.06, w: 0.89, cy: 0.72, up: 0.28, down: 0.14, n: 4.8 },
      { z: 1.54, w: 0.86, cy: 0.72, up: 0.26, down: 0.04, n: 4.4 },
      { z: 2.04, w: 0.76, cy: 0.72, up: 0.21, down: 0.09, n: 3.6 },
      { z: 2.24, w: 0.6, cy: 0.72, up: 0.14, down: 0.27, n: 3.0 },
    ],
    canopy: { w: 1.48, zFront: -0.94, zBack: 1.54, yTop: 1.46, roofZ0: -0.36, roofZ1: 0.64 },
    lamps: { headY: 0.86, headZ: -2.24, headW: 0.4, headH: 0.12, tailY: 0.88, tailZ: 2.24, tailW: 0.36, tailH: 0.11 },
  },
  wagon: {
    width: 1.94,
    wheelBase: 1.48,
    wheelRadius: 0.36,
    beltline: 1.06,
    stations: [
      { z: -2.42, w: 0.66, cy: 0.74, up: 0.17, down: 0.33, n: 3.0 },
      { z: -2.2, w: 0.82, cy: 0.74, up: 0.26, down: 0.35, n: 3.6 },
      { z: -2.0, w: 0.92, cy: 0.74, up: 0.31, down: 0.12, n: 4.2 },
      { z: -1.48, w: 0.95, cy: 0.74, up: 0.33, down: 0.04, n: 5.0 },
      { z: -0.94, w: 0.95, cy: 0.74, up: 0.34, down: 0.15, n: 5.4 },
      { z: -0.3, w: 0.95, cy: 0.74, up: 0.35, down: 0.35, n: 5.6 },
      { z: 0.8, w: 0.95, cy: 0.74, up: 0.35, down: 0.35, n: 5.6 },
      { z: 1.18, w: 0.94, cy: 0.74, up: 0.34, down: 0.15, n: 5.2 },
      { z: 1.78, w: 0.92, cy: 0.74, up: 0.32, down: 0.04, n: 4.6 },
      { z: 2.22, w: 0.86, cy: 0.74, up: 0.27, down: 0.1, n: 4.0 },
      { z: 2.42, w: 0.7, cy: 0.74, up: 0.18, down: 0.31, n: 3.2 },
    ],
    canopy: { w: 1.62, zFront: -1.74, zBack: 2.08, yTop: 1.66, roofZ0: -0.9, roofZ1: 1.5 },
    lamps: { headY: 0.94, headZ: -2.4, headW: 0.44, headH: 0.16, tailY: 1.06, tailZ: 2.4, tailW: 0.26, tailH: 0.36 },
  },
  coupe: {
    width: 1.88,
    wheelBase: 1.3,
    wheelRadius: 0.35,
    beltline: 0.96,
    stations: [
      { z: -2.2, w: 0.54, cy: 0.66, up: 0.1, down: 0.24, n: 2.8 },
      { z: -2.0, w: 0.76, cy: 0.66, up: 0.17, down: 0.26, n: 3.2 },
      { z: -1.8, w: 0.87, cy: 0.66, up: 0.21, down: 0.09, n: 3.8 },
      { z: -1.3, w: 0.91, cy: 0.66, up: 0.25, down: 0.03, n: 4.6 },
      { z: -0.82, w: 0.92, cy: 0.66, up: 0.26, down: 0.13, n: 4.8 },
      { z: -0.26, w: 0.92, cy: 0.66, up: 0.26, down: 0.28, n: 5.2 },
      { z: 0.5, w: 0.92, cy: 0.66, up: 0.26, down: 0.28, n: 5.2 },
      { z: 1.0, w: 0.9, cy: 0.67, up: 0.25, down: 0.14, n: 4.8 },
      { z: 1.5, w: 0.86, cy: 0.68, up: 0.21, down: 0.03, n: 4.2 },
      { z: 1.94, w: 0.7, cy: 0.68, up: 0.17, down: 0.09, n: 3.4 },
      { z: 2.16, w: 0.54, cy: 0.68, up: 0.11, down: 0.22, n: 2.8 },
    ],
    canopy: { w: 1.5, zFront: -0.88, zBack: 1.44, yTop: 1.32, roofZ0: -0.4, roofZ1: 0.38 },
    lamps: { headY: 0.78, headZ: -2.16, headW: 0.46, headH: 0.09, tailY: 0.8, tailZ: 2.16, tailW: 0.5, tailH: 0.07 },
  },
};

/**
 * Build one car shape. Returns geometry buckets:
 *   body   — paint, tinted per instance (the loft's own shading is multiplied by the colour)
 *   trim   — chrome: bumpers, sill rails, grille, exhaust
 *   dark   — pillars, arch flares, wheel wells, underbody, mirrors
 *   glass  — the greenhouse, drawn with the gradient shader
 *   head   — headlight faces
 *   tail   — tail light faces
 */
export function buildCar(shapeName) {
  const spec = CAR_SHAPES[shapeName] ?? CAR_SHAPES.sedan;
  // The greenhouse's sill is the shell's own shoulder line across its span, sunk a little into the
  // paint. Declaring it separately is how a canopy ends up hovering on top of a car.
  const shoulderAt = (z) => {
    const s = stationAt(spec.stations, z);
    return s.cy + s.up;
  };
  const canopyFloor =
    Math.min(
      shoulderAt(spec.canopy.zFront),
      shoulderAt((spec.canopy.zFront + spec.canopy.zBack) / 2),
      shoulderAt(spec.canopy.zBack),
    ) - 0.05;
  spec.canopy.yBottom = canopyFloor;
  spec.canopy.yTop = Math.max(spec.canopy.yTop, canopyFloor + 0.34);
  const stations = spec.stations;
  const front = stations[0].z;
  const back = stations[stations.length - 1].z;
  const nose = stations[0];
  const rear = stations[stations.length - 1];
  // The rocker panel's own height, taken from the shell rather than declared separately, so a sill
  // rail sits on the body instead of hovering below it.
  const sill = Math.min(...stations.map((s) => s.cy - s.down));

  const body = loft(stations, { dark: 0.36, shoulder: 1.14 });

  // Haunches: a shallow loft that swells the flanks over each axle. It reuses the shell's own
  // section at each z, so the flare is flush with the paint and cannot detach from it.
  const archParts = [];
  for (const axle of [-1, 1]) {
    const z = axle * spec.wheelBase;
    const ringStations = [];
    for (let i = 0; i <= 4; i += 1) {
      const t = i / 4;
      const zz = z - 0.56 + t * 1.12;
      const base = stationAt(stations, zz);
      const bulge = Math.sin(t * Math.PI) * 0.035;
      // The flare widens the flank and raises the lower edge, but never moves the shoulder.
      ringStations.push({ z: zz, w: base.w + bulge, cy: base.cy, up: base.up, down: base.down - 0.012, n: base.n });
    }
    archParts.push(loft(ringStations, { dark: 1, shoulder: 1 }));
  }
  const haunch = bake(archParts);

  const chrome = [];
  const dark = [];

  // Bumpers: bars that follow the taper of the nose and tail, proud of the paint, wrapped round.
  const bumperY = nose.cy - 0.06;
  chrome.push({ geometry: followBar(stations, front + 0.02, front + 0.26, 1.0, 0.06, bumperY, 0.15, 0xf2efe8), color: 0xffffff });
  chrome.push({ geometry: followBar(stations, back - 0.26, back - 0.02, 1.0, 0.06, bumperY, 0.15, 0xf2efe8), color: 0xffffff });
  // Grille slot between the headlamps and a slim bright bar across the nose.
  chrome.push(box(nose.w * 0.86, 0.075, 0.05, 0, spec.lamps.headY - 0.075, front - 0.012, 0xd8d4cc));
  // Sill rails down both flanks at the bottom of the doors, hugging the shell.
  for (const side of [-1, 1]) {
    chrome.push({ geometry: followBarSide(stations, front + 0.4, back - 0.4, side, 1.0, 0.045, 0.03, sill + 0.06, 0xdcd8d0, 8), color: 0xffffff });
  }
  // Exhaust tip tucked under the rear bumper.
  chrome.push(box(0.11, 0.055, 0.12, spec.width * 0.2, sill + 0.12, back - 0.1, 0xa8a49a));

  // Wheel wells: a dark arch liner sits just inside each haunch, so no sky shows through an arch.
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) {
      dark.push({ geometry: archLiner(spec, side, axle * spec.wheelBase), color: 0x0b0d10 });
    }
  }
  // Underbody pan between the axles.
  dark.push(box(spec.width * 0.66, 0.09, (back - front) * 0.66, 0, sill + 0.2, 0, 0x0b0d10));
  // Door shut lines: thin seams, read as panel gaps at any distance.
  for (const side of [-1, 1]) {
    for (const z of [-0.36, 0.82]) {
      const w = stationAt(stations, z).w;
      const seam = new THREE.PlaneGeometry(0.024, 0.34);
      seam.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      seam.translate(side * (w - 0.045), 0.72, z);
      dark.push({ geometry: seam, color: 0x0f1114 });
    }
  }
  // Lamp housings: a recess behind each face, so the faces sit in a socket.
  for (const side of [-1, 1]) {
    const { headY, headZ, headW, headH, tailW, tailH, tailY, tailZ } = spec.lamps;
    dark.push(box(headW + 0.07, headH + 0.085, 0.05, side * spec.width * 0.3, headY, headZ + 0.028, 0x111318));
    dark.push(box(tailW + 0.06, tailH + 0.07, 0.05, side * spec.width * 0.3, tailY, tailZ - 0.028, 0x111318));
  }
  dark.push({ geometry: pillars(spec.canopy), color: 0xffffff });

  const headParts = [];
  const tailParts = [];
  for (const side of [-1, 1]) {
    const { headY, headZ, headW, headH, tailW, tailH, tailY, tailZ } = spec.lamps;
    const h = new THREE.PlaneGeometry(headW, headH);
    h.rotateY(Math.PI);
    h.translate(side * spec.width * 0.31, headY, headZ - 0.008);
    headParts.push({ geometry: h, color: 0xffffff });
    const t = new THREE.PlaneGeometry(tailW, tailH);
    t.translate(side * spec.width * 0.31, tailY, tailZ + 0.008);
    tailParts.push({ geometry: t, color: 0xffffff });
  }

  const buckets = {
    body: bake([{ geometry: body }, { geometry: haunch }]),
    trim: bake(chrome),
    dark: bake(dark),
    glass: canopy(spec.canopy),
    head: bake(headParts),
    tail: bake(tailParts),
    spec,
  };
  return buckets;
}

export { stationAt };
