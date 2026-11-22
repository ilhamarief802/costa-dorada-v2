// Pedestrians walking their block. Four InstancedMeshes carry every person: torso, head and
// hair, both arms and both legs, with matrices rebuilt from a tiny animation hierarchy.

import { ART } from '../core/config.js';
import { lerp } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

function headGeometry() {
  const parts = [];
  const skull = new THREE.SphereGeometry(0.14, 10, 8);
  skull.scale(0.94, 1.04, 0.96);
  skull.translate(0, 0.02, 0);
  parts.push({ geometry: skull, color: 0xffffff });
  const hair = new THREE.SphereGeometry(0.148, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hair.translate(0, 0.04, -0.012);
  parts.push({ geometry: hair, color: 0x231a15 });
  const nose = new THREE.BoxGeometry(0.03, 0.05, 0.045);
  nose.translate(0, -0.005, 0.14);
  parts.push({ geometry: nose, color: 0xffffff });
  return mergeGeometries(parts);
}

function armGeometry() {
  const parts = [];
  const sleeve = new THREE.BoxGeometry(0.095, 0.5, 0.12);
  sleeve.translate(0, -0.25, 0);
  parts.push({ geometry: sleeve, color: 0xffffff });
  const hand = new THREE.SphereGeometry(0.05, 6, 5);
  hand.translate(0, -0.52, 0);
  parts.push({ geometry: hand, color: 0x8d5a3b });
  return mergeGeometries(parts);
}

function legGeometry() {
  const parts = [];
  const leg = new THREE.BoxGeometry(0.15, 0.8, 0.18);
  leg.translate(0, -0.4, 0);
  parts.push({ geometry: leg, color: 0xffffff });
  const shoe = new THREE.BoxGeometry(0.16, 0.09, 0.28);
  shoe.translate(0, -0.83, 0.045);
  parts.push({ geometry: shoe, color: 0x1a1917 });
  return mergeGeometries(parts);
}

function loopLength(points) {
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

function pointOnLoop(points, t) {
  const length = loopLength(points);
  let distance = ((t % 1) + 1) % 1 * length;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance <= segment || i === points.length - 1) {
      const f = distance / segment;
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, dx: (b.x - a.x) / segment, dz: (b.z - a.z) / segment };
    }
    distance -= segment;
  }
  return { x: points[0].x, z: points[0].z, dx: 0, dz: -1 };
}

export default class Pedestrians {
  constructor(scene, plan) {
    this.plan = plan;
    this.people = [];
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    this.build();
    scene.add(this.group);
    this.apply(1);
  }

  build() {
    const rng = this.plan.rng.fork('pedestrians');
    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const loop = this.plan.pedLoops[i % this.plan.pedLoops.length];
      const t = rng.next();
      const point = pointOnLoop(loop, t);
      const person = {
        loop,
        t,
        x: point.x,
        z: point.z,
        prevX: point.x,
        prevZ: point.z,
        heading: Math.atan2(-point.dx, -point.dz),
        prevHeading: 0,
        speed: rng.range(0.95, 1.5),
        phase: rng.range(0, Math.PI * 2),
        scale: rng.range(0.9, 1.06),
        colors: {
          shirt: rng.pick(ART.shirt),
          skin: rng.pick(ART.skin),
          trousers: rng.pick(ART.trousers),
        },
      };
      person.prevHeading = person.heading;
      this.people.push(person);
    }

