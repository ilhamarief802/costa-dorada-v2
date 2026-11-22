// Eight story missions in a chain. Each mission has an authored card, a world beacon the player
// walks or drives into, a reward, a fail state (you die, a timer runs out, or a target is lost)
// and a restart. Gang members are spawned as simple shooters for the two fight missions.

import { MISSIONS, WANTED } from '../core/config.js';
import { clamp, damp, dampAngle } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

const GANG_LIMIT = 6;
const CORPSES = 10;
const WANTED_THRESHOLDS = WANTED.thresholds;

function gangGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, color) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    parts.push({ geometry, color });
  };
  add(0.46, 0.6, 0.28, 0, 1.2, 0, 0x3c3a2e);
  add(0.16, 0.86, 0.2, -0.12, 0.54, 0, 0x22241f);
  add(0.16, 0.86, 0.2, 0.12, 0.54, 0, 0x22241f);
  add(0.16, 0.5, 0.16, -0.3, 1.24, 0, 0x4a4636);
  add(0.16, 0.5, 0.16, 0.3, 1.24, 0, 0x4a4636);
  add(0.24, 0.24, 0.24, 0, 1.62, 0, 0xc9a06a);
  return mergeGeometries(parts);
}

export default class Missions {
  constructor({ scene, plan, assets, police, pedestrians, combat, events }) {
    this.plan = plan;
    this.assets = assets;
    this.police = police;
    this.pedestrians = pedestrians;
    this.combat = combat;
    this.events = events;
    this.index = 0;
    this.stage = 0;
    this.phase = 'idle';
    this.timer = 0;
    this.fails = 0;
    this.done = new Array(MISSIONS.length).fill(false);
    this.enemies = [];
    this.corpses = [];
    this.group = new THREE.Group();
    this.group.name = 'missions';
    scene.add(this.group);
    this.buildBeacon();
    this.transition = 0;
    this.stateAgain = false;
    this.playerActor = null;
  }

