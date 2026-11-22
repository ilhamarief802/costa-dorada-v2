// Traffic: cars driving the lane graph, following the car ahead, yielding at red lights and to
// the player, and turning at junctions. Bodies, glass, wheels and lamps are instanced; a stolen
// car becomes a driveable arcade car with its own physics.

import { ART, CAR } from '../core/config.js';
import { clamp, damp, lerp, dampAngle, wrapAngle } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

const COUNT = 34;

function sedanGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, color) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    parts.push({ geometry, color });
  };
  add(1.82, 0.46, 4.1, 0, 0.6, 0, 0xffffff);
  add(1.74, 0.16, 1.3, 0, 0.86, -1.45, 0xe8e8e8);
  add(1.58, 0.5, 1.95, 0, 1.03, 0.1, 0xd8d8d8);
  add(1.74, 0.14, 0.72, 0, 0.9, 1.62, 0xf0f0f0);
  add(1.9, 0.12, 0.18, 0, 0.44, -2.05, 0x8e8e8e);
  add(1.9, 0.12, 0.18, 0, 0.44, 2.05, 0x8e8e8e);
  return mergeGeometries(parts);
}

function vanGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, color) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    parts.push({ geometry, color });
  };
  add(1.98, 0.62, 4.6, 0, 0.7, 0, 0xffffff);
  add(1.92, 1.05, 2.7, 0, 1.5, 0.55, 0xf0f0f0);
  add(1.72, 0.5, 1.2, 0, 1.2, -1.75, 0xe4e4e4);
  add(1.98, 0.16, 0.24, 0, 0.44, -2.32, 0x7e7e7e);
  add(1.98, 0.16, 0.24, 0, 0.44, 2.32, 0x7e7e7e);
  return mergeGeometries(parts);
}

/** A stolen traffic car: the same arcade model the hero coupe uses, without the authoured trim. */
class DriveCar {
  constructor(plan, collision, spot) {
    this.plan = plan;
    this.collision = collision;
    this.position = { x: spot.x, y: plan.groundHeight(spot.x, spot.z), z: spot.z };
    this.prev = { ...this.position };
    this.heading = spot.heading;
    this.prevHeading = spot.heading;
    this.vx = 0;
    this.vz = 0;
    this.forwardSpeed = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.handbrake = false;
    this.mass = 1;
    this.name = 'stolen';
  }

  update(dt, input) {
    this.prev = { ...this.position };
    this.prevHeading = this.heading;

    const forwardX = -Math.sin(this.heading);
    const forwardZ = -Math.cos(this.heading);
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);
    let vForward = this.vx * forwardX + this.vz * forwardZ;
    let vLateral = this.vx * rightX + this.vz * rightZ;

    const throttle = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    this.handbrake = input.isDown('handbrake');
    if (throttle > 0) vForward += CAR.engineForce * dt;
    else if (throttle < 0) {
      if (vForward > 0.4) vForward -= CAR.brakeForce * dt;
      else vForward -= CAR.reverseForce * dt;
    } else {
      vForward -= Math.sign(vForward) * Math.min(Math.abs(vForward), CAR.rollResist * dt);
    }
    if (this.handbrake) vForward -= Math.sign(vForward) * Math.min(Math.abs(vForward), CAR.brakeForce * 0.6 * dt);
    vForward -= vForward * CAR.drag * dt;
    vForward = clamp(vForward, -11, CAR.topSpeed * 0.86);

    const steerInput = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
    const steerLimit = CAR.maxSteer * (0.34 + 0.66 / (1 + Math.abs(vForward) * 0.055));
    this.steer = damp(this.steer, steerInput * steerLimit, 9, dt);
    if (Math.abs(vForward) > 0.15) {
      this.heading += (vForward / CAR.wheelBase) * Math.tan(this.steer) * 0.58 * dt;
      this.heading = wrapAngle(this.heading);
    }

