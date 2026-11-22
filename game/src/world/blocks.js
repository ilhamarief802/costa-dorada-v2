// Block surfaces: the raised sidewalk pad around every city block, the inner lot floor
// (plaza, tarmac or park lawn), and the grass caps for the two parks. Buildings and street
// furniture sit on these pads, so one height function keeps everything grounded.

import { CITY, SURFACE } from '../core/config.js';
import { makeInstances } from '../core/geom.js';

export default class Blocks {
  constructor(plan, assets) {
    this.plan = plan;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'blocks';
    this.buildPads();
    this.buildInnerSurfaces();
    this.buildLawns();
  }

  buildPads() {
    // Three tile scales, offset per block, so no two pavements in view share a repeat phase.
    this.padMaterials = [];
    for (let variant = 0; variant < 3; variant += 1) {
      const texture = this.assets.pavement().clone();
      texture.needsUpdate = true;
      texture.repeat.set(2.4 + variant * 0.7, 2.4 + variant * 0.7);
      texture.offset.set(variant * 0.37, variant * 0.71);
      texture.rotation = variant * 0.21;
      texture.center.set(0.5, 0.5);
      this.padMaterials.push(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: texture,
          roughness: 0.92,
          metalness: 0,
        }),
      );
    }
    const geometry = new THREE.BoxGeometry(CITY.block, CITY.padHeight, CITY.block);
    geometry.translate(0, CITY.padHeight / 2, 0);
    const pads = this.plan.blocks.map((block) => ({
      x: block.x,
      y: 0,
      z: block.z,
      color: block.tint,
      variant: block.index % 3,
    }));
    const rng = this.plan.rng.fork('pad-variants');
    this.padMeshes = [];
    const tint = new THREE.Color();
    const dummy = new THREE.Object3D();
    for (let variant = 0; variant < 3; variant += 1) {
      const subset = pads.filter((pad) => pad.variant === variant);
      const mesh = new THREE.InstancedMesh(geometry, this.padMaterials[variant], Math.max(1, subset.length));
      mesh.count = subset.length;
      subset.forEach((pad, index) => {
        dummy.position.set(pad.x, 0, pad.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        tint.set(pad.color);
        tint.offsetHSL(0, 0, rng.range(-0.035, 0.035));
        mesh.setColorAt(index, tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.padMeshes.push(mesh);
    }

    // Kerb detail: a pale coping strip just inside each pad edge, and a darker gutter line under
    // it. Both instanced, so the sidewalk reads as built rather than painted.
    const copingGeometry = new THREE.BoxGeometry(1, 0.06, 0.26);
    copingGeometry.translate(0, CITY.padHeight + 0.03, 0);
    const copingMaterial = new THREE.MeshStandardMaterial({ color: 0xded2be, roughness: 0.78, metalness: 0 });
    const gutterGeometry = new THREE.BoxGeometry(1, 0.02, 0.18);
    gutterGeometry.translate(0, CITY.padHeight + 0.012, 0);
    const gutterMaterial = new THREE.MeshStandardMaterial({ color: 0x6c6459, roughness: 0.95, metalness: 0 });
    const coping = [];
    const gutters = [];
    for (const block of this.plan.blocks) {
      const h = block.half;
      const inner = h - 0.13;
      const span = CITY.block - 0.26;
      for (const side of [-1, 1]) {
        coping.push({ x: block.x, y: 0, z: block.z + side * inner, scale: [span, 1, 1] });
        gutters.push({ x: block.x, y: 0, z: block.z + side * (inner - 0.3), scale: [span, 1, 1] });
        coping.push({ x: block.x + side * inner, y: 0, z: block.z, ry: Math.PI / 2, scale: [span, 1, 1] });
        gutters.push({ x: block.x + side * (inner - 0.3), y: 0, z: block.z, ry: Math.PI / 2, scale: [span, 1, 1] });
      }
    }
    this.group.add(makeInstances(copingGeometry, copingMaterial, coping, { receiveShadow: true }));
    this.group.add(makeInstances(gutterGeometry, gutterMaterial, gutters, { receiveShadow: true }));
  }

  buildInnerSurfaces() {
    const geometry = new THREE.PlaneGeometry(CITY.block - CITY.sidewalk * 2 - 0.4, CITY.block - CITY.sidewalk * 2 - 0.4);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    const placements = [];
    for (const block of this.plan.blocks) {
      if (block.park) continue;
      placements.push({
        x: block.x,
        y: CITY.padHeight + 0.012,
        z: block.z,
        color: block.plaza ? SURFACE.plaza : SURFACE.lot,
      });
    }
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    const color = new THREE.Color();
    placements.forEach((place, index) => {
      const dummy = new THREE.Object3D();
      dummy.position.set(place.x, place.y, place.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(place.color);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildLawns() {
    const rng = this.plan.rng.fork('lawns');
    for (const block of this.plan.blocks) {
      if (!block.park) continue;
      const grass = block.grass;
      const geometry = new THREE.PlaneGeometry(grass.w, grass.d, 6, 6);
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i += 1) {
        positions.setY(i, positions.getY(i) + rng.range(-0.05, 0.05));
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x44673a, roughness: 0.98, metalness: 0 }),
      );
      mesh.position.set(block.x, CITY.padHeight + 0.035, block.z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }
}