    const shirtMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75 });
    const armMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 });
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 });

    const torso = new THREE.BoxGeometry(0.42, 0.56, 0.24);
    torso.translate(0, 0, 0);
    this.torsoMesh = new THREE.InstancedMesh(torso, shirtMaterial, count);
    this.headMesh = new THREE.InstancedMesh(headGeometry(), skinMaterial, count);
    this.armMesh = new THREE.InstancedMesh(armGeometry(), armMaterial, count * 2);
    this.legMesh = new THREE.InstancedMesh(legGeometry(), legMaterial, count * 2);
    for (const mesh of [this.torsoMesh, this.headMesh, this.armMesh, this.legMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    const color = new THREE.Color();
    this.people.forEach((person, index) => {
      color.set(person.colors.shirt);
      this.torsoMesh.setColorAt(index, color);
      this.armMesh.setColorAt(index * 2, color);
      this.armMesh.setColorAt(index * 2 + 1, color);
      color.set(person.colors.skin);
      this.headMesh.setColorAt(index, color);
      color.set(person.colors.trousers);
      this.legMesh.setColorAt(index * 2, color);
      this.legMesh.setColorAt(index * 2 + 1, color);

      person.root = new THREE.Object3D();
      person.root.scale.setScalar(person.scale);
      person.torsoNode = new THREE.Object3D();
      person.torsoNode.position.y = 1.12;
      person.headNode = new THREE.Object3D();
      person.headNode.position.y = 1.57;
      person.armPivot = [new THREE.Object3D(), new THREE.Object3D()];
      person.armPivot[0].position.set(-0.27, 1.36, 0);
      person.armPivot[1].position.set(0.27, 1.36, 0);
      person.legPivot = [new THREE.Object3D(), new THREE.Object3D()];
      person.legPivot[0].position.set(-0.11, 0.9, 0);
      person.legPivot[1].position.set(0.11, 0.9, 0);
      for (const pivot of person.armPivot) person.root.add(pivot);
      for (const pivot of person.legPivot) person.root.add(pivot);
      person.root.add(person.torsoNode);
      person.root.add(person.headNode);
    });
    this.torsoMesh.instanceColor.needsUpdate = true;
    this.headMesh.instanceColor.needsUpdate = true;
    this.armMesh.instanceColor.needsUpdate = true;
    this.legMesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (const person of this.people) {
      person.prevX = person.x;
      person.prevZ = person.z;
      person.prevHeading = person.heading;
      person.t += (person.speed * dt) / loopLength(person.loop);
      if (person.t >= 1) {
        person.t -= 1;
        const wrapped = pointOnLoop(person.loop, person.t);
        person.prevX = wrapped.x;
        person.prevZ = wrapped.z;
        person.prevHeading = Math.atan2(-wrapped.dx, -wrapped.dz);
      }
      const point = pointOnLoop(person.loop, person.t);
      person.x = point.x;
      person.z = point.z;
      person.heading = Math.atan2(-point.dx, -point.dz);
      person.phase += person.speed * dt * 4.2;
    }
  }

  apply(alpha) {
    this.people.forEach((person, index) => {
      const x = lerp(person.prevX, person.x, alpha);
      const z = lerp(person.prevZ, person.z, alpha);
      const delta = ((person.heading - person.prevHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const heading = person.prevHeading + delta * alpha;
      person.root.position.set(x, this.plan.groundHeight(x, z), z);
      person.root.rotation.y = heading;

      const swing = Math.sin(person.phase);
      person.legPivot[0].rotation.x = swing * 0.5;
      person.legPivot[1].rotation.x = -swing * 0.5;
      person.armPivot[0].rotation.x = -swing * 0.4;
      person.armPivot[1].rotation.x = swing * 0.4;
      person.root.updateMatrixWorld(true);

      this.torsoMesh.setMatrixAt(index, person.torsoNode.matrixWorld);
      this.headMesh.setMatrixAt(index, person.headNode.matrixWorld);
      this.armMesh.setMatrixAt(index * 2, person.armPivot[0].matrixWorld);
      this.armMesh.setMatrixAt(index * 2 + 1, person.armPivot[1].matrixWorld);
      this.legMesh.setMatrixAt(index * 2, person.legPivot[0].matrixWorld);
      this.legMesh.setMatrixAt(index * 2 + 1, person.legPivot[1].matrixWorld);
    });
    this.torsoMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    this.armMesh.instanceMatrix.needsUpdate = true;
    this.legMesh.instanceMatrix.needsUpdate = true;
  }
}