    vLateral *= Math.exp(-(this.handbrake ? CAR.driftGrip : CAR.grip) * dt);
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);
    this.vx = fx * vForward + rx * vLateral;
    this.vz = fz * vForward + rz * vLateral;
    this.forwardSpeed = vForward;

    this.position.x += this.vx * dt;
    this.position.z += this.vz * dt;

    for (const offset of [-1.3, 0, 1.3]) {
      const sample = { x: this.position.x + fx * offset, z: this.position.z + fz * offset };
      const hit = this.collision.resolve(sample, 0.92, { maxStep: 0.05 });
      if (hit) {
        this.position.x += sample.x - (this.position.x + fx * offset);
        this.position.z += sample.z - (this.position.z + fz * offset);
        const vn = this.vx * hit.x + this.vz * hit.z;
        if (vn < 0) {
          this.vx -= hit.x * vn * 1.4;
          this.vz -= hit.z * vn * 1.4;
          this.forwardSpeed *= 0.55;
        }
      }
    }

    this.position.y = damp(this.position.y, this.plan.groundHeight(this.position.x, this.position.z), 16, dt);
    this.wheelSpin += (vForward * dt) / 0.36;
  }

  cameraTarget() {
    return { x: this.position.x, y: this.position.y + 1.15, z: this.position.z };
  }

  speedKmh() {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  applyPose() {
    // Traffic renders this car through its own instance slot; nothing to do here.
  }

  setNight() {}
}

export default class Traffic {
  constructor(scene, plan, lanes, assets, collision, blobs) {
    this.plan = plan;
    this.lanes = lanes;
    this.assets = assets;
    this.collision = collision;
    this.blobs = blobs;
    this.cars = [];
    this.time = 0;
    this.night = false;
    this.playerActor = null;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    this.build();
    scene.add(this.group);
    this.apply(1);
  }

  build() {
    const rng = this.plan.rng.fork('traffic-v2');
    const colors = [0xd7c48f, 0x3a3d42, 0x8c2f2a, 0x2b5d74, 0xb0642c, 0xd8d4c8, 0x4a5a46, 0x6d6a78];
    const links = this.lanes.links.filter((link) => link.len > 20);
    const spawn = rng.shuffle(links).slice(0, Math.min(COUNT, links.length));

    for (let i = 0; i < spawn.length; i += 1) {
      const link = spawn[i];
      const s = rng.range(link.len * 0.15, link.len * 0.85);
      const point = this.lanes.pointAt(link, s);
      const limit = link.limit * rng.range(0.78, 1.0);
      this.cars.push({
        index: i,
        shape: rng.chance(0.24) ? 'van' : 'sedan',
        link,
        next: null,
        s,
        turnFrom: null,
        turnT: 1,
        x: point.x,
        z: point.z,
        prevX: point.x,
        prevZ: point.z,
        heading: this.lanes.heading(link),
        prevHeading: this.lanes.heading(link),
        speed: limit * rng.range(0.35, 0.7),
        limit,
        brake: 0,
        blocked: 0,
        colour: rng.pick(colors),
        scale: rng.range(0.94, 1.1),
        wheelSpin: rng.range(0, 6.28),
        steer: 0,
        occupied: false,
        driven: false,
        bumpVx: 0,
        bumpVz: 0,
        patience: 0,
        stuck: 0,
      });
    }

    this.bodies = this.makeBodyMeshes();
    this.glass = this.makeGlass();
    this.wheels = this.makeWheels();
    this.heads = this.makeLamps(0xffe8b8, 1.24, 0.13);
    this.tails = this.makeLamps(0xff3b2c, 1.34, 0.11);
    this.pools = this.makePools();
    this.glow = this.makeGlow();
    this.blobSlots = this.cars.map(() => this.blobs.claim(0, -400, 0, 0.0001));
    this.dummy = new THREE.Object3D();
    this.local = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
    this.tint = new THREE.Color();
    this.carColors = this.cars.map((car) => new THREE.Color(car.colour));
  }

