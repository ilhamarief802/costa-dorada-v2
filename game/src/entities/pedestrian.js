// Pedestrians: 72 people generated from the seed, walking the kerb rings of the city blocks,
// crossing the street at painted crosswalks, idling in small groups, some sitting on benches or
// leaning on walls. Each person writes five instance slots: torso, head, two arms and two legs
// merged per pair, so the whole crowd is six draw calls. Gunfire makes them scatter.

import { ART } from '../core/config.js';

const COUNT = 72;
const WALK = 0;
const SIT = 1;
const LEAN = 2;

function merge(pairs) {
  // Tiny local merge: same attributes as core/geom but only what a person needs.
  let total = 0;
  const prepared = pairs.map(({ geometry, color }) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const count = source.getAttribute('position').count;
    total += count;
    return { source, count, color };
  });
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);
  let offset = 0;
  for (const { source, count, color: tint } of prepared) {
    position.set(source.getAttribute('position').array, offset * 3);
    const nrm = source.getAttribute('normal');
    if (nrm) normal.set(nrm.array, offset * 3);
    const tex = source.getAttribute('uv');
    if (tex) uv.set(tex.array, offset * 2);
    const c = new THREE.Color(tint ?? 0xffffff);
    for (let i = 0; i < count; i += 1) {
      color[(offset + i) * 3] = c.r;
      color[(offset + i) * 3 + 1] = c.g;
      color[(offset + i) * 3 + 2] = c.b;
    }
    offset += count;
    source.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.computeBoundingSphere();
  return merged;
}

function headParts() {
  const skull = new THREE.SphereGeometry(0.145, 10, 8);
  skull.scale(0.94, 1.05, 0.96);
  const hair = new THREE.SphereGeometry(0.152, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
  hair.translate(0, 0.03, -0.012);
  hair.scale(1, 0.94, 1.02);
  return merge([
    { geometry: skull, color: 0xffffff },
    { geometry: hair, color: 0x231a15 },
  ]);
}

/** A wide brim hat / cap, its own instanced mesh so it only draws on the people wearing one. */
function hatGeometry() {
  const brim = new THREE.CylinderGeometry(0.23, 0.23, 0.022, 12);
  brim.translate(0, 0.155, 0);
  const crown = new THREE.CylinderGeometry(0.115, 0.135, 0.12, 10);
  crown.translate(0, 0.215, 0);
  return merge([
    { geometry: brim, color: 0xffffff },
    { geometry: crown, color: 0xd8d2c4 },
  ]);
}

/** A shoulder bag, one per shopper that carries one. */
function bagGeometry() {
  const body = new THREE.BoxGeometry(0.26, 0.3, 0.13);
  body.translate(0, 0.02, 0);
  const strap = new THREE.BoxGeometry(0.04, 0.36, 0.03);
  strap.translate(0, 0.36, -0.02);
  return merge([
    { geometry: body, color: 0xffffff },
    { geometry: strap, color: 0x2a2520 },
  ]);
}

function torsoParts() {
  const chest = new THREE.BoxGeometry(0.44, 0.56, 0.25);
  chest.translate(0, 0.28, 0);
  const hips = new THREE.BoxGeometry(0.38, 0.24, 0.23);
  hips.translate(0, -0.03, 0);
  const collar = new THREE.BoxGeometry(0.3, 0.07, 0.21);
  collar.translate(0, 0.58, 0);
  return merge([
    { geometry: chest, color: 0xffffff },
    { geometry: hips, color: 0xe2ddd2 },
    { geometry: collar, color: 0xf0ede6 },
  ]);
}

function armParts() {
  const sleeve = new THREE.BoxGeometry(0.1, 0.34, 0.12);
  sleeve.translate(0, -0.17, 0);
  const forearm = new THREE.BoxGeometry(0.088, 0.3, 0.1);
  forearm.translate(0, -0.48, 0);
  const hand = new THREE.SphereGeometry(0.052, 6, 5);
  hand.translate(0, -0.63, 0);
  return merge([
    { geometry: sleeve, color: 0xffffff },
    { geometry: forearm, color: 0xffffff },
    { geometry: hand, color: 0x8d5a3b },
  ]);
}

function legParts() {
  const thigh = new THREE.BoxGeometry(0.155, 0.42, 0.19);
  thigh.translate(0, -0.21, 0);
  const shin = new THREE.BoxGeometry(0.135, 0.4, 0.17);
  shin.translate(0, -0.62, 0);
  const shoe = new THREE.BoxGeometry(0.16, 0.09, 0.3);
  shoe.translate(0, -0.86, 0.05);
  return merge([
    { geometry: thigh, color: 0xffffff },
    { geometry: shin, color: 0xffffff },
    { geometry: shoe, color: 0x1a1917 },
  ]);
}

function rectPoints(block, half) {
  return [
    { x: block.x - half, z: block.z - half },
    { x: block.x + half, z: block.z - half },
    { x: block.x + half, z: block.z + half },
    { x: block.x - half, z: block.z + half },
  ];
}

function perimeter(points) {
  const segments = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    segments.push({ a, b, length, start: total });
    total += length;
  }
  return { segments, total };
}

