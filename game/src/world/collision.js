// Broadphase for the city's static boxes: a uniform grid of collider indices with circle,
// capsule-ish sampling and ray queries for the camera.

import { resolveCircleAabb, rayAabb } from '../core/math.js';

export default class Collision {
  constructor(colliders, cellSize = 14) {
    this.cell = cellSize;
    this.colliders = colliders;
    this.buckets = new Map();
    this.build();
  }

  key(ix, iz) {
    return `${ix},${iz}`;
  }

  build() {
    this.colliders.forEach((box, index) => {
      const x0 = Math.floor(box.minX / this.cell);
      const x1 = Math.floor(box.maxX / this.cell);
      const z0 = Math.floor(box.minZ / this.cell);
      const z1 = Math.floor(box.maxZ / this.cell);
      for (let ix = x0; ix <= x1; ix += 1) {
        for (let iz = z0; iz <= z1; iz += 1) {
          const key = this.key(ix, iz);
          if (!this.buckets.has(key)) this.buckets.set(key, []);
          this.buckets.get(key).push(index);
        }
      }
    });
  }

  near(x, z, radius) {
    const x0 = Math.floor((x - radius) / this.cell);
    const x1 = Math.floor((x + radius) / this.cell);
    const z0 = Math.floor((z - radius) / this.cell);
    const z1 = Math.floor((z + radius) / this.cell);
    const seen = new Set();
    const result = [];
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iz = z0; iz <= z1; iz += 1) {
        const bucket = this.buckets.get(this.key(ix, iz));
        if (!bucket) continue;
        for (const index of bucket) {
          if (seen.has(index)) continue;
          seen.add(index);
          result.push(this.colliders[index]);
        }
      }
    }
    return result;
  }

  /**
   * Resolve a body against every nearby box. `maxStep` lets a person walk up kerbs; pass 0
   * for a car, which must respect them.
   */
  resolve(body, radius, { maxStep = 0.25, iterations = 2, kinds = null } = {}) {
    let hit = null;
    for (let pass = 0; pass < iterations; pass += 1) {
      let any = false;
      const nearby = this.near(body.x, body.z, radius + 1);
      for (const box of nearby) {
        if (box.height <= maxStep) continue;
        if (kinds && !kinds.includes(box.kind)) continue;
        const contact = resolveCircleAabb(body, radius, box.minX, box.minZ, box.maxX, box.maxZ);
        if (contact) {
          any = true;
          hit = contact;
        }
      }
      if (!any) break;
    }
    return hit;
  }

  /** Nearest front-facing hit distance along a ray, ignoring boxes below `minHeight`. */
  rayHit(origin, direction, maxDistance, minHeight = 2.5) {
    let nearest = maxDistance;
    const nearby = this.near(origin.x, origin.z, maxDistance);
    for (const box of nearby) {
      if (box.height < minHeight) continue;
      const t = rayAabb(
        origin.x, origin.y, origin.z,
        direction.x, direction.y, direction.z,
        box.minX, 0, box.minZ,
        box.maxX, box.height, box.maxZ,
      );
      if (t !== null && t > 0.05 && t < nearest) nearest = t;
    }
    return nearest;
  }
}
