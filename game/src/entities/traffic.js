// Traffic: cars driving the lane graph — following the car ahead, yielding at red lights and to
// the player, turning at junctions, braking with a visible brake light. Every car is drawn from
// the shared lofted car kit: one instanced mesh per material bucket per shape, so thirty-odd
// cars cost a couple of dozen draw calls and each of them has shoulders, chrome and glass.

import { CAR } from '../core/config.js';
import { clamp, damp, lerp, dampAngle, wrapAngle } from '../core/math.js';
import { buildCar } from '../core/carkit.js';
import { makeGlassMaterial, setGlassSky } from '../core/materials.js';

const COUNT = 36;
const SHAPES = ['sedan', 'wagon', 'coupe'];

const PAINT = [0x8f2f28, 0x2b5d74, 0xd7c48f, 0x3a3d42, 0x4f7358, 0xb0642c, 0xd8d4c8, 0x6d6a78, 0x1f4a54, 0xe0b070, 0xa8a29a, 0x7b2f45];

/** A stolen traffic car: arcade physics, but rendered through its own traffic instance slot. */
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
    this.brake = throttle < 0 ? 1 : 0;

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

  applyPose() {}
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
    const rng = this.plan.rng.fork('traffic-v3');
    const links = this.lanes.links.filter((link) => link.len > 22);
    const spawn = rng.shuffle(links).slice(0, Math.min(COUNT, links.length));

    for (let i = 0; i < spawn.length; i += 1) {
      const link = spawn[i];
      const s = rng.range(link.len * 0.12, link.len * 0.88);
      const point = this.lanes.pointAt(link, s);
      const limit = link.limit * rng.range(0.7, 1.0);
      this.cars.push({
        index: i,
        shape: rng.weighted([[ 'sedan', 0.55], ['wagon', 0.24], ['coupe', 0.21]]),
        link,
        nextLink: null,
        s,
        turnFrom: null,
        turnT: 1,
        x: point.x,
        z: point.z,
        prevX: point.x,
        prevZ: point.z,
        heading: this.lanes.heading(link),
        prevHeading: this.lanes.heading(link),
        speed: limit * rng.range(0.2, 0.85),
        limit,
        brake: 0,
        blocked: 0,
        colour: rng.pick(PAINT),
        scale: rng.range(0.95, 1.07),
        wheelSpin: rng.range(0, 6.28),
        steer: 0,
        occupied: false,
        driven: false,
        bumpVx: 0,
        bumpVz: 0,
        patience: 0,
        stuck: 0,
        brakeFade: 0,
        headFade: rng.range(0.75, 1),
      });
    }

    this.byShape = {};
    for (const shape of SHAPES) {
      const cars = this.cars.filter((car) => car.shape === shape);
      this.byShape[shape] = cars;
      cars.forEach((car, index) => {
        car.shapeIndex = index;
      });
    }
    this.buildMeshes();
    this.blobSlots = this.cars.map(() => [this.blobs.claim(0, -400, 0, 0.0001), this.blobs.claim(0, -400, 0, 0.0001)]);
    this.dummy = new THREE.Object3D();
    this.local = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
    this.tint = new THREE.Color();
    this.carColors = this.cars.map((car) => new THREE.Color(car.colour));
    this.glows = [];
    this.buildLampGlows();
  }

  buildMeshes() {
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.94, metalness: 0.02 });
    const rim = new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.25, metalness: 0.96 });
    this.glassMaterial = makeGlassMaterial({ tint: 0x0c1a22, tintPower: 1 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.headMaterial = headMat;
    this.tailMaterial = tailMat;

    this.meshes = {};
    for (const shape of SHAPES) {
      const cars = this.byShape[shape];
      if (!cars.length) continue;
      const kit = buildCar(shape);
      const spec = kit.spec;
      spec.sill = Math.min(...spec.stations.map((s) => s.cy - s.down));
      const bucket = {
        spec,
        paint: new THREE.InstancedMesh(kit.body, paint, cars.length),
        chrome: new THREE.InstancedMesh(kit.trim, chrome, cars.length),
        dark: new THREE.InstancedMesh(kit.dark, dark, cars.length),
        glass: new THREE.InstancedMesh(kit.glass, this.glassMaterial, cars.length),
        head: new THREE.InstancedMesh(kit.head, headMat, cars.length),
        tail: new THREE.InstancedMesh(kit.tail, tailMat, cars.length),
        wheels: [],
      };
      const wheelCount = cars.length * 4;
      const wheelGeometry = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.22, 12);
      wheelGeometry.rotateZ(Math.PI / 2);
      bucket.tyre = new THREE.InstancedMesh(wheelGeometry, tyre, wheelCount);
      const rimGeometry = new THREE.CylinderGeometry(spec.wheelRadius * 0.58, spec.wheelRadius * 0.58, 0.235, 10);
      rimGeometry.rotateZ(Math.PI / 2);
      bucket.rim = new THREE.InstancedMesh(rimGeometry, rim, wheelCount);
      for (const mesh of [bucket.paint, bucket.chrome, bucket.dark, bucket.glass, bucket.head, bucket.tail, bucket.tyre, bucket.rim]) {
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
      bucket.paint.castShadow = true;
      bucket.paint.receiveShadow = true;
      bucket.dark.castShadow = true;
      bucket.chrome.receiveShadow = true;
      bucket.tyre.castShadow = true;

      const colour = new THREE.Color();
      cars.forEach((car, index) => {
        bucket.paint.setColorAt(index, colour.set(car.colour));
      });
      if (bucket.paint.instanceColor) bucket.paint.instanceColor.needsUpdate = true;
      this.meshes[shape] = bucket;
    }
  }

  /** Two additive sprites per car: one pair of headlamp halos, one red bloom on the tail lights. */
  buildLampGlows() {
    for (let i = 0; i < this.cars.length; i += 1) {
      const head = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.assets.glow(),
          color: 0xffeccc,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      head.scale.set(3.2, 1.9, 1);
      this.group.add(head);
      const tail = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.assets.glow(),
          color: 0xff3a20,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      tail.scale.set(1.9, 1.1, 1);
      this.group.add(tail);
      this.glows.push({ head, tail });
    }
  }

  // ------------------------------------------------------------------ simulation

  setPlayer(actor) {
    this.playerActor = actor;
  }

  /**
   * Staging for an authored frame: put a car on a lane near a point, at a given speed, facing down
   * the lane. Returns the car, or null when no lane comes close enough.
   */
  stage(x, z, { radius = 60, speed = 8, aheadOf = null } = {}) {
    // Only cars never staged for a frame can take a slot, so two calls never hand back the same
    // car and a staged car does not crowd its own lane.
    const free = this.cars.filter((car) => !car.driven && !car.staged);
    if (!free.length) return null;
    let best = null;
    for (const link of this.lanes.links) {
      const s = clamp((x - link.from.x) * link.dx + (z - link.from.z) * link.dz, 2, link.len - 2);
      const px = link.from.x + link.dx * s;
      const pz = link.from.z + link.dz * s;
      const distance = Math.hypot(px - x, pz - z);
      if (distance > radius || link.len < 24) continue;
      // A car already near this spot would overlap, so skip that lane.
      const crowded = this.cars.some((car) => car !== free[0] && Math.hypot(car.x - px, car.z - pz) < 12);
      if (crowded) continue;
      if (!best || distance < best.distance) best = { link, s, px, pz, distance };
    }
    if (!best) return null;
    const car = free[0];
    car.link = best.link;
    car.nextLink = null;
    car.s = best.s;
    car.turnFrom = null;
    car.turnT = 1;
    car.x = best.px;
    car.z = best.pz;
    car.prevX = best.px;
    car.prevZ = best.pz;
    car.heading = this.lanes.heading(best.link);
    car.prevHeading = car.heading;
    car.speed = speed;
    car.limit = Math.max(car.limit, speed);
    car.brake = 0;
    car.brakeFade = 0;
    car.stuck = 0;
    car.staged = true;
    if (aheadOf) void aheadOf;
    return car;
  }

  /**
   * Place a car at an exact spot on the road, facing an exact heading, with its brake lamps in a
   * known state. `stage()` snaps to the nearest lane, which is right for a crowd but wrong for a
   * frame: a shot needs a car where the shot says, not where the lane graph's nearest link is.
   */
  stageAt(index, { x, z, heading, speed = 0, brake = 0 }) {
    const car = this.cars[index];
    if (!car) return null;
    car.link = car.link ?? null;
    car.x = x;
    car.z = z;
    car.prevX = x;
    car.prevZ = z;
    car.heading = heading;
    car.prevHeading = heading;
    car.speed = speed;
    car.limit = Math.max(car.limit, speed);
    car.brake = brake;
    car.brakeFade = brake ? 1 : 0;
    car.staged = true;
    car.driven = false;
    car.occupied = false;
    car.turnFrom = null;
    car.turnT = 1;
    car.bumpVx = 0;
    car.bumpVz = 0;
    car.headFade = 1;
    return car;
  }

  /**
   * Put the first `count` free cars on a line of spots, brake lamps in a known state, and report
   * what was placed. The shot rig calls this so every frame has the same explicit cast.
   */
  stageCast(spots) {
    const placed = [];
    let cursor = 0;
    for (const spot of spots) {
      // Skip cars already driven or already cast by an earlier call.
      while (cursor < this.cars.length && (this.cars[cursor].driven || this.cars[cursor].castAt)) cursor += 1;
      if (cursor >= this.cars.length) break;
      const car = this.stageAt(cursor, spot);
      car.castAt = true;
      cursor += 1;
      if (car) placed.push(car);
    }
    return placed;
  }

  /** Put one car on each approach to a point, for a frame that needs a full junction. */
  stageJunction(x, z, count = 8, radius = 90) {
    const placed = [];
    for (let attempt = 0; attempt < count * 6 && placed.length < count; attempt += 1) {
      const angle = (attempt / (count * 6)) * Math.PI * 2;
      const reach = radius * 0.35 + ((attempt * 37) % 100) / 100 * radius * 0.6;
      const px = x + Math.cos(angle) * reach;
      const pz = z + Math.sin(angle) * reach;
      const car = this.stage(px, pz, { radius: 18, speed: 6 + ((attempt * 13) % 9) });
      if (car && !placed.includes(car)) placed.push(car);
    }
    return placed;
  }

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
      car.nextLink = null;
      car.turnT = 1;
      car.speed = 0;
      car.heading = this.lanes.heading(nearest.link);
      car.prevHeading = car.heading;
    }
  }

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
      // Brake lights stay lit for a beat after the pedal is released, so a frame caught at the
      // lights always shows red rather than a half-faded lamp.
      car.brakeFade = car.brake > 0.05 ? 1 : Math.max(0, car.brakeFade - dt * 3.2);
    }
  }

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

    const leader = this.leaderOf(car);
    if (leader) {
      const gap = leader.gap;
      const safety = 5.4 + car.speed * 0.62;
      if (gap < safety) target = Math.min(target, leader.speed * 0.9 + Math.max(0, gap - 3.4) * 1.4);
      if (gap < 2.9) target = 0;
      if (gap < 8 && leader.speed < 1.2) car.patience += dt;
      else car.patience = Math.max(0, car.patience - dt * 2);
    } else {
      car.patience = Math.max(0, car.patience - dt * 2);
    }

    const node = this.lanes.nodes[link.b];
    if (node.light && remaining < 26) {
      const state = this.lanes.lightFor(node, link.axis, this.time);
      if (state !== 'green') {
        stopForLight = true;
        target = Math.min(target, Math.max(0, (remaining - 6) * 0.9));
        if (remaining < 6.5) target = 0;
      }
    }

    if (player && !player.hidden) {
      const px = player.position.x - lane.x;
      const pz = player.position.z - lane.z;
      const ahead = px * link.dx + pz * link.dz;
      const lateral = Math.abs(px * -link.dz + pz * link.dx);
      if (ahead > 0 && ahead < 12 && lateral < 3.0) {
        target = Math.min(target, Math.max(0, (ahead - 3.2) * 1.1));
      }
    }

    if (police && police.roadblockNear && police.roadblockNear(lane.x, lane.z)) target = Math.min(target, 2.5);

    if (car.blocked > 0) {
      car.blocked -= dt;
      target = 0;
    }

    const emergency = target < 0.6 || target < car.speed - 3.4;
    car.brake = emergency ? 1 : target < car.speed - 0.4 ? 0.55 : 0;
    const rate = target < car.speed ? 5.2 : 2.4;
    car.speed = damp(car.speed, target, rate, dt);
    if (car.speed < 0.05 && target < 0.05) car.speed = 0;

    car.s += car.speed * dt;

    if (!car.nextLink || car.nextLink === car.link) car.nextLink = this.chooseNext(car);

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
    const heading = this.lanes.heading(car.link);
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
      if (other.link === car.link && other.s > car.s) gap = other.s - car.s;
      else if (other.link === car.nextLink) gap = car.link.len - car.s + other.s;
      if (gap < (best ? best.gap : 34)) best = { gap, speed: other.speed, car: other };
    }
    return best;
  }

  chooseNext(car) {
    return this.lanes.pickNext(car.link, this.planRng(car.link.id, car.index));
  }

  // ------------------------------------------------------------------ rendering

  apply(alpha) {
    const dummy = this.dummy;
    const local = this.local;
    const matrix = this.matrix;

    for (const car of this.cars) {
      const shape = this.meshes[car.shape];
      if (!shape) continue;
      const spec = shape.spec;
      const x = lerp(car.prevX, car.x, alpha);
      const z = lerp(car.prevZ, car.z, alpha);
      const delta = wrapAngle(car.heading - car.prevHeading);
      const heading = car.prevHeading + delta * alpha;
      const y = this.plan.groundHeight(x, z) + 0.02;

      // Body roll from steering and a small pitch from braking, so a moving car never looks rigid.
      const roll = clamp(car.steer * Math.min(1, car.speed / 12) * 0.14, -0.07, 0.07);
      const pitch = clamp(-car.brake * Math.min(1, car.speed / 14) * 0.04, -0.05, 0.03);

      dummy.position.set(x, y, z);
      dummy.rotation.set(pitch, heading, roll);
      dummy.scale.setScalar(car.scale);
      dummy.updateMatrix();

      const index = car.shapeIndex;
      shape.paint.setMatrixAt(index, dummy.matrix);
      shape.chrome.setMatrixAt(index, dummy.matrix);
      shape.dark.setMatrixAt(index, dummy.matrix);
      shape.glass.setMatrixAt(index, dummy.matrix);
      shape.head.setMatrixAt(index, dummy.matrix);
      shape.tail.setMatrixAt(index, dummy.matrix);

      // Tail lamps: bright red while the brake is on, a dim running light otherwise.
      const braking = car.brakeFade > 0.02 || car.driven;
      const tail = braking ? 1 : 0.24;
      this.tint.setRGB(tail, tail * 0.12, tail * 0.06);
      shape.tail.setColorAt(index, this.tint);
      // Headlights are on at all hours, and they read as on: a lamp that is merely brighter than
      // the paint is indistinguishable from paint at 480 px.
      const headLevel = this.night ? 1 : 0.95;
      shape.head.setColorAt(index, this.tint.setRGB(headLevel, headLevel * 0.94, headLevel * 0.8));
      if (shape.tail.instanceColor) shape.tail.instanceColor.needsUpdate = true;
      if (shape.head.instanceColor) shape.head.instanceColor.needsUpdate = true;

      // Wheels: spin about their own axle, front pair steers.
      for (const axle of [-1, 1]) {
        for (const side of [-1, 1]) {
          const slot = index * 4 + (axle > 0 ? 2 : 0) + (side > 0 ? 1 : 0);
          local.position.set(side * spec.width * 0.42, spec.wheelRadius, axle * spec.wheelBase);
          local.rotation.set(car.wheelSpin, axle < 0 ? car.steer * 0.85 : 0, 0, 'YXZ');
          local.scale.setScalar(car.scale);
          local.updateMatrix();
          matrix.multiplyMatrices(dummy.matrix, local.matrix);
          shape.tyre.setMatrixAt(slot, matrix);
          shape.rim.setMatrixAt(slot, matrix);
        }
      }

      // Lamp halos: one pair of head sprites ahead, one red bloom behind.
      const glow = this.glows[car.index];
      if (glow) {
        const front = -spec.stations[0].z + 0.1;
        const fx = -Math.sin(heading);
        const fz = -Math.cos(heading);
        glow.head.position.set(x + fx * front, y + spec.lamps.headY, z + fz * front);
        glow.head.material.opacity = this.night ? 0.72 : 0.34;
        glow.head.scale.set(this.night ? 3.6 : 3.0, this.night ? 2.2 : 1.8, 1);
        glow.tail.position.set(x - fx * front, y + spec.lamps.tailY, z - fz * front);
        glow.tail.material.opacity = this.night ? 0.55 * (0.3 + tail) : 0.1 + 0.5 * (tail - 0.24);
        glow.tail.scale.set(this.night ? 2.4 : 1.7, this.night ? 1.4 : 1.0, 1);
      }

      // Contact shadow: a soft ellipse turned to the car's heading and stretched along it, plus a
      // tighter, darker core so the four tyre patches are the darkest part of it. Both follow the
      // body's own pose, so a car that is half-way through a turn drags its shadow round with it.
      // The quad rides 7 cm clear of the ground: the asphalt sheet is drawn at 2-3 cm, so a
      // shadow written *at* the ground height would be under the road and never drawn.
      if (this.blobs) {
        // The ellipse is deliberately wider than the body (a car is 1.9 m across, its ambient
        // occlusion pool is ~4.4 m) so a rim of shade shows on the sunlit asphalt all round the
        // tyres instead of being hidden under the sills, where nothing can see it.
        const across = car.shape === 'wagon' ? 4.6 : 4.4;
        const pair = this.blobSlots[car.index];
        this.blobs.write(pair[0], x, y + 0.07, z, across, 1, heading, 1.34);
        this.blobs.write(pair[1], x, y + 0.075, z, across * 0.6, 1, heading, 1.24);
      }
    }

    for (const shape of Object.values(this.meshes)) {
      shape.paint.instanceMatrix.needsUpdate = true;
      shape.chrome.instanceMatrix.needsUpdate = true;
      shape.dark.instanceMatrix.needsUpdate = true;
      shape.glass.instanceMatrix.needsUpdate = true;
      shape.head.instanceMatrix.needsUpdate = true;
      shape.tail.instanceMatrix.needsUpdate = true;
      shape.tyre.instanceMatrix.needsUpdate = true;
      shape.rim.instanceMatrix.needsUpdate = true;
    }
    if (this.blobs) this.blobs.commit();
  }

  setNight(night) {
    this.night = night;
  }

  setSky(skyInfo) {
    setGlassSky(skyInfo);
  }
}