  makeBodyMeshes() {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.28 });
    const sedan = new THREE.InstancedMesh(sedanGeometry(), material, COUNT);
    const van = new THREE.InstancedMesh(vanGeometry(), material, COUNT);
    for (const mesh of [sedan, van]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
    const sedanCars = this.cars.filter((car) => car.shape === 'sedan');
    const vanCars = this.cars.filter((car) => car.shape === 'van');
    sedan.count = sedanCars.length;
    van.count = vanCars.length;
    this.sedanCars = sedanCars;
    this.vanCars = vanCars;
    const colour = new THREE.Color();
    sedanCars.forEach((car, index) => {
      colour.set(car.colour);
      sedan.setColorAt(index, colour);
    });
    vanCars.forEach((car, index) => {
      colour.set(car.colour);
      van.setColorAt(index, colour);
    });
    if (sedan.instanceColor) sedan.instanceColor.needsUpdate = true;
    if (van.instanceColor) van.instanceColor.needsUpdate = true;
    return { sedan, van };
  }

  makeGlass() {
    const geometry = mergeGeometries([
      { geometry: (() => { const g = new THREE.BoxGeometry(1.44, 0.36, 1.8); g.translate(0, 1.06, 0.05); return g; })(), color: 0x11242c },
      { geometry: (() => { const g = new THREE.BoxGeometry(0.06, 0.3, 1.2); g.translate(-0.78, 1.06, -0.5); return g; })(), color: 0x11242c },
      { geometry: (() => { const g = new THREE.BoxGeometry(0.06, 0.3, 1.2); g.translate(0.78, 1.06, -0.5); return g; })(), color: 0x11242c },
    ]);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.72 });
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  makeWheels() {
    const geometry = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10);
    geometry.rotateZ(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.94 });
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT * 4);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  makeLamps(color, width, height) {
    const geometry = new THREE.BoxGeometry(width, height, 0.06);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const tint = new THREE.Color(color);
    const dim = tint.clone().multiplyScalar(0.5);
    this.cars.forEach((car, index) => mesh.setColorAt(index, dim));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.lampBase = tint;
    this.lampDim = dim;
    return mesh;
  }

  makePools() {
    const geometry = new THREE.PlaneGeometry(3.4, 7.2);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -4.6);
    const material = new THREE.MeshBasicMaterial({
      map: this.assets.glow(),
      color: 0xffcf94,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.poolMaterial = material;
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    return mesh;
  }

  makeGlow() {
    const positions = new Float32Array(COUNT * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: this.assets.glow(),
      color: 0xffeec4,
      size: 1.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.glowMaterial = material;
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    return points;
  }

  // ------------------------------------------------------------------ simulation

  setPlayer(actor) {
    this.playerActor = actor;
  }

  /** Nearest car within `radius`, for the steal prompt. */
  nearestCar(x, z, radius = 4.2) {
    let best = null;
    for (const car of this.cars) {
      if (car.occupied) continue;
      const distance = Math.hypot(car.x - x, car.z - z);
      if (distance < radius && (!best || distance < best.distance)) best = { car, distance };
    }
    return best ? best.car : null;
  }

  vacate(car) {
    car.occupied = false;
    car.driven = false;
    const nearest = this.lanes.nearest(car.x, car.z, 30);
    if (nearest) {
      car.link = nearest.link;
      car.s = nearest.s;
      car.next = null;
      car.turnT = 1;
      car.speed = 0;
      car.heading = this.lanes.heading(nearest.link);
      car.prevHeading = car.heading;
    }
  }

  /** Turn one car into a driveable actor; returns it or null. */
  steal(car) {
    if (!car || car.occupied) return null;
    car.occupied = true;
    car.driven = true;
    car.brake = 0;
    const actor = new DriveCar(this.plan, this.collision, { x: car.x, z: car.z, heading: car.heading });
    actor.car = car;
    return actor;
  }

  update(dt, context = {}) {
    this.time += dt;
    const player = context.player;
    const police = context.police;

    for (const car of this.cars) {
      if (car.driven) {
        car.prevX = car.x;
        car.prevZ = car.z;
        car.prevHeading = car.heading;
        continue;
      }
      this.drive(car, dt, player, police);
    }

    // Bump cars out of the way when the player's stolen car shoves them.
    if (this.playerActor && this.playerActor.position) {
      const p = this.playerActor.position;
      for (const car of this.cars) {
        if (car.driven || car.occupied) continue;
        const dx = car.x - p.x;
        const dz = car.z - p.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 2.6 && distance > 0.001) {
          const push = (2.6 - distance) * 0.5;
          car.bumpVx += (dx / distance) * push;
          car.bumpVz += (dz / distance) * push;
          car.stuck = 0;
        }
      }
    }

    for (const car of this.cars) {
      if (car.driven) continue;
      car.bumpVx *= Math.exp(-4 * dt);
      car.bumpVz *= Math.exp(-4 * dt);
      car.x += car.bumpVx * dt;
      car.z += car.bumpVz * dt;
    }
  }

  /** Advance the whole simulation headlessly, used to warm a captured frame. */
  warmup(seconds) {
    const steps = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < steps; i += 1) this.update(1 / 30, {});
  }

  drive(car, dt, player, police) {
    car.prevX = car.x;
    car.prevZ = car.z;
    car.prevHeading = car.heading;
    const link = car.link;
    const lane = this.lanes.pointAt(link, car.s);
    const remaining = link.len - car.s;

    let target = car.limit;
    let stopForLight = false;

    // Car in front, on this link or the next one.
    const leader = this.leaderOf(car);
    if (leader) {
      const gap = leader.gap;
      const safety = 5.4 + car.speed * 0.62;
      if (gap < safety) target = Math.min(target, leader.speed * 0.9 + Math.max(0, gap - 3.4) * 1.4);
      if (gap < 2.9) target = 0;
      if (gap < 8 && leader.speed < 1.2) {
        car.patience += dt;
      } else {
        car.patience = Math.max(0, car.patience - dt * 2);
      }
    } else {
      car.patience = Math.max(0, car.patience - dt * 2);
    }

    // Traffic light at the end of this link.
    const node = this.lanes.nodes[link.b];
    if (node.light && remaining < 26) {
      const state = this.lanes.lightFor(node, link.axis, this.time);
      if (state !== 'green') {
        stopForLight = true;
        target = Math.min(target, Math.max(0, (remaining - 6) * 0.9));
        if (remaining < 6.5) target = 0;
      }
    }

    // Player on foot in the lane ahead.
    if (player && !player.hidden) {
      const px = player.position.x - lane.x;
      const pz = player.position.z - lane.z;
      const ahead = px * link.dx + pz * link.dz;
      const lateral = Math.abs(px * -link.dz + pz * link.dx);
      if (ahead > 0 && ahead < 12 && lateral < 3.0) {
        target = Math.min(target, Math.max(0, (ahead - 3.2) * 1.1));
      }
    }

    // Police cruisers parked across the street are solid walls.
    if (police && police.roadblockNear(lane.x, lane.z)) {
      target = Math.min(target, 2.5);
    }

    if (car.blocked > 0) {
      car.blocked -= dt;
      target = 0;
    }

    const emergency = target < 0.6 || (target < car.speed - 3.4);
    car.brake = emergency ? 1 : target < car.speed - 0.4 ? 0.4 : 0;
    const rate = target < car.speed ? 5.2 : 2.1;
    car.speed = damp(car.speed, target, rate, dt);
    if (car.speed < 0.05 && target < 0.05) car.speed = 0;

    const move = car.speed * dt;
    car.s += move;

    // Look one link ahead early, so car-following can see across the junction without a turn
    // flickering between different choices every frame.
    if (!car.nextLink || car.nextLink === car.link) {
      car.nextLink = this.chooseNext(car);
    }

    let guard = 0;
    while (car.s > car.link.len && guard < 4) {
      car.s -= car.link.len;
      const from = this.lanes.pointAt(car.link, car.link.len);
      car.turnFrom = { x: from.x, z: from.z };
      car.turnT = 0;
      car.link = car.nextLink ?? this.chooseNext(car);
      car.nextLink = this.chooseNext(car);
      guard += 1;
    }
    if (car.s < -0.5) car.s = 0;

    const point = this.lanes.pointAt(car.link, car.s);
    let x = point.x;
    let z = point.z;
    let heading = this.lanes.heading(car.link);
    if (car.turnFrom) {
      car.turnT = Math.min(1, car.turnT + dt / 0.42);
      const t = car.turnT * car.turnT * (3 - 2 * car.turnT);
      x = lerp(car.turnFrom.x, point.x, t);
      z = lerp(car.turnFrom.z, point.z, t);
      if (car.turnT >= 1) car.turnFrom = null;
    }

    car.x = x;
    car.z = z;
    car.heading = dampAngle(car.heading, heading, 7.5, dt);
    car.steer = damp(car.steer, clamp(wrapAngle(heading - car.heading) * 1.6, -0.5, 0.5), 8, dt);
    car.wheelSpin += (car.speed * dt) / 0.33;
    if (stopForLight && car.speed < 0.1) car.speed = 0;
  }

  planRng(linkId, carIndex) {
    if (!this._pickRng) this._pickRng = this.plan.rng.fork('traffic-pick');
    const seed = (linkId * 7349 + carIndex * 977 + Math.floor(this.time) * 13) >>> 0;
    let state = seed || 1;
    return {
      next: () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      },
    };
  }

  leaderOf(car) {
    let best = null;
    for (const other of this.cars) {
      if (other === car || other.driven) continue;
      let gap = Infinity;
      if (other.link === car.link && other.s > car.s) {
        gap = other.s - car.s;
      } else if (other.link === car.nextLink) {
        gap = car.link.len - car.s + other.s;
      }
      if (gap < (best ? best.gap : 34)) best = { gap, speed: other.speed, car: other };
    }
    return best;
  }

  chooseNext(car) {
    return this.lanes.pickNext(car.link, this.planRng(car.link.id, car.index));
  }

  // ------------------------------------------------------------------ rendering

  apply(alpha) {
    const sedanMatrix = this.matrix;
    let sedanIndex = 0;
    let vanIndex = 0;
    const glowPositions = this.glow.geometry.getAttribute('position');

    for (const car of this.cars) {
      const x = lerp(car.prevX, car.x, alpha);
      const z = lerp(car.prevZ, car.z, alpha);
      const delta = wrapAngle(car.heading - car.prevHeading);
      const heading = car.prevHeading + delta * alpha;
      const y = this.plan.groundHeight(x, z) + 0.015;

      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(0, heading, 0);
      this.dummy.scale.setScalar(car.scale);
      this.dummy.updateMatrix();

      const mesh = car.shape === 'van' ? this.bodies.van : this.bodies.sedan;
      const index = car.shape === 'van' ? vanIndex++ : sedanIndex++;
      mesh.setMatrixAt(index, this.dummy.matrix);
      this.glass.setMatrixAt(car.index, this.dummy.matrix);

      this.local.position.set(0, car.shape === 'van' ? 0.86 : 0.76, -2.14);
      this.local.rotation.set(0, 0, 0);
      this.local.scale.set(1, 1, 1);
      this.local.updateMatrix();
      sedanMatrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
      this.heads.setMatrixAt(car.index, sedanMatrix);

      this.local.position.set(0, car.shape === 'van' ? 0.88 : 0.78, 2.16);
      this.local.updateMatrix();
      sedanMatrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
      this.tails.setMatrixAt(car.index, sedanMatrix);

      const braking = car.brake > 0.05 || car.driven;
      this.tint.copy(braking ? this.lampBase : this.lampDim);
      if (car.driven) this.tint.set(0xff6a3a);
      this.tails.setColorAt(car.index, this.tint);

      this.local.position.set(0, 0.33, -1.34);
      this.local.rotation.set(0, car.steer * 0.4, 0);
      this.local.updateMatrix();
      for (const side of [-1, 1]) {
        this.local.position.x = side * 0.86;
        this.local.updateMatrix();
        sedanMatrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
        this.wheels.setMatrixAt(car.index * 4 + (side > 0 ? 1 : 0), sedanMatrix);
      }
      this.local.position.z = 1.34;
      this.local.updateMatrix();
      for (const side of [-1, 1]) {
        this.local.position.x = side * 0.86;
        this.local.updateMatrix();
        sedanMatrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
        this.wheels.setMatrixAt(car.index * 4 + (side > 0 ? 3 : 2), sedanMatrix);
      }

      this.local.position.set(0, 0, 0);
      this.local.rotation.set(0, 0, 0);
      this.local.updateMatrix();
      sedanMatrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
      this.pools.setMatrixAt(car.index, sedanMatrix);

      glowPositions.setXYZ(
        car.index,
        x - Math.sin(heading) * 2.3,
        y + 0.78,
        z - Math.cos(heading) * 2.3,
      );

      if (this.blobs) this.blobs.write(this.blobSlots[car.index], x, y + 0.03, z, car.shape === 'van' ? 4.6 : 4.2, 0.4);
    }

    this.bodies.sedan.instanceMatrix.needsUpdate = true;
    this.bodies.van.instanceMatrix.needsUpdate = true;
    this.glass.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;
    if (this.tails.instanceColor) this.tails.instanceColor.needsUpdate = true;
    this.pools.instanceMatrix.needsUpdate = true;
    glowPositions.needsUpdate = true;
    this.bodies.sedan.count = this.sedanCars.length;
    this.bodies.van.count = this.vanCars.length;
    if (this.blobs) this.blobs.commit();
  }

  setNight(night) {
    this.night = night;
    if (!this.poolMaterial) return;
    this.poolMaterial.opacity = night ? 0.4 : 0;
    this.glowMaterial.opacity = night ? 0.9 : 0;
    this.glowMaterial.size = night ? 2.3 : 0.001;
    const head = night ? new THREE.Color(0xfff3d2) : new THREE.Color(0xe4dcc4);
    for (let i = 0; i < this.cars.length; i += 1) this.heads.setColorAt(i, head);
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    this.lampBase.set(night ? 0xff4a30 : 0xd23a26);
    this.lampDim.set(night ? 0x611410 : 0x5c1c14);
  }
}
