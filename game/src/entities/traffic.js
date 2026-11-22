// Background traffic on three seeded circuits. Bodies, glass, wheels and lamps are each one
// InstancedMesh, so a dozen moving cars cost six draw calls.

import { ART } from '../core/config.js';
import { lerp } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

function prepareLoop(points, lane) {
  const segments = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    segments.push({ a, b, length, start: total });
    total += length;
  }
  return { segments, length: total, lane };
}

function sampleLoop(loop, t) {
  const wrapped = ((t % 1) + 1) % 1;
  const distance = wrapped * loop.length;
  for (const segment of loop.segments) {
    if (distance <= segment.start + segment.length || segment === loop.segments[loop.segments.length - 1]) {
      const local = (distance - segment.start) / segment.length;
      const dx = (segment.b.x - segment.a.x) / segment.length;
      const dz = (segment.b.z - segment.a.z) / segment.length;
      const x = segment.a.x + (segment.b.x - segment.a.x) * local - dz * loop.lane;
      const z = segment.a.z + (segment.b.z - segment.a.z) * local + dx * loop.lane;
      return { x, z, dx, dz };
    }
  }
  return { x: 0, z: 0, dx: 0, dz: -1 };
}

export default class Traffic {
  constructor(scene, plan) {
    this.plan = plan;
    this.cars = [];
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    this.loops = plan.trafficLoops.map((loop) => prepareLoop(loop.points, loop.lane));
    this.build();
    scene.add(this.group);
    this.apply(1);
  }

  build() {
    const rng = this.plan.rng.fork('traffic');
    const counts = [5, 4, 3];
    const colors = [0xd7c48f, 0x3a3d42, 0x8c2f2a, 0x2b5d74, 0xb0642c, 0xd8d4c8];

    this.loops.forEach((loop, loopIndex) => {
      const count = counts[loopIndex] ?? 3;
      for (let i = 0; i < count; i += 1) {
        const t = i / count + rng.range(0.01, 0.04);
        const point = sampleLoop(loop, t);
        this.cars.push({
          loop,
          t,
          prevX: point.x,
          prevZ: point.z,
          x: point.x,
          z: point.z,
          heading: Math.atan2(-point.dx, -point.dz),
          prevHeading: Math.atan2(-point.dx, -point.dz),
          speed: rng.range(6.5, 11.5),
          color: rng.pick(colors),
          scale: rng.range(0.92, 1.12),
        });
      }
    });

    const bodyParts = [];
    const box = (w, h, d, x, y, z, color) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometry.translate(x, y, z);
      bodyParts.push({ geometry, color });
    };
    box(1.8, 0.5, 4.0, 0, 0.6, 0, 0xffffff);
    box(1.62, 0.22, 1.0, 0, 0.86, -1.35, 0xd8d8d8);
    box(1.56, 0.46, 1.9, 0, 1.03, 0.15, 0xc8c8c8);
    box(1.72, 0.14, 0.8, 0, 0.9, 1.55, 0xdddddd);
    const bodyGeometry = mergeGeometries(bodyParts);
    const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
    this.bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, this.cars.length);
    this.bodies.castShadow = true;
    this.bodies.receiveShadow = true;
    this.bodies.frustumCulled = false;
    const color = new THREE.Color();
    this.cars.forEach((car, index) => {
      color.set(car.color);
      this.bodies.setColorAt(index, color);
    });
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    this.group.add(this.bodies);

    const glassGeometry = new THREE.BoxGeometry(1.42, 0.34, 1.72);
    glassGeometry.translate(0, 1.06, 0.15);
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x11242c, roughness: 0.12, metalness: 0.7 });
    this.glass = new THREE.InstancedMesh(glassGeometry, glassMaterial, this.cars.length);
    this.glass.frustumCulled = false;
    this.group.add(this.glass);

    const wheelGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 });
    this.wheels = new THREE.InstancedMesh(wheelGeometry, wheelMaterial, this.cars.length * 4);
    this.wheels.frustumCulled = false;
    this.group.add(this.wheels);

    this.lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffe7b8, toneMapped: false });
    const lampGeometry = new THREE.BoxGeometry(1.3, 0.12, 0.06);
    this.heads = new THREE.InstancedMesh(lampGeometry, this.lampMaterial, this.cars.length);
    this.heads.frustumCulled = false;
    this.group.add(this.heads);
    this.tailMaterial = new THREE.MeshBasicMaterial({ color: 0xb33626, toneMapped: false });
    const tailGeometry = new THREE.BoxGeometry(1.3, 0.1, 0.05);
    this.tails = new THREE.InstancedMesh(tailGeometry, this.tailMaterial, this.cars.length);
    this.tails.frustumCulled = false;
    this.group.add(this.tails);

    this.dummy = new THREE.Object3D();
    this.local = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
  }

  update(dt) {
    for (const car of this.cars) {
      car.prevX = car.x;
      car.prevZ = car.z;
      car.prevHeading = car.heading;
      car.t += (car.speed * dt) / car.loop.length;
      if (car.t >= 1) {
        car.t -= 1;
        const wrapped = sampleLoop(car.loop, car.t);
        car.prevX = wrapped.x;
        car.prevZ = wrapped.z;
        car.prevHeading = Math.atan2(-wrapped.dx, -wrapped.dz);
      }
      const point = sampleLoop(car.loop, car.t);
      car.x = point.x;
      car.z = point.z;
      car.heading = Math.atan2(-point.dx, -point.dz);
    }
  }

  apply(alpha) {
    this.cars.forEach((car, index) => {
      let heading = car.heading;
      let delta = ((car.heading - car.prevHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      heading = car.prevHeading + delta * alpha;
      const x = lerp(car.prevX, car.x, alpha);
      const z = lerp(car.prevZ, car.z, alpha);

      this.dummy.position.set(x, 0.02, z);
      this.dummy.rotation.set(0, heading, 0);
      this.dummy.scale.setScalar(car.scale);
      this.dummy.updateMatrix();
      this.bodies.setMatrixAt(index, this.dummy.matrix);
      this.glass.setMatrixAt(index, this.dummy.matrix);

      this.local.position.set(0, 0.78, -1.95);
      this.local.rotation.set(0, 0, 0);
      this.local.scale.set(1, 1, 1);
      this.local.updateMatrix();
      this.matrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
      this.heads.setMatrixAt(index, this.matrix);
      this.local.position.set(0, 0.78, 1.98);
      this.local.updateMatrix();
      this.matrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
      this.tails.setMatrixAt(index, this.matrix);

      let wheelIndex = index * 4;
      for (const side of [-1, 1]) {
        for (const axle of [-1.26, 1.26]) {
          this.local.position.set(side * 0.82, 0.32, axle);
          this.local.rotation.set(0, 0, 0);
          this.local.updateMatrix();
          this.matrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
          this.wheels.setMatrixAt(wheelIndex, this.matrix);
          wheelIndex += 1;
        }
      }
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.glass.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;
  }

  setNight(night) {
    this.lampMaterial.color.set(night ? 0xffefc4 : 0xe8dcc0);
    this.tailMaterial.color.set(night ? 0xff5a3c : 0x9c2c1e);
  }
}
