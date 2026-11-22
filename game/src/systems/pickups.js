// Pickups: health and armour packs on a slow respawn, and cash dropped by downed enemies. All of
// them are one instanced box with per-instance colour, bobbing above the pavement.

import { mergeGeometries, makeInstances } from '../core/geom.js';

const SLOTS = 24;

function packGeometry() {
  const body = new THREE.BoxGeometry(0.7, 0.46, 0.5);
  body.translate(0, 0.62, 0);
  const lid = new THREE.BoxGeometry(0.72, 0.16, 0.52);
  lid.translate(0, 0.9, 0);
  const crossA = new THREE.BoxGeometry(0.34, 0.14, 0.08);
  crossA.translate(0, 0.62, 0.27);
  const crossB = new THREE.BoxGeometry(0.14, 0.34, 0.08);
  crossB.translate(0, 0.62, 0.27);
  return mergeGeometries([
    { geometry: body, color: 0xffffff },
    { geometry: lid, color: 0xf0ede4 },
    { geometry: crossA, color: 0x241a14 },
    { geometry: crossB, color: 0x241a14 },
  ]);
}

export default class Pickups {
  constructor({ scene, plan, blobs, assets }) {
    this.plan = plan;
    this.blobs = blobs;
    this.assets = assets;
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = 'pickups';
    this.time = 0;
    scene.add(this.group);
    this.healthGeometry = packGeometry();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.25, emissive: 0x1a1208, emissiveIntensity: 0.7 });

    this.spawnStatic();
    this.dummy = new THREE.Object3D();
    this.colour = new THREE.Color();
  }

  spawnStatic() {
    const spots = [
      { x: 28, z: 150, kind: 'health' },
      { x: -44, z: 96, kind: 'armour' },
      { x: 96, z: -34, kind: 'health' },
      { x: -96, z: -70, kind: 'armour' },
      { x: 126, z: 96, kind: 'health' },
      { x: 24, z: 232, kind: 'armour' },
      { x: -160, z: 214, kind: 'health' },
      { x: 190, z: 214, kind: 'armour' },
    ];
    for (const spot of spots) {
      this.items.push({
        x: spot.x,
        z: spot.z,
        kind: spot.kind,
        value: spot.kind === 'health' ? 40 : 45,
        respawn: 0,
        active: true,
        cash: false,
      });
    }
  }

  dropCash(x, z, amount) {
    this.items.push({
      x,
      z,
      kind: 'cash',
      value: amount,
      respawn: 0,
      active: true,
      cash: true,
      life: 26,
    });
  }

  update(dt, actor) {
    this.time += dt;
    if (!this.mesh) this.rebuild();
    for (const item of this.items) {
      if (!item.active) {
        item.respawn -= dt;
        if (item.respawn <= 0 && !item.cash) item.active = true;
        continue;
      }
      if (item.cash) {
        item.life -= dt;
        if (item.life <= 0) item.active = false;
      }
      if (actor) {
        const distance = Math.hypot(item.x - actor.position.x, item.z - actor.position.z);
        if (distance < 2.1 && item.onCollect !== false) {
          this.collect(item);
        }
      }
    }
    this.write();
  }

  collect(item) {
    item.active = false;
    item.respawn = item.cash ? 0 : 42;
    if (this.onCollect) this.onCollect(item);
  }

  rebuild() {
    const geometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    this.mesh = new THREE.InstancedMesh(geometry, this.material, SLOTS);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.glow = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(SLOTS * 3), 3)),
      new THREE.PointsMaterial({
        map: this.assets.glow(),
        color: 0xffffff,
        size: 1.9,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.group.add(this.glow);
    this.mesh.count = SLOTS;
  }

  write() {
    if (!this.mesh) return;
    const positions = this.glow.geometry.getAttribute('position');
    let index = 0;
    const palette = { health: 0xcf4a3a, armour: 0x3f7fa0, cash: 0xd8b45c };
    for (let i = 0; i < SLOTS; i += 1) {
      this.dummy.position.set(0, -400, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      if (i < this.items.length) {
        const item = this.items[i];
        if (item.active) {
          const bob = Math.sin(this.time * 2.1 + i) * 0.09;
          const y = this.plan.groundHeight(item.x, item.z) + 0.62 + bob;
          this.dummy.position.set(item.x, y, item.z);
          this.dummy.rotation.set(0, this.time * 0.8 + i, 0);
          this.dummy.scale.setScalar(1);
          this.dummy.updateMatrix();
          positions.setXYZ(i, item.x, y + 0.1, item.z);
          this.colour.set(palette[item.kind] ?? 0xffffff);
          this.mesh.setColorAt(i, this.colour);
        } else {
          positions.setXYZ(i, 0, -600, 0);
        }
      }
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    positions.needsUpdate = true;
  }

  serialize() {
    return this.items.filter((item) => !item.cash).map((item) => ({ active: item.active, respawn: item.respawn }));
  }
}