function samplePath(path, distance) {
  const d = ((distance % path.total) + path.total) % path.total;
  for (const segment of path.segments) {
    if (d <= segment.start + segment.length) {
      const t = (d - segment.start) / segment.length;
      return {
        x: segment.a.x + (segment.b.x - segment.a.x) * t,
        z: segment.a.z + (segment.b.z - segment.a.z) * t,
        dx: (segment.b.x - segment.a.x) / segment.length,
        dz: (segment.b.z - segment.a.z) / segment.length,
      };
    }
  }
  const last = path.segments[path.segments.length - 1];
  return { x: last.b.x, z: last.b.z, dx: (last.b.x - last.a.x) / last.length, dz: (last.b.z - last.a.z) / last.length };
}

export default class Pedestrians {
  constructor(scene, plan, lanes, assets, blobs, collisions) {
    this.plan = plan;
    this.lanes = lanes;
    this.assets = assets;
    this.blobs = blobs;
    this.collision = collisions;
    this.people = [];
    this.time = 0;
    this.panic = 0;
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    this.build();
    scene.add(this.group);
    this.apply(1);
  }

  /** Nearest living pedestrian within `radius` — used by car hits and by firing near crowds. */
  nearest(x, z, radius = 3) {
    let best = null;
    for (const person of this.people) {
      if (!person.alive) continue;
      const distance = Math.hypot(person.x - x, person.z - z);
      if (distance < radius && (!best || distance < best.distance)) best = { person, distance };
    }
    return best ? best.person : null;
  }

