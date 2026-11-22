// The road network: asphalt drawn as one textured mesh with world-space UVs (so junctions
// never double-draw), then lane dashes, crosswalks and kerb stones as instances.

import { CITY, SURFACE } from '../core/config.js';
import { mergeGeometries, makeInstances } from '../core/geom.js';

function roadQuad(x0, x1, z0, z1) {
  const positions = new Float32Array([
    x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1,
  ]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([
    x0 / 9, z0 / 9, x1 / 9, z0 / 9, x1 / 9, z1 / 9, x0 / 9, z1 / 9,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
}

export default class Roads {
  constructor(plan, assets) {
    this.plan = plan;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    this.buildSurface(assets);
    this.buildMarkings();
    this.buildCurbs();
  }

  buildSurface(assets) {
    const parts = [];
    for (const road of this.plan.roads) {
      if (road.axis === 'x') {
        const z0 = road.z - road.d / 2;
        const z1 = road.z + road.d / 2;
        const x0 = road.x - road.w / 2;
        const x1 = road.x + road.w / 2;
        parts.push({ geometry: roadQuad(x0, x1, z0, z1) });
      }
    }
    for (const road of this.plan.roads) {
      if (road.axis !== 'z') continue;
      const x0 = road.x - road.w / 2;
      const x1 = road.x + road.w / 2;
      let z0 = road.z - road.d / 2;
      const z1 = road.z + road.d / 2;
      const cuts = [];
      for (const other of this.plan.roads) {
        if (other.axis === 'x') cuts.push([other.z - other.d / 2, other.z + other.d / 2]);
      }
      cuts.sort((a, b) => a[0] - b[0]);
      for (const cut of cuts) {
        const end = Math.min(cut[0], z1);
        if (end > z0 + 0.1) parts.push({ geometry: roadQuad(x0, x1, z0, end) });
        z0 = Math.max(z0, cut[1]);
      }
      if (z1 > z0 + 0.1) parts.push({ geometry: roadQuad(x0, x1, z0, z1) });
    }

    const asphalt = assets.asphalt();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphalt,
      roughness: 0.58,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.position.y = 0.02;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildMarkings() {
    const markings = { x: [], z: [] };
    const verticals = this.plan.roads.filter((road) => road.axis === 'z').map((road) => road.x);
    const horizontals = this.plan.roads.filter((road) => road.axis === 'x').map((road) => road.z);
    const near = (value, list, margin) => list.some((point) => Math.abs(value - point) < margin);

    for (const road of this.plan.roads) {
      if (road.axis === 'z') {
        for (let z = road.z - road.d / 2 + 5; z < road.z + road.d / 2 - 5; z += 9) {
          if (near(z, horizontals, 11)) continue;
          markings.z.push({ x: road.x, z, w: 0.22, d: 3.9 });
        }
      } else {
        for (let x = road.x - road.w / 2 + 5; x < road.x + road.w / 2 - 5; x += 9) {
          if (near(x, verticals, 11)) continue;
          markings.x.push({ x, z: road.z, w: 3.9, d: 0.22 });
        }
      }
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0xf0e5c9,
      roughness: 0.75,
      metalness: 0,
      emissive: 0x2a2418,
      emissiveIntensity: 0.4,
    });
    const placements = [
      ...markings.z.map((m) => ({ x: m.x, y: 0.05, z: m.z, scale: [m.w, 1, m.d] })),
      ...markings.x.map((m) => ({ x: m.x, y: 0.05, z: m.z, scale: [m.w, 1, m.d] })),
    ];
    const dashes = makeInstances(geometry, material, placements, { receiveShadow: true });
    this.group.add(dashes);

    const stripes = [];
    for (const road of this.plan.roads.filter((r) => r.axis === 'z')) {
      const zMin = road.z - road.d / 2;
      const zMax = road.z + road.d / 2;
      for (const other of this.plan.roads.filter((r) => r.axis === 'x')) {
        if (other.z < zMin || other.z > zMax) continue;
        const half = other.d / 2;
        for (const side of [-1, 1]) {
          for (let n = 0; n < 5; n += 1) {
            stripes.push({
              x: road.x,
              y: 0.055,
              z: other.z + side * (half + 1.4 + n * 0.95),
              scale: [CITY.road - 1.5, 1, 0.42],
            });
          }
        }
      }
    }
    const crosswalks = makeInstances(geometry, material, stripes, { receiveShadow: true });
    this.group.add(crosswalks);
  }

  buildCurbs() {
    const geometry = new THREE.BoxGeometry(1, CITY.curbHeight, 0.34);
    geometry.translate(0, CITY.curbHeight / 2, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xd2c6b2, roughness: 0.82, metalness: 0 });
    const placements = [];
    for (const block of this.plan.blocks) {
      const h = block.half;
      const w = CITY.block;
      placements.push({ x: block.x, y: 0, z: block.z - h + 0.17, scale: [w, 1, 1] });
      placements.push({ x: block.x, y: 0, z: block.z + h - 0.17, scale: [w, 1, 1] });
      placements.push({ x: block.x - h + 0.17, y: 0, z: block.z, ry: Math.PI / 2, scale: [w, 1, 1] });
      placements.push({ x: block.x + h - 0.17, y: 0, z: block.z, ry: Math.PI / 2, scale: [w, 1, 1] });
    }
    const curbs = makeInstances(geometry, material, placements, { castShadow: false, receiveShadow: true });
    this.group.add(curbs);
  }
}
