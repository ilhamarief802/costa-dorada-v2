// Small, dependency-free maths used by movement, cameras and collision.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));
export const sign = (v) => (v < 0 ? -1 : 1);

export function dampAngle(current, target, rate, dt) {
  let delta = (target - current + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-rate * dt));
}

export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export function rotateXZ(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - z * s, z: x * s + z * c };
}

/** Distance from a point to an axis-aligned rectangle, negative inside. */
export function aabbDistance(px, pz, minX, minZ, maxX, maxZ) {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dz = Math.max(minZ - pz, 0, pz - maxZ);
  return Math.hypot(dx, dz);
}

/**
 * Push a circle out of a static AABB. Mutates `body` ({ x, z }) and returns the normal it was
 * pushed along, or null when there was no overlap.
 */
export function resolveCircleAabb(body, radius, minX, minZ, maxX, maxZ) {
  const closestX = clamp(body.x, minX, maxX);
  const closestZ = clamp(body.z, minZ, maxZ);
  let dx = body.x - closestX;
  let dz = body.z - closestZ;
  const distSq = dx * dx + dz * dz;
  if (distSq > radius * radius) return null;

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    dx /= dist;
    dz /= dist;
    const push = radius - dist;
    body.x += dx * push;
    body.z += dz * push;
    return { x: dx, z: dz, depth: push };
  }

  // Centre inside the box: escape through the nearest face.
  const left = body.x - minX;
  const right = maxX - body.x;
  const top = body.z - minZ;
  const bottom = maxZ - body.z;
  const min = Math.min(left, right, top, bottom);
  if (min === left) {
    body.x = minX - radius;
    return { x: -1, z: 0, depth: radius + left };
  }
  if (min === right) {
    body.x = maxX + radius;
    return { x: 1, z: 0, depth: radius + right };
  }
  if (min === top) {
    body.z = minZ - radius;
    return { x: 0, z: -1, depth: radius + top };
  }
  body.z = maxZ + radius;
  return { x: 0, z: 1, depth: radius + bottom };
}

/** Slab ray test against an AABB, returning the near hit distance or null. */
export function rayAabb(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];
  for (const [origin, dir, lo, hi] of axes) {
    if (Math.abs(dir) < 1e-8) {
      if (origin < lo || origin > hi) return null;
      continue;
    }
    let t1 = (lo - origin) / dir;
    let t2 = (hi - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export function formatMoney(value) {
  return `C$ ${Math.max(0, Math.round(value)).toLocaleString('en-US')}`;
}

export function formatClock(hours) {
  const total = ((hours % 24) + 24) % 24;
  const h = Math.floor(total);
  const m = Math.floor((total - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