  build() {
    const rng = this.plan.rng.fork('pedestrians-v2');
    const ring = this.plan.half - 1.15; // midway across the 4 m sidewalk
    const loopBlocks = this.plan.blocks.filter((block) => !block.park || block.plaza);

    // Paths: one kerb ring per downtown / promenade block, plus a few beach promenade strolls.
    this.paths = [];
    for (const block of loopBlocks) {
      const points = rectPoints(block, ring);
      this.paths.push({ points, ...perimeter(points), block, kerb: true });
    }

    const promenade = perimeter([
      { x: -220, z: 231 },
      { x: 236, z: 231 },
      { x: 236, z: 238 },
      { x: -220, z: 238 },
    ]);
    this.paths.push({ points: promenade.points, ...promenade, promenade: true });

    // Crossings: a short two-way path from kerb to kerb.
    for (const crossing of this.lanes.crossings) {
      const points = [crossing.from, crossing.to];
      const path = perimeter(points);
      this.paths.push({ points, ...path, crossing, short: true });
    }

    for (let i = 0; i < COUNT; i += 1) {
      let kind = WALK;
      if (i % 11 === 4) kind = SIT;
      else if (i % 13 === 7) kind = LEAN;

      let path;
      if ((i % 9 === 2 || i % 9 === 5) && this.lanes.crossings.length) {
        const crossing = this.lanes.crossings[i % this.lanes.crossings.length];
        const index = this.paths.findIndex((p) => p.crossing === crossing);
        path = this.paths[index];
      }
      if (!path) {
        const candidates = this.paths.filter((p) => !p.crossing);
        path = candidates[Math.floor(i * 7.13) % candidates.length];
        if (path.promenade && i % 3 !== 0) path = candidates[i % (candidates.length - 1)];
      }

      const distance = rng.range(0, path.total);
      const point = samplePath(path, distance);
      const heading = Math.atan2(-point.dx, -point.dz);
      const person = {
        kind,
        path,
        distance,
        speed: kind === WALK ? rng.range(0.86, 1.46) : 0,
        direction: rng.chance(0.5) ? 1 : -1,
        phase: rng.range(0, Math.PI * 2),
        x: point.x,
        z: point.z,
        prevX: point.x,
        prevZ: point.z,
        heading,
        prevHeading: heading,
        // Build varies: 0.84 reads as a short older walker, 1.09 a tall one, and the girth
        // widens the torso so the crowd is not a row of clones.
        scale: rng.range(0.84, 1.09),
        girth: rng.range(0.9, 1.16),
        hat: rng.chance(0.3),
        hatColour: rng.pick(ART.hats),
        bag: kind === WALK ? rng.chance(0.24) : false,
        bagSide: rng.chance(0.5) ? 1 : -1,
        shirt: rng.pick(ART.shirt),
        skin: rng.pick(ART.skin),
        trousers: rng.pick(ART.trousers),
        hair: rng.pick(ART.hair),
        fleeX: 0,
        fleeZ: 0,
        fleeTime: 0,
        idle: kind === WALK ? rng.range(0.2, 0.9) : 0,
        panicTime: 0,
        down: 0,
        alive: true,
        health: 100,
        hitHeight: 1.15,
        hitRadius: 0.46,
        fall: 0,
        fallSide: rng.chance(0.5) ? 1 : -1,
      };
      person.position = { x: 0, z: 0 };
      person.hitPoint = () => ({ x: person.x, z: person.z });
      person.onDamage = (damage, payload) => this.personHit(person, damage, payload);
      if (kind === SIT) {
        const bench = this.findBench(point.x, point.z);
        if (bench) {
          person.x = bench.x;
          person.z = bench.z;
          person.prevX = bench.x;
          person.prevZ = bench.z;
          person.heading = bench.rot;
          person.prevHeading = bench.rot;
        }
      }
      if (kind === LEAN) {
        person.leanAngle = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
        person.heading += Math.PI / 2;
      }
      this.people.push(person);
    }

    const shirtMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
    this.torsoMesh = new THREE.InstancedMesh(torsoParts(), shirtMaterial, COUNT);
    this.headMesh = new THREE.InstancedMesh(headParts(), bodyMaterial, COUNT);
    this.armMesh = new THREE.InstancedMesh(armParts(), shirtMaterial, COUNT * 2);
    this.legMesh = new THREE.InstancedMesh(legParts(), bodyMaterial, COUNT * 2);
    this.hatMesh = new THREE.InstancedMesh(hatGeometry(), shirtMaterial, COUNT);
    this.bagMesh = new THREE.InstancedMesh(bagGeometry(), shirtMaterial, COUNT);
    for (const mesh of [this.torsoMesh, this.headMesh, this.armMesh, this.legMesh, this.hatMesh, this.bagMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }

    const colour = new THREE.Color();
    this.people.forEach((person, index) => {
      colour.set(person.shirt);
      this.torsoMesh.setColorAt(index, colour);
      this.armMesh.setColorAt(index * 2, colour);
      this.armMesh.setColorAt(index * 2 + 1, colour);
      this.bagMesh.setColorAt(index, colour);
      colour.set(person.skin);
      this.headMesh.setColorAt(index, colour);
      colour.set(person.trousers);
      this.legMesh.setColorAt(index * 2, colour);
      this.legMesh.setColorAt(index * 2 + 1, colour);
      colour.set(person.hatColour ?? 0xffffff);
      this.hatMesh.setColorAt(index, colour);
      person.blob = this.blobs ? this.blobs.claim(person.x, -400, person.z, 0.0001) : -1;
    });
    for (const mesh of [this.torsoMesh, this.headMesh, this.armMesh, this.legMesh, this.hatMesh, this.bagMesh]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.dummy = new THREE.Object3D();
    this.node = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()];
  }

  findBench(x, z) {
    let best = null;
    for (const bench of this.plan.benches) {
      const distance = Math.hypot(bench.x - x, bench.z - z);
      if (distance < 34 && (!best || distance < best.distance)) best = { ...bench, distance };
    }
    return best;
  }

  personHit(person, damage, payload) {
    if (!person.alive) return false;
    person.health -= damage;
    person.fleeTime = 2.6;
    this.alarm(person.x, person.z, 14, 1.1);
    if (person.health <= 0) {
      person.alive = false;
      person.fall = 0;
      return false;
    }
    return true;
  }

  /** Keep pedestrians out of buildings: the collision grid pushes and turns them away. */
  contain(person) {
    if (!this.collision) return;
    const body = { x: person.x, z: person.z };
    const hit = this.collision.resolve(body, 0.34, { maxStep: 0.4 });
    if (hit) {
      person.x = body.x;
      person.z = body.z;
    }
  }

  /** Everyone within `radius` flinches and runs away from the noise. */
  alarm(x, z, radius = 26, strength = 1) {
    let hit = 0;
    for (const person of this.people) {
      const dx = person.x - x;
      const dz = person.z - z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius || distance < 0.01) continue;
      const push = (1 - distance / radius) * strength;
      person.fleeX = (dx / distance) * push * 5.5;
      person.fleeZ = (dz / distance) * push * 5.5;
      person.fleeTime = 1.6 + push * 1.8;
      person.panicTime = 2.2 + push * 2.4;
      hit += 1;
    }
    if (hit) {
      this.panic = Math.max(this.panic, 1.3);
      this.flash = 0.55;
    }
    return hit;
  }

