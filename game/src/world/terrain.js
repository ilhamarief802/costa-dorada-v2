// Land: the concrete basin the city sits on, raked block pads, the promenade, the beach slope,
// grassy parks and the dry hills that close the northern horizon.

import { CITY } from '../core/config.js';

export default class Terrain {
  constructor(plan, assets) {
    this.plan = plan;
    this.group = new THREE.Group();
    this.group.name = 'terrain';

    const pavement = assets.pavement();
    const sand = assets.sand();

    this.addLand(pavement, -820, 250, -820, 270);
    this.addLand(pavement, 392, 820, -820, 270);
    this.addLand(pavement, 250, 392, -820, 108);
    this.addPromenade(pavement);    this.addPromenade(pavement);
    this.addBeach(sand);
    this.addHills();
    this.addMarinaQuay(pavement);
  }

  addLand(pavement, x0, x1, z0, z1) {
    const width = x1 - x0;
    const depth = z1 - z0;
    const texture = pavement.clone();
    texture.needsUpdate = true;
    texture.repeat.set(width / 12, depth / 12);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: 0x7c7469, map: texture, roughness: 1, metalness: 0 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, -0.03, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  addPromenade(pavement) {
    const texture = pavement.clone();
    texture.needsUpdate = true;
    texture.repeat.set(56, 3);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(470, 0.3, CITY.promenadeEnd - CITY.beachStart),
      new THREE.MeshStandardMaterial({ color: 0xd0c2ab, map: texture, roughness: 0.9, metalness: 0 }),
    );
    slab.position.set(-6, 0.15, (CITY.beachStart + CITY.promenadeEnd) / 2);
    slab.receiveShadow = true;
    this.group.add(slab);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(470, 0.55, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xcfc4b0, roughness: 0.75, metalness: 0.05 }),
    );
    rail.position.set(-6, 0.55, CITY.beachStart + 0.3);
    rail.castShadow = true;
    this.group.add(rail);
  }

  addBeach(sand) {
    const depth = CITY.shoreEnd - CITY.promenadeEnd;
    const centerZ = (CITY.promenadeEnd + CITY.shoreEnd) / 2;
    const geometry = new THREE.PlaneGeometry(580, depth, 60, 10);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const worldZ = positions.getZ(i) + centerZ;
      const t = Math.max(0, Math.min(1, (worldZ - CITY.promenadeEnd) / depth));
      positions.setY(i, 0.3 - t * 0.72 + Math.sin(worldZ * 0.35) * 0.04);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const texture = sand.clone();
    texture.needsUpdate = true;
    texture.repeat.set(40, 4);
    const beach = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture, roughness: 1, metalness: 0 }),
    );
    beach.position.set(-50, 0, centerZ);
    beach.receiveShadow = true;
    this.group.add(beach);
  }

  addHills() {
    const rng = this.plan.rng.fork('hills');
    for (let i = 0; i < 9; i += 1) {
      const radius = rng.range(70, 170);
      const hill = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x4a5240 : 0x3e4738, roughness: 1, metalness: 0 }),
      );
      hill.position.set(-620 + i * 155 + rng.range(-50, 50), -12, -460 - rng.range(0, 180));
      hill.scale.y = rng.range(0.08, 0.17);
      hill.receiveShadow = true;
      this.group.add(hill);
    }
  }

  addMarinaQuay(pavement) {
    const texture = pavement.clone();
    texture.needsUpdate = true;
    texture.repeat.set(3, 12);
    const quay = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 200),
      new THREE.MeshStandardMaterial({ color: 0x9a8f7d, map: texture, roughness: 0.92 }),
    );
    quay.position.set(236, 0.25, 208);
    quay.receiveShadow = true;
    quay.castShadow = true;
    this.group.add(quay);
  }
}
