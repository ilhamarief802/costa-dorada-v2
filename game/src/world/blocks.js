// Block surfaces: the raised sidewalk pad around every city block, the inner lot floor
// (plaza, tarmac or park lawn), and the grass caps for the two parks. Buildings and street
// furniture sit on these pads, so one height function keeps everything grounded.

import { CITY, SURFACE } from '../core/config.js';

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
    const texture = this.assets.pavement().clone();
    texture.needsUpdate = true;
    texture.repeat.set(3, 3);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture, roughness: 0.92, metalness: 0 });
    const geometry = new THREE.BoxGeometry(CITY.block, CITY.padHeight, CITY.block);
    geometry.translate(0, CITY.padHeight / 2, 0);
    const pads = this.plan.blocks.map((block) => ({ x: block.x, y: 0, z: block.z, color: block.tint }));
    const mesh = new THREE.InstancedMesh(geometry, material, pads.length);
    const tint = new THREE.Color();
    const dummy = new THREE.Object3D();
    pads.forEach((pad, index) => {
      dummy.position.set(pad.x, 0, pad.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      tint.set(pad.color);
      mesh.setColorAt(index, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
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