  update(dt) {
    this.time += dt;
    this.flash = Math.max(0, (this.flash ?? 0) - dt);

    for (const person of this.people) {
      person.prevX = person.x;
      person.prevZ = person.z;
      person.prevHeading = person.heading;
      person.position.x = person.x;
      person.position.z = person.z;

      if (!person.alive) {
        person.fall = Math.min(1, person.fall + dt * 2.4);
        continue;
      }

      if (person.panicTime > 0) person.panicTime -= dt;
      if (person.fleeTime > 0) {
        person.fleeTime -= dt;
        const step = Math.min(dt, 1 / 30);
        person.x += person.fleeX * step;
        person.z += person.fleeZ * step;
        if (this.collision) {
          const body = { x: person.x, z: person.z };
          this.collision.resolve(body, 0.3, { maxStep: 0.4 });
          person.x = body.x;
          person.z = body.z;
        }
        if (this.plan.isWater(person.x, person.z)) {
          person.x = person.prevX;
          person.z = person.prevZ;
        }
        if (Math.hypot(person.fleeX, person.fleeZ) > 0.4) {
          person.heading = Math.atan2(-person.fleeX, -person.fleeZ);
        }
        person.phase += 14 * dt;
        continue;
      }

      if (person.kind !== WALK) {
        person.phase += dt * 0.9;
        continue;
      }

      if (person.idle > 0) {
        person.idle -= dt;
        person.phase += dt * 1.2;
        continue;
      }

      person.distance += person.speed * person.direction * dt;
      const point = samplePath(person.path, person.distance);
      person.x = point.x;
      person.z = point.z;
      if (person.direction > 0) person.heading = Math.atan2(-point.dx, -point.dz);
      else person.heading = Math.atan2(point.dx, point.dz);

      // Crosswalk paths are two-way: turn around at the ends.
      if (person.path.crossing) {
        const wrapped = ((person.distance % person.path.total) + person.path.total) % person.path.total;
        if (person.direction < 0 && wrapped < 0.4) person.direction = 1;
        if (person.direction > 0 && wrapped > person.path.total - 0.4) person.direction = -1;
      }
      if (person.path.total < 1.2 && person.kind === WALK) person.direction *= -1;

      person.phase += (person.speed * dt * 5.6) + dt * 0.4;
      this.contain(person);
    }
  }