  buildBeacon() {
    this.beacon = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.4, 0.11, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc35c, transparent: true, opacity: 0.8, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.24;
    this.beacon.add(ring);
    this.ring = ring;

    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.06, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.35, toneMapped: false }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.24;
    this.beacon.add(inner);
    this.inner = inner;

    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.7, 40, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc35c,
        transparent: true,
        opacity: 0.075,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    column.position.y = 20;
    this.beacon.add(column);

    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.75),
      new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false }),
    );
    diamond.position.y = 3.3;
    this.beacon.add(diamond);
    this.diamond = diamond;

    this.group.add(this.beacon);
  }

  get current() {
    return MISSIONS[this.index] ?? null;
  }

  get objective() {
    const mission = this.current;
    if (!mission) return null;
    return mission.objective;
  }

  card() {
    const mission = this.current;
    if (!mission) {
      return {
        eyebrow: 'COSTA DORADA',
        title: 'You own the coast',
        detail: 'Eight jobs run, the tower is yours. Free roam, take fares, run the boulevard.',
        status: 'COMPLETE',
      };
    }
    const distance = Math.round(this.distanceToObjective());
    let status = mission.kind === 'shootout' ? `${this.remainingEnemies()} LEFT` : `${distance} M`;
    if (this.phase === 'failed') status = 'FAILED — PRESS R';
    if (this.phase === 'done') status = 'COMPLETE';
    return {
      eyebrow: mission.eyebrow,
      title: mission.title,
      detail: mission.detail,
      status,
      index: this.index + 1,
      total: MISSIONS.length,
    };
  }

  distanceToObjective(x = this.playerActor?.position.x, z = this.playerActor?.position.z) {
    const mission = this.current;
    if (!mission || x === undefined) return 0;
    return Math.hypot(x - mission.objective.x, z - mission.objective.z);
  }

  start(index = this.index) {
    this.index = clamp(index, 0, MISSIONS.length - 1);
    this.stage = 0;
    this.phase = 'active';
    this.timer = 0;
    this.escapeArmed = false;
    const mission = this.current;
    if (!mission) return;
    this.beacon.position.set(mission.objective.x, this.plan.groundHeight(mission.objective.x, mission.objective.z), mission.objective.z);
    this.beacon.visible = true;
    this.clearEnemies();
    if (mission.kind === 'shootout') this.spawnGang(mission.objective, 6);
    if (mission.kind === 'finale') {
      this.spawnGang({ x: mission.objective.x - 10, z: mission.objective.z + 8 }, 5);
      this.spawnGang({ x: mission.objective.x + 11, z: mission.objective.z + 6 }, 3);
    }
    // "Lose the cruisers" only counts once the precinct is actually on you.
    if (mission.kind === 'escape' && this.police && this.police.stars < 3) {
      this.police.heat = Math.max(this.police.heat, WANTED_THRESHOLDS[3] + 0.6);
      this.police.stars = 3;
    }
    if (this.events) this.events.emit('mission:start', { mission, index: this.index });
  }

  restart() {
    this.fails += 1;
    this.phase = 'active';
    this.timer = 0;
    this.stage = 0;
    const mission = this.current;
    this.clearEnemies();
    if (mission && mission.kind === 'shootout') this.spawnGang(mission.objective, 6);
    if (mission && mission.kind === 'finale') {
      this.spawnGang({ x: mission.objective.x - 10, z: mission.objective.z + 8 }, 5);
      this.spawnGang({ x: mission.objective.x + 11, z: mission.objective.z + 6 }, 3);
    }
    if (this.events) this.events.emit('mission:restart', { index: this.index });
  }

  fail(reason) {
    if (this.phase !== 'active') return;
    this.phase = 'failed';
    this.failReason = reason;
    if (this.events) this.events.emit('mission:fail', { reason, index: this.index });
  }

  complete() {
    const mission = this.current;
    if (!mission || this.phase !== 'active') return;
    this.phase = 'done';
    this.done[this.index] = true;
    this.clearEnemies();
    if (this.events) this.events.emit('mission:complete', { mission, index: this.index });
    this.advanceTimer = 2.6;
  }

  remainingEnemies() {
    return this.enemies.filter((enemy) => enemy.alive).length;
  }

  spawnGang(centre, count) {
    const rng = this.plan.rng.fork(`gang-${this.index}-${this.stage}`);
    for (let i = 0; i < Math.min(count, GANG_LIMIT); i += 1) {
      const angle = rng.range(0, Math.PI * 2);
      const radius = rng.range(3.4, 12);
      const x = centre.x + Math.cos(angle) * radius;
      const z = centre.z + Math.sin(angle) * radius;
      if (this.plan.isWater(x, z)) continue;
      this.enemies.push({
        x,
        z,
        prevX: x,
        prevZ: z,
        heading: angle + Math.PI,
        prevHeading: angle + Math.PI,
        health: 78,
        alive: true,
        hitHeight: 1.1,
        hitRadius: 0.64,
        fireCooldown: rng.range(0.7, 2.2),
        strafe: rng.chance(0.5) ? 1 : -1,
        phase: rng.range(0, 6.28),
        position: { x, z },
      });
    }
    this.buildEnemyMesh();
  }

  buildEnemyMesh() {
    if (!this.enemyMesh) {
      this.enemyMesh = new THREE.InstancedMesh(
        gangGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
        GANG_LIMIT * 2,
      );
      this.enemyMesh.castShadow = true;
      this.enemyMesh.frustumCulled = false;
      this.enemyMesh.count = 0;
      this.group.add(this.enemyMesh);
      // Bodies stay on the ground after a kill: one instanced mesh, laid flat and fading.
      this.corpseMesh = new THREE.InstancedMesh(
        gangGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }),
        CORPSES,
      );
      this.corpseMesh.frustumCulled = false;
      this.corpseMesh.count = 0;
      this.group.add(this.corpseMesh);
      this.dummy = new THREE.Object3D();
    }
    for (const enemy of this.enemies) {
      if (!enemy.onDamage) {
        enemy.hitPoint = () => ({ x: enemy.x, z: enemy.z });
        enemy.onDamage = (damage, payload) => this.onEnemyHit(enemy, damage, payload);
      }
      if (this.combat) this.combat.register(enemy);
    }
  }

  clearEnemies() {
    for (const enemy of this.enemies) {
      enemy.alive = false;
      if (this.combat) this.combat.unregister(enemy);
    }
    this.enemies.length = 0;
    if (this.enemyMesh) this.enemyMesh.count = 0;
  }

  setPlayer(actor) {
    this.playerActor = actor;
  }

  update(dt, player) {
    this.playerActor = player;
    if (this.beacon.visible) {
      this.diamond.rotation.y += dt * 1.7;
      this.diamond.position.y = 3.1 + Math.sin(this.time * 2.1) * 0.2;
      this.ring.rotation.z += dt * 0.5;
      this.inner.rotation.z -= dt * 0.8;
    }
    this.time = (this.time ?? 0) + dt;

    if (this.phase === 'done') {
      this.advanceTimer -= dt;
      if (this.advanceTimer <= 0) {
        if (this.index >= MISSIONS.length - 1) {
          this.phase = 'complete';
          this.beacon.visible = false;
        } else {
          this.start(this.index + 1);
        }
      }
      return;
    }
    if (this.phase !== 'active') return;

    const mission = this.current;
    if (!mission) return;
    const ox = mission.objective.x;
    const oz = mission.objective.z;
    const distance = Math.hypot(player.position.x - ox, player.position.z - oz);

    if (mission.kind === 'shootout' || mission.kind === 'finale') {
      this.updateEnemies(dt, player);
      if (this.remainingEnemies() === 0) {
        if (mission.kind === 'finale' && this.stage === 0) {
          this.stage = 1;
          this.phase = 'active';
          this.objectiveAlt = { x: 25, z: 143 };
          if (this.events) this.events.emit('mission:stage', { stage: 1 });
          return;
        }
        this.complete();
        return;
      }
      if (mission.kind === 'finale' && this.stage === 1) {
        if (distance < 8) this.complete();
        return;
      }
      return;
    }

    if (mission.kind === 'escape') {
      // It is only a clean escape when the stars had been raised and have since dropped to
      // zero; otherwise the mission would complete on its first frame in free roam.
      if (this.police && this.police.stars > 0) this.escapeArmed = true;
      if (this.escapeArmed && this.police && this.police.stars === 0) this.complete();
      return;
    }

    if (distance < (mission.kind === 'deliver' ? 6.5 : 5.5)) {
      this.complete();
    }
  }

  /** World-space objective point: the mission beacon, or an activity marker when one runs. */
  get waypoint() {
    const mission = this.current;
    if (!mission || !this.beacon.visible) return null;
    return { x: mission.objective.x, z: mission.objective.z };
  }

  updateEnemies(dt, player) {
    if (!this.enemyMesh) return;
    const dummy = this.dummy;
    let count = 0;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.prevX = enemy.x;
      enemy.prevZ = enemy.z;
      enemy.prevHeading = enemy.heading;
      const dx = player.position.x - enemy.x;
      const dz = player.position.z - enemy.z;
      const distance = Math.hypot(dx, dz) || 1;
      const targetHeading = Math.atan2(-dx / distance, -dz / distance);
      enemy.heading = dampAngle(enemy.heading, targetHeading, 4.4, dt);
      if (distance > 15) {
        enemy.x += (dx / distance) * dt * 2.6;
        enemy.z += (dz / distance) * dt * 2.6;
      } else if (distance < 9) {
        enemy.x -= (dx / distance) * dt * 1.4;
        enemy.z -= (dz / distance) * dt * 1.4;
      } else {
        enemy.x += Math.cos(enemy.heading) * enemy.strafe * dt * 1.1;
        enemy.z -= Math.sin(enemy.heading) * enemy.strafe * dt * 1.1;
      }
      enemy.phase += dt * 5;
      enemy.fireCooldown -= dt;
      if (enemy.fireCooldown <= 0 && distance < 40 && player.onDamage) {
        enemy.fireCooldown = 1.4 + (enemy.x * 0.37 % 1);
        const hit = ((enemy.z * 0.63) % 1) > 0.42;
        if (this.combat) {
          const muzzle = { x: enemy.x, y: 1.32, z: enemy.z };
          const point = { x: player.position.x, y: player.position.y + 1.0, z: player.position.z };
          this.combat.spawnTracer(muzzle, point);
          this.combat.spawnFlash(muzzle, { x: dx / distance, y: 0, z: dz / distance });
        }
        if (hit) player.onDamage(6, { source: 'gang', point: { x: enemy.x, y: 1.3, z: enemy.z } });
      }
      dummy.position.set(enemy.x, this.plan.groundHeight(enemy.x, enemy.z), enemy.z);
      dummy.rotation.set(0, enemy.heading, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.enemyMesh.setMatrixAt(count, dummy.matrix);
      count += 1;
    }
    this.enemyMesh.count = count;
    this.enemyMesh.instanceMatrix.needsUpdate = true;
    this.drawCorpses(dt);
  }

  /** Downed bodies lie where they fell, tipped over and slowly flattening into the pavement. */
  drawCorpses(dt) {
    if (!this.corpseMesh) return;
    let count = 0;
    for (const body of this.corpses) {
      body.age += dt;
      if (body.age > 90) continue;
      const y = this.plan.groundHeight(body.x, body.z);
      const fall = Math.min(1, body.age * 3.4);
      this.dummy.position.set(body.x, y + 0.06 * fall, body.z);
      this.dummy.rotation.set(0, body.heading, body.side * fall * Math.PI * 0.5);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.corpseMesh.setMatrixAt(count, this.dummy.matrix);
      count += 1;
    }
    this.corpseMesh.count = count;
    this.corpseMesh.instanceMatrix.needsUpdate = true;
  }

  onEnemyHit(enemy, damage, payload) {
    enemy.health -= damage;
    if (enemy.health <= 0 && enemy.alive) {
      enemy.alive = false;
      this.corpses.push({ x: enemy.x, z: enemy.z, heading: enemy.heading, age: 0, side: enemy.strafe > 0 ? 1 : -1 });
      if (this.corpses.length > CORPSES) this.corpses.shift();
      this.events.emit('mission:enemyDown', { enemy });
      if (this.combat) this.combat.unregister(enemy);
    }
    return enemy.alive;
  }

  serialize() {
    return { index: this.index, done: this.done.slice(), fails: this.fails };
  }

  restore(data) {
    if (!data) return;
    this.index = clamp(data.index ?? 0, 0, MISSIONS.length - 1);
    this.done = Array.isArray(data.done) ? data.done.slice(0, MISSIONS.length) : new Array(MISSIONS.length).fill(false);
    while (this.done.length < MISSIONS.length) this.done.push(false);
    this.fails = data.fails ?? 0;
    this.phase = this.index >= MISSIONS.length ? 'complete' : 'idle';
  }
}
