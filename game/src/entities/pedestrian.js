// Pedestrians. Eighty people generated from the seed walk the kerb rings, cross at the painted
// crossings, idle in pairs outside the market and sit on benches. Each silhouette variant owns
// its own instanced mesh per body part (torso, head, hair, hat, bag, two upper arms, two
// forearms, two thighs, two shins), all written from a joint chain every frame: hips bob, torsos
// lean into the stride, shoulders counter-rotate, knees and elbows bend. Identity — height,
// girth, jacket colour, skin, trousers, hair, hat — is picked so no two people within 20 m share
// the same silhouette and palette together.

import { ART } from '../core/config.js';
import { pedKit, PED_VARIANTS, PED_WAIST, PED_TORSO_TOP, PED_SHOULDER, THIGH_LEN, SHIN_LEN } from './pedkit.js';

const COUNT = 80;
const WALK = 0;
const SIT = 1;
const LEAN = 2;

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

/** Market stall positions on the boulevard: two shoppers stand at each of these. */
export const MARKET_STALLS = [
  { x: 15.6, z: 128.0, rot: 0.0 },
  { x: -15.6, z: 152.0, rot: Math.PI },
];

const STALL_SPOTS = [
  { x: 16.9, z: 129.4, heading: -Math.PI / 2 },
  { x: 17.2, z: 130.7, heading: -Math.PI / 2 + 0.2 },
  { x: -16.8, z: 151.0, heading: Math.PI / 2 },
  { x: -17.1, z: 153.2, heading: Math.PI / 2 - 0.16 },
];

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
    this.flash = 0;
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    this.build();
    scene.add(this.group);
    this.apply(1);
  }

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
    const rng = this.plan.rng.fork('pedestrians-v3');
    const ring = this.plan.half - 1.15;
    const loopBlocks = this.plan.blocks.filter((block) => !block.park || block.plaza);

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

    for (const crossing of this.lanes.crossings) {
      const points = [crossing.from, crossing.to];
      this.paths.push({ points, ...perimeter(points), crossing, short: true });
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

      // Deterministic identity, rerolled until it differs from everything within 20 m.
      let variant = rng.pick(PED_VARIANTS);
      let shirt = rng.pick(ART.shirt);
      let trousers = rng.pick(ART.trousers);
      let signature = `${variant}:${shirt}:${trousers}`;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const others = this.people.filter((other) => Math.hypot(other.x - point.x, other.z - point.z) < 20);
        if (!others.some((other) => other.signature === signature)) break;
        variant = rng.pick(PED_VARIANTS);
        shirt = rng.pick(ART.shirt);
        trousers = rng.pick(ART.trousers);
        signature = `${variant}:${shirt}:${trousers}`;
      }

      const person = {
        kind,
        variant,
        signature,
        path,
        distance,
        speed: kind === WALK ? rng.range(0.92, 1.62) : 0,
        direction: rng.chance(0.5) ? 1 : -1,
        phase: rng.range(0, Math.PI * 2),
        stride: rng.range(0.84, 1.12),
        x: point.x,
        z: point.z,
        prevX: point.x,
        prevZ: point.z,
        heading,
        prevHeading: heading,
        scale: rng.range(0.86, 1.1),
        girth: rng.range(0.9, 1.16),
        hat: rng.chance(0.34),
        hatKind: rng.chance(0.45) ? 'cap' : 'brim',
        hatColour: rng.pick(ART.hats),
        bag: kind === WALK ? rng.chance(0.3) : false,
        bagSide: rng.chance(0.5) ? 1 : -1,
        shirt,
        skin: rng.pick(ART.skin),
        trousers,
        hair: rng.pick(ART.hair),
        hairHidden: rng.chance(0.16),
        fleeX: 0,
        fleeZ: 0,
        fleeTime: 0,
        idle: kind === WALK ? rng.range(0.3, 1.4) : 0,
        pairWith: null,
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
        person.heading += Math.PI / 2;
        person.prevHeading = person.heading;
      }
      this.people.push(person);
    }

    // Market pairs: two shoppers at each stall, facing the goods, one mid-stride.
    for (let i = 0; i < STALL_SPOTS.length; i += 1) {
      const spot = STALL_SPOTS[i];
      const person = this.people[i];
      person.kind = WALK;
      person.path = null;
      person.x = spot.x;
      person.z = spot.z;
      person.prevX = spot.x;
      person.prevZ = spot.z;
      person.heading = spot.heading;
      person.prevHeading = spot.heading;
      person.idle = 0;
      person.market = spot;
      person.speed = 0;
      person.phase = i % 2 === 0 ? 2.35 : 0.7;
      person.bag = true;
      person.signature = `${person.variant}:${person.shirt}:${person.trousers}`;
    }
    // A friend for the first shopper: same stall, facing the same way, a head shorter.
    this.people[0].pairWith = this.people[1];
    this.people[2].pairWith = this.people[3];

    // One person deliberately mid-crossing in front of the cover camera.
    const crossing = this.lanes.crossings.reduce(
      (best, next) => {
        const d = Math.hypot(next.from.x - 26, next.from.z - 122);
        return !best || d < best.d ? { crossing: next, d } : best;
      },
      null,
    );
    if (crossing) {
      const path = this.paths.find((p) => p.crossing === crossing.crossing);
      const walker = this.people[5];
      walker.path = path;
      walker.kind = WALK;
      walker.distance = path.total * 0.42;
      walker.direction = 1;
      walker.speed = 1.42;
      walker.idle = 0;
      const at = samplePath(path, walker.distance);
      walker.x = at.x;
      walker.z = at.z;
      walker.prevX = at.x;
      walker.prevZ = at.z;
      walker.heading = Math.atan2(-at.dx, -at.dz);
      walker.prevHeading = walker.heading;
    }

    this.buildMeshes();
  }

  buildMeshes() {
    const shirtMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
    const skinMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
    const hairMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04 });
    const trousersMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });

    this.parts = {};
    const add = (variant, kit) => {
      const count = COUNT;
      const make = (geometry, material, slots = count) => {
        const mesh = new THREE.InstancedMesh(geometry, material, slots);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.group.add(mesh);
        return mesh;
      };
      this.parts[variant] = {
        torso: make(kit.torso, shirtMaterial),
        head: make(kit.head, skinMaterial),
        hair: make(kit.hair, hairMaterial),
        hat: make(kit.hat, shirtMaterial),
        cap: make(kit.cap, shirtMaterial),
        bag: make(kit.bag, shirtMaterial),
        upperArm: make(kit.upperArm, shirtMaterial, count * 2),
        foreArm: make(kit.foreArm, skinMaterial, count * 2),
        thigh: make(kit.thigh, trousersMaterial, count * 2),
        shin: make(kit.shin, trousersMaterial, count * 2),
      };
    };
    for (const variant of PED_VARIANTS) add(variant, pedKit(variant));

    // Who draws into which slot, per variant, so `count` stays exact and no stale instance survives.
    this.slots = {};
    for (const variant of PED_VARIANTS) this.slots[variant] = { people: [], arms: 0, legs: 0 };
    const colour = new THREE.Color();
    this.people.forEach((person) => {
      const kit = this.parts[person.variant];
      const slot = this.slots[person.variant];
      const index = slot.people.length;
      slot.people.push(person);
      person.slot = index;
      person.armSlot = slot.arms;
      person.legSlot = slot.legs;
      slot.arms += 2;
      slot.legs += 2;

      colour.set(person.shirt);
      kit.torso.setColorAt(index, colour);
      kit.hat.setColorAt(index, colour.set(person.hatColour ?? 0xffffff));
      kit.cap.setColorAt(index, colour.set(person.hatColour ?? 0xffffff));
      kit.bag.setColorAt(index, colour.set(person.shirt).multiplyScalar(0.86));
      kit.upperArm.setColorAt(person.armSlot, colour.set(person.shirt));
      kit.upperArm.setColorAt(person.armSlot + 1, colour.set(person.shirt));
      kit.foreArm.setColorAt(person.armSlot, colour.set(person.skin));
      kit.foreArm.setColorAt(person.armSlot + 1, colour.set(person.skin));
      kit.head.setColorAt(index, colour.set(person.skin));
      kit.hair.setColorAt(index, colour.set(person.hairHidden ? person.hatColour : person.hair));
      kit.thigh.setColorAt(person.legSlot, colour.set(person.trousers));
      kit.thigh.setColorAt(person.legSlot + 1, colour.set(person.trousers));
      kit.shin.setColorAt(person.legSlot, colour.set(person.trousers));
      kit.shin.setColorAt(person.legSlot + 1, colour.set(person.trousers));
      person.blob = this.blobs ? this.blobs.claim(person.x, -400, person.z, 0.0001) : -1;
    });
    for (const variant of PED_VARIANTS) {
      const kit = this.parts[variant];
      const slot = this.slots[variant];
      kit.torso.count = slot.people.length;
      kit.head.count = slot.people.length;
      kit.hair.count = slot.people.length;
      kit.hat.count = slot.people.length;
      kit.cap.count = slot.people.length;
      kit.bag.count = slot.people.length;
      kit.upperArm.count = slot.arms;
      kit.foreArm.count = slot.arms;
      kit.thigh.count = slot.legs;
      kit.shin.count = slot.legs;
      for (const mesh of Object.values(kit)) {
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.dummy = new THREE.Object3D();
    this.nodes = Array.from({ length: 14 }, () => new THREE.Object3D());
  }

  findBench(x, z) {
    let best = null;
    for (const bench of this.plan.benches) {
      const distance = Math.hypot(bench.x - x, bench.z - z);
      if (distance < 34 && (!best || distance < best.distance)) best = { ...bench, distance };
    }
    return best;
  }

  personHit(person, damage) {
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

  contain(person) {
    if (!this.collision) return;
    const body = { x: person.x, z: person.z };
    const hit = this.collision.resolve(body, 0.34, { maxStep: 0.4 });
    if (hit) {
      person.x = body.x;
      person.z = body.z;
    }
  }

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
    this.flash = Math.max(0, this.flash - dt);

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
        person.phase += 15 * dt;
        continue;
      }

      if (person.kind !== WALK) {
        person.phase += dt * 0.8;
        continue;
      }

      if (person.market) {
        // Shoppers shift their weight and half-turn to the stall; they never drift off the spot.
        person.phase += dt * 1.15;
        const sway = Math.sin(this.time * 0.9 + person.phase) * 0.055;
        person.x = person.market.x + sway;
        person.z = person.market.z + Math.cos(this.time * 0.7 + person.phase) * 0.035;
        continue;
      }

      if (person.idle > 0) {
        person.idle -= dt;
        person.phase += dt * 1.3;
        continue;
      }

      person.distance += person.speed * person.direction * dt;
      const point = samplePath(person.path, person.distance);
      person.x = point.x;
      person.z = point.z;
      if (person.direction > 0) person.heading = Math.atan2(-point.dx, -point.dz);
      else person.heading = Math.atan2(point.dx, point.dz);

      if (person.path.crossing) {
        const wrapped = ((person.distance % person.path.total) + person.path.total) % person.path.total;
        if (person.direction < 0 && wrapped < 0.4) person.direction = 1;
        if (person.direction > 0 && wrapped > person.path.total - 0.4) person.direction = -1;
      }
      if (person.path.total < 1.2 && person.kind === WALK) person.direction *= -1;

      person.phase += (person.speed * dt * 5.2) + dt * 0.4;
      this.contain(person);
    }
  }

  // ------------------------------------------------------------------ posing

  /**
   * Write every person into their slots. The rig is a joint chain in body space:
   *   hips (bob + lean) -> torso (counter-rotate) -> shoulders -> arms (elbow bend)
   *   hips -> thighs (swing) -> shins (knee flex, so the heel lifts)
   */
  apply(alpha) {
    const scratch = this.dummy;
    const nodes = this.nodes;

    for (const person of this.people) {
      const x = person.prevX + (person.x - person.prevX) * alpha;
      const z = person.prevZ + (person.z - person.prevZ) * alpha;
      const baseY = this.plan.groundHeight(x, z);
      let heading = person.heading;
      const delta = ((heading - person.prevHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      heading = person.prevHeading + delta * alpha;

      const running = person.fleeTime > 0;
      const moving = person.kind === WALK && !person.market && person.speed > 0.01;
      const pace = person.speed * 3.4 * person.stride;
      const swing = moving ? Math.sin(person.phase) : Math.sin(person.phase * 0.5) * 0.16;
      const swingLag = moving ? Math.sin(person.phase + 1.1) : Math.sin(person.phase * 0.5 + 1.1) * 0.16;

      // Hips: a two-per-stride bob, plus a lean into the direction of travel.
      const bob = moving ? Math.abs(Math.sin(person.phase)) * 0.035 * Math.min(1, pace) : 0;
      const lean = moving ? 0.055 + Math.sin(person.phase * 2) * 0.012 : running ? 0.13 : 0;
      const sway = moving ? Math.cos(person.phase) * 0.022 : 0;

      const seated = person.kind === SIT;
      const leaning = person.kind === LEAN;
      const scale = person.scale;

      scratch.position.set(x, baseY + (seated ? 0 : bob) + (person.alive ? 0 : person.fall * 0.09), z);
      let tilt = 0;
      if (!person.alive) tilt = person.fallSide * person.fall * Math.PI * 0.47;
      scratch.rotation.set(0, heading, tilt);
      scratch.scale.set(scale, scale, scale);
      scratch.updateMatrix();
      scratch.matrixWorld.copy(scratch.matrix);

      // Hips pivot: absolute body height. The torso geometry is rebased so it starts at its own
      // waist, so the pivot and the waist must be the same number.
      const waist = PED_WAIST[person.variant] ?? 1.02;
      const hipY = seated ? waist - 0.5 : waist;
      // Where the neck and the shoulders sit above the waist, per silhouette.
      const waistTop = (PED_TORSO_TOP[person.variant] ?? 1.52) - waist;
      const shoulderY = (PED_SHOULDER[person.variant] ?? 1.46) - waist;
      const hipShift = seated ? 0.16 : 0;
      this.setNode(nodes[0], scratch, sway + hipShift * Math.sin(heading), hipY, 0, 0, 0, 0);
      nodes[0].matrixWorld.multiplyMatrices(scratch.matrix, nodes[0].matrix);

      // Torso hangs off the hips, leaning with the stride and counter-rotating the shoulders.
      const torsoRoll = leaning ? (heading > 0 ? -0.2 : 0.2) : 0;
      this.setNode(
        nodes[1],
        nodes[0],
        0,
        0,
        0,
        seated ? 0.06 : -lean,
        moving ? Math.sin(person.phase) * 0.09 : 0,
        torsoRoll,
      );
      const torsoMesh = this.parts[person.variant].torso;
      const girth = person.girth;
      nodes[1].scale.set(girth, 1, girth);
      nodes[1].updateMatrix();
      nodes[1].matrixWorld.multiplyMatrices(nodes[0].matrixWorld, nodes[1].matrix);
      torsoMesh.setMatrixAt(person.slot, nodes[1].matrixWorld);

      // Neck and head hang off the top of the torso, not a fixed number, so a tall jacket and a
      // short one both put the head on the shoulders.
      this.setNode(nodes[2], nodes[1], 0, waistTop, 0.01, lean * 0.75, 0, -torsoRoll * 0.5);
      if (leaning) nodes[2].position.x += 0.04;
      nodes[2].updateMatrix();
      nodes[2].matrixWorld.multiplyMatrices(nodes[1].matrixWorld, nodes[2].matrix);
      this.parts[person.variant].head.setMatrixAt(person.slot, nodes[2].matrixWorld);

      // Hair, hat and bag share the head node; the unused ones collapse into the slot at zero scale.
      const kit = this.parts[person.variant];
      if (!person.hairHidden) {
        this.setNode(nodes[3], nodes[2], 0, 0.014, -0.008, 0, 0, 0);
        kit.hair.setMatrixAt(person.slot, nodes[3].matrixWorld);
      } else {
        this.collapse(kit.hair, person.slot, nodes[2]);
      }
      if (person.hat) {
        const target = person.hatKind === 'cap' ? kit.cap : kit.hat;
        const other = person.hatKind === 'cap' ? kit.hat : kit.cap;
        this.setNode(nodes[3], nodes[2], 0, 0.035, 0, 0, Math.sin(person.phase) * 0.06, 0);
        target.setMatrixAt(person.slot, nodes[3].matrixWorld);
        this.collapse(other, person.slot, nodes[2]);
      } else {
        this.collapse(kit.hat, person.slot, nodes[2]);
        this.collapse(kit.cap, person.slot, nodes[2]);
      }
      if (person.bag) {
        const side = person.bagSide ?? 1;
        this.setNode(nodes[3], nodes[1], side * 0.19 * girth, 0.16, -0.02, 0, 0, side * 0.12);
        kit.bag.setMatrixAt(person.slot, nodes[3].matrixWorld);
      } else {
        this.collapse(kit.bag, person.slot, nodes[2]);
      }

      // Arms: shoulder swing opposite the leg on the same side, elbow bends with the reach.
      const armSwing = running ? swing * 0.95 : moving ? swing * 0.52 : 0;
      const armLag = running ? swingLag * 0.95 : moving ? swingLag * 0.52 : 0;
      for (const side of [-1, 1]) {
        const shoulderSign = side > 0 ? 1 : -1;
        const swingAngle = side < 0 ? armSwing : -armSwing;
        this.setNode(
          nodes[4],
          nodes[1],
          side * 0.165 * girth,
          shoulderY,
          0,
          seated ? -0.55 : swingAngle,
          0,
          leaning ? -0.34 : side * 0.14,
        );
        nodes[4].updateMatrix();
        nodes[4].matrixWorld.multiplyMatrices(nodes[1].matrixWorld, nodes[4].matrix);
        kit.upperArm.setMatrixAt(person.armSlot + (side > 0 ? 1 : 0), nodes[4].matrixWorld);

        // The forearm continues the upper arm and bends at the elbow, never at the wrist.
        const bend = seated ? -0.55 : 0.24 + Math.max(0, swingAngle * shoulderSign) * 0.7;
        this.setNode(nodes[5], nodes[4], 0, -0.285, 0, bend, 0, 0);
        nodes[5].updateMatrix();
        nodes[5].matrixWorld.multiplyMatrices(nodes[4].matrixWorld, nodes[5].matrix);
        kit.foreArm.setMatrixAt(person.armSlot + (side > 0 ? 1 : 0), nodes[5].matrixWorld);
      }

      // Legs: thigh swings from the hip, shin bends back so the swing leg's heel lifts and the
      // planted leg is straight. Seated people fold at hip and knee.
      for (const side of [-1, 1]) {
        const legSign = side > 0 ? 1 : -1;
        const strideAngle = (side < 0 ? swing : -swing) * 0.62;
        const legSlot = person.legSlot + (side > 0 ? 1 : 0);
        if (seated) {
          this.setNode(nodes[6], nodes[0], side * 0.085, -0.02, 0.09, -1.35, 0, side * 0.1);
          nodes[6].updateMatrix();
          nodes[6].matrixWorld.multiplyMatrices(nodes[0].matrixWorld, nodes[6].matrix);
          kit.thigh.setMatrixAt(legSlot, nodes[6].matrixWorld);
          this.setNode(nodes[7], nodes[6], 0, -THIGH_LEN, 0, 1.25, 0, 0);
          nodes[7].updateMatrix();
          nodes[7].matrixWorld.multiplyMatrices(nodes[6].matrixWorld, nodes[7].matrix);
          kit.shin.setMatrixAt(legSlot, nodes[7].matrixWorld);
          continue;
        }
        // The thigh node sits at the hip in the hips' local frame.
        this.setNode(nodes[6], nodes[0], side * 0.082, 0, 0, strideAngle, 0, legSign * 0.03);
        kit.thigh.setMatrixAt(legSlot, nodes[6].matrixWorld);

        // Knee flex: the rear leg (negative swing on this side) folds most, plus a small idle bend.
        const flex = Math.max(0, -strideAngle) * 1.55 + (moving ? 0.06 : 0.03) + (leaning ? 0.12 : 0);
        this.setNode(nodes[7], nodes[6], 0, -THIGH_LEN, 0, flex, 0, 0);
        nodes[7].updateMatrix();
        nodes[7].matrixWorld.multiplyMatrices(nodes[6].matrixWorld, nodes[7].matrix);
        kit.shin.setMatrixAt(legSlot, nodes[7].matrixWorld);
      }

      if (this.blobs) {
        this.blobs.write(person.blob, x, baseY + 0.02, z, (running ? 1.5 : 1.28) * scale * girth, 0.3);
      }
    }

    for (const variant of PED_VARIANTS) {
      for (const mesh of Object.values(this.parts[variant])) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.blobs) this.blobs.commit();
  }

  collapse(mesh, index, parent) {
    const node = this.nodes[13];
    node.position.set(0, -400, 0);
    node.rotation.set(0, 0, 0);
    node.scale.set(0.0001, 0.0001, 0.0001);
    node.updateMatrix();
    node.matrixWorld.multiplyMatrices(parent.matrixWorld, node.matrix);
    mesh.setMatrixAt(index, node.matrixWorld);
  }

  setNode(node, parent, x, y, z, rx = 0, ry = 0, rz = 0) {
    node.position.set(x, y, z);
    node.rotation.set(rx, ry, rz);
    node.scale.set(1, 1, 1);
    node.updateMatrix();
    node.matrixWorld.multiplyMatrices(parent.matrixWorld ?? parent.matrix, node.matrix);
  }
}