  apply(alpha) {
    const rig = this.dummy;
    this.people.forEach((person, index) => {
      const x = person.prevX + (person.x - person.prevX) * alpha;
      const z = person.prevZ + (person.z - person.prevZ) * alpha;
      const y = this.plan.groundHeight(x, z);
      let heading = person.heading;
      const delta = ((heading - person.prevHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      heading = person.prevHeading + delta * alpha;

      const running = person.fleeTime > 0;
      const swing = Math.sin(person.phase) * (running ? 0.92 : 0.5);
      const swingOpp = Math.sin(person.phase + Math.PI) * (running ? 0.92 : 0.5);

      rig.position.set(x, y, z);
      rig.rotation.set(0, heading, 0);
      rig.scale.setScalar(person.scale);

      // A downed person lies flat rather than standing: rotate the whole rig about its feet.
      if (!person.alive) {
        const fall = person.fall;
        rig.rotation.set(0, heading, person.fallSide * fall * Math.PI * 0.48);
        rig.position.y = y + fall * 0.1;
      }

      const seated = person.kind === SIT;
      const leaning = person.kind === LEAN;
      const torsoY = seated ? 0.88 : 1.28;
      const leanTilt = leaning ? 0.28 : 0;
      rig.updateMatrixWorld(true);

      this.setNode(this.node[0], rig, 0, torsoY, 0, seated ? -0.2 : leaning ? leanTilt : running ? 0.12 : 0);
      if (person.girth !== 1) this.node[0].scale.set(person.girth ?? 1, 1, person.girth ?? 1);
      else this.node[0].scale.set(1, 1, 1);
      this.node[0].updateMatrix();
      this.node[0].matrixWorld.multiplyMatrices(rig.matrixWorld, this.node[0].matrix);
      this.torsoMesh.setMatrixAt(index, this.node[0].matrixWorld);

      this.setNode(this.node[1], rig, 0, torsoY + (seated ? 0.44 : 0.46), seated ? 0.02 : 0, 0);
      this.headMesh.setMatrixAt(index, this.node[1].matrixWorld);

      // Hats and bags only occupy their slot when the person wears one; otherwise the slot
      // collapses to nothing rather than the crowd all wearing every prop.
      if (person.hat) {
        this.setNode(this.node[1], rig, 0, torsoY + (seated ? 0.54 : 0.57), seated ? 0.02 : 0, 0, 0, 0);
        this.hatMesh.setMatrixAt(index, this.node[1].matrixWorld);
      } else {
        this.setNode(this.node[1], rig, 0, -400, 0, 0, 0, 0);
        this.node[1].scale.setScalar(0.0001);
        this.node[1].updateMatrix();
        this.node[1].matrixWorld.multiplyMatrices(rig.matrixWorld, this.node[1].matrix);
        this.hatMesh.setMatrixAt(index, this.node[1].matrixWorld);
      }
      if (person.bag) {
        const side = person.bagSide ?? 1;
        this.setNode(this.node[0], rig, side * 0.3, torsoY - 0.02, 0, 0, 0, 0);
        this.bagMesh.setMatrixAt(index, this.node[0].matrixWorld);
      } else {
        this.setNode(this.node[0], rig, 0, -400, 0, 0, 0, 0);
        this.node[0].scale.setScalar(0.0001);
        this.node[0].updateMatrix();
        this.node[0].matrixWorld.multiplyMatrices(rig.matrixWorld, this.node[0].matrix);
        this.bagMesh.setMatrixAt(index, this.node[0].matrixWorld);
      }

      const armPivotY = torsoY + (seated ? 0.24 : 0.26);
      const armSwing = running ? swing * 0.9 : swing * 0.72;
      this.setNode(
        this.node[0], rig, -0.28, armPivotY, 0,
        seated ? 0.35 : -armSwing,
        0, leaning ? -0.5 : 0.1,
      );
      this.armMesh.setMatrixAt(index * 2, this.node[0].matrixWorld);
      this.setNode(
        this.node[0], rig, 0.28, armPivotY, 0,
        seated ? 0.35 : armSwing,
        0, leaning ? 0.5 : -0.1,
      );
      this.armMesh.setMatrixAt(index * 2 + 1, this.node[0].matrixWorld);

      if (seated) {
        this.setNode(this.node[0], rig, -0.115, 0.52, 0.02, -1.28);
        this.legMesh.setMatrixAt(index * 2, this.node[0].matrixWorld);
        this.setNode(this.node[0], rig, 0.115, 0.52, 0.02, -1.28);
        this.legMesh.setMatrixAt(index * 2 + 1, this.node[0].matrixWorld);
      } else if (leaning) {
        this.setNode(this.node[0], rig, -0.115, 0.9, 0, 0.08, 0, 0.22);
        this.legMesh.setMatrixAt(index * 2, this.node[0].matrixWorld);
        this.setNode(this.node[0], rig, 0.115, 0.9, 0, -0.06, 0, -0.18);
        this.legMesh.setMatrixAt(index * 2 + 1, this.node[0].matrixWorld);
      } else {
        this.setNode(this.node[0], rig, -0.115, 0.9, 0, swing * 0.9);
        this.legMesh.setMatrixAt(index * 2, this.node[0].matrixWorld);
        this.setNode(this.node[0], rig, 0.115, 0.9, 0, swingOpp * 0.9);
        this.legMesh.setMatrixAt(index * 2 + 1, this.node[0].matrixWorld);
      }

      if (this.blobs) this.blobs.write(person.blob, x, y + 0.02, z, running ? 1.5 : 1.25, 0.26);
    });

    this.torsoMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    this.armMesh.instanceMatrix.needsUpdate = true;
    this.legMesh.instanceMatrix.needsUpdate = true;
    this.hatMesh.instanceMatrix.needsUpdate = true;
    this.bagMesh.instanceMatrix.needsUpdate = true;
    if (this.blobs) this.blobs.commit();
  }

  setNode(node, parent, x, y, z, rx = 0, ry = 0, rz = 0) {
    node.position.set(x, y, z);
    node.rotation.set(rx, ry, rz);
    node.scale.set(1, 1, 1);
    node.updateMatrix();
    node.matrixWorld.multiplyMatrices(parent.matrixWorld, node.matrix);
  }
}
