// Palms: one merged, curved trunk and one merged crown of drooping fronds, instanced across
// the whole city in two draw calls. Rotation and scale per tree come from the seed.

import { mergeGeometries, makeInstances } from '../core/geom.js';

const TRUNK = 0x7a6248;
const FROND_GREENS = [0x3f6b32, 0x4d7a3a, 0x355f2c, 0x577f3d, 0x2f5527];

function makeTrunk() {
  const parts = [];
  const segments = 6;
  let x = 0;
  let y = 0;
  for (let i = 0; i < segments; i += 1) {
    const height = 1.05 - i * 0.05;
    const radius = 0.27 - i * 0.025;
    const geometry = new THREE.CylinderGeometry(radius * 0.86, radius, height, 7);
    const lean = 0.16 * Math.sin(i * 0.7);
    geometry.rotateZ(lean * 0.25);
    geometry.translate(x, y + height / 2, 0);
    x += lean * 0.5;
    y += height * 0.96;
    parts.push({ geometry });
    // Ring scars where old fronds fell.
    if (i > 0) {
      const ring = new THREE.CylinderGeometry(radius + 0.02, radius + 0.02, 0.06, 7);
      ring.translate(x, y - height * 0.5, 0);
      parts.push({ geometry: ring, color: 0x5e4a36 });
    }
  }
  return { geometry: mergeGeometries(parts), top: { x, y } };
}

function makeFrond(angle, length, droop, color) {
  const positions = [];
  const uvs = [];
  const colors = [];
  const sides = 6;
  const tint = new THREE.Color(color);
  let prev = null;
  for (let s = 0; s <= sides; s += 1) {
    const t = s / sides;
    const reach = length * t;
    const width = 0.42 * (1 - t * 0.82) + 0.03;
    const drop = -droop * t * t * 2.4 + Math.sin(t * Math.PI) * 0.14;
    const cx = Math.cos(angle) * reach;
    const cz = Math.sin(angle) * reach;
    const px = -Math.sin(angle) * width;
    const pz = Math.cos(angle) * width;
    const left = [cx - px, drop, cz - pz];
    const right = [cx + px, drop, cz + pz];
    if (prev) {
      positions.push(...prev.left, ...prev.right, ...right);
      positions.push(...prev.left, ...right, ...left);
      uvs.push(0, s, 1, s, 1, s + 1);
      uvs.push(0, s, 1, s + 1, 0, s + 1);
      for (let i = 0; i < 6; i += 1) colors.push(tint.r, tint.g, tint.b);
    }
    prev = { left, right };
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export default class Palms {
  constructor(plan, assets) {
    void assets;
    this.plan = plan;
    this.group = new THREE.Group();
    this.group.name = 'palms';
    this.build();
  }

  build() {
    const trunk = makeTrunk();
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: TRUNK, roughness: 0.95, metalness: 0 });
    const rng = this.plan.rng.fork('fronds');
    const fronds = [];
    const count = 10;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + rng.range(-0.16, 0.16);
      fronds.push({
        geometry: makeFrond(angle, rng.range(2.7, 3.6), rng.range(0.55, 1.0), rng.pick(FROND_GREENS)),
      });
    }
    const crown = mergeGeometries(fronds);
    crown.translate(trunk.top.x, trunk.top.y, 0);
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const placements = this.plan.palms.map((palm) => {
      const base = this.plan.groundHeight(palm.x, palm.z);
      return { x: palm.x, y: base, z: palm.z, ry: palm.rot, scale: palm.s };
    });
    const trunks = makeInstances(trunk.geometry, trunkMaterial, placements, { castShadow: true, receiveShadow: true });
    const crowns = makeInstances(crown, crownMaterial, placements, { castShadow: true, receiveShadow: true });
    this.group.add(trunks);
    this.group.add(crowns);
  }
}
