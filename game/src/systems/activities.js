// Side activities, each started from a marked circle in the world: a taxi fare with a meter, a
// street race against three AI cars on the lane graph, and a stunt board that pays out for a
// clean jump. A ticker line in the HUD reports the state while one is running.

import { ACTIVITIES } from '../core/config.js';
import { clamp } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

const RACE_RIVALS = 3;

function markerGeometry() {
  const parts = [];
  const torus = new THREE.TorusGeometry(2.6, 0.14, 8, 30);
  torus.rotateX(-Math.PI / 2);
  torus.translate(0, 0.22, 0);
  parts.push({ geometry: torus, color: 0xffffff });
  const arrow = new THREE.ConeGeometry(0.55, 1.5, 4);
  arrow.translate(0, 2.6, 0);
  parts.push({ geometry: arrow, color: 0xffffff });
  return mergeGeometries(parts);
}

export default class Activities {
  constructor({ scene, plan, lanes, assets, traffic, blobs, events }) {
    this.plan = plan;
    this.lanes = lanes;
    this.assets = assets;
    this.traffic = traffic;
    this.blobs = blobs;
    this.events = events;
    this.active = null;
    this.time = 0;
    this.best = { race: null, stunt: null, taxi: null };
    this.group = new THREE.Group();
    this.group.name = 'activities';
    scene.add(this.group);
    this.buildMarkers();
    this.buildRivals();
  }

  buildMarkers() {
    const geometry = markerGeometry();
    const material = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, toneMapped: false });
    this.markerMeshes = [];
    for (const activity of ACTIVITIES) {
      const y = this.plan.groundHeight(activity.marker.x, activity.marker.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(activity.marker.x, y, activity.marker.z);
      this.group.add(mesh);
      this.markerMeshes.push({ mesh, activity });
      if (this.blobs) this.blobs.claim(activity.marker.x, y + 0.03, activity.marker.z, 5.6, 0.22);
    }
    this.markerMaterial = material;

    // A beacon drives the activity waypoint: a rotating ring and a light column, moved to the
    // current leg of the run and hidden when nothing is active.
    this.beaconGroup = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.1, 0.16, 8, 26),
      new THREE.MeshBasicMaterial({ color: 0x8fe0c4, transparent: true, opacity: 0.8, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.26;
    this.beaconGroup.add(ring);
    this.beaconRing = ring;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.6, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x8fe0c4,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    column.position.y = 13;
    this.beaconGroup.add(column);
    this.beaconGroup.visible = false;
    this.group.add(this.beaconGroup);
  }

  buildRivals() {
    const parts = [];
    const add = (w, h, d, x, y, z, color) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometry.translate(x, y, z);
      parts.push({ geometry, color });
    };
    add(1.86, 0.44, 4.2, 0, 0.62, 0, 0xffffff);
    add(1.6, 0.48, 1.9, 0, 1.02, 0.12, 0xdedede);
    add(1.7, 0.14, 0.7, 0, 0.88, 1.6, 0xf2f2f2);
    const geometry = mergeGeometries(parts);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 });
    this.rivals = new THREE.InstancedMesh(geometry, material, RACE_RIVALS);
    this.rivals.castShadow = true;
    this.rivals.frustumCulled = false;
    this.group.add(this.rivals);
    const colours = [0xd2452f, 0x2f6fd2, 0xd9a93a];
    const tint = new THREE.Color();
    for (let i = 0; i < RACE_RIVALS; i += 1) {
      tint.set(colours[i]);
      this.rivals.setColorAt(i, tint);
    }
    if (this.rivals.instanceColor) this.rivals.instanceColor.needsUpdate = true;
    this.rivalState = Array.from({ length: RACE_RIVALS }, () => ({
      link: null,
      s: 0,
      x: 0,
      z: 0,
      heading: 0,
      speed: 0,
      progress: 0,
      checkpoint: 0,
      finish: 0,
    }));
    this.rivals.count = 0;
  }

  nearestMarker(x, z, radius = 5) {
    let best = null;
    for (const entry of this.markerMeshes) {
      const distance = Math.hypot(entry.activity.marker.x - x, entry.activity.marker.z - z);
      if (distance < radius && (!best || distance < best.distance)) best = { ...entry, distance };
    }
    return best;
  }

  start(activity, playerActor) {
    if (this.active) return false;
    const id = activity.id;
    if (id === 'race') return this.startRace(activity);
    if (id === 'taxi') return this.startTaxi(activity);
    return this.startStunt(activity);
  }

  startTaxi(activity) {
    const rng = this.plan.rng.fork(`taxi-${Math.floor(this.time)}`);
    const candidates = this.plan.blocks.filter((block) => !block.park);
    const target = rng.pick(candidates);
    const pickup = { x: target.x, z: target.z };
    this.active = {
      id: 'taxi',
      phase: 'pickup',
      timer: 0,
      limit: 120,
      pickup,
      dropoff: null,
      reward: activity.reward,
      activity,
    };
    this.beaconAt(pickup);
    return true;
  }

  startRace(activity) {
    const nearest = this.lanes.nearest(activity.marker.x, activity.marker.z, 90);
    if (!nearest) return false;
    const rng = this.plan.rng.fork('race-course');
    const checkpoints = [];
    let link = nearest.link;
    let s = nearest.s;
    for (let i = 0; i < 4; i += 1) {
      const point = this.lanes.advance(link, s, 120 + i * 30, rng);
      checkpoints.push({ x: point.x, z: point.z });
      link = point.link;
      s = point.s;
    }
    this.active = {
      id: 'race',
      phase: 'running',
      timer: 0,
      limit: 150,
      checkpoints,
      checkpoint: 0,
      laps: 1,
      reward: activity.reward,
      activity,
      start: { ...nearest.link.from },
    };
    this.rivals.count = RACE_RIVALS;
    const tint = new THREE.Color();
    for (let i = 0; i < RACE_RIVALS; i += 1) {
      const rival = this.rivalState[i];
      const spot = this.lanes.advance(nearest.link, nearest.s, -8 - i * 7, rng);
      rival.link = spot.link;
      rival.s = Math.max(0, spot.s);
      rival.x = spot.x;
      rival.z = spot.z;
      rival.heading = spot.heading;
      rival.speed = 0;
      rival.progress = 0;
      rival.checkpoint = 0;
      rival.finish = 0;
    }
    this.beaconAt(checkpoints[0]);
    return true;
  }

  startStunt(activity) {
    this.active = {
      id: 'stunt',
      phase: 'running',
      timer: 0,
      limit: 40,
      reward: activity.reward,
      activity,
      air: 0,
      score: 0,
    };
    this.beaconAt({ x: activity.marker.x + 8, z: activity.marker.z - 62 });
    return true;
  }

  beaconAt(point) {
    this.beacon = point;
    if (this.beaconGroup && point) {
      this.beaconGroup.visible = true;
      this.beaconGroup.position.set(point.x, this.plan.groundHeight(point.x, point.z) + 0.02, point.z);
    } else if (this.beaconGroup) {
      this.beaconGroup.visible = false;
    }
  }

  cancel() {
    this.active = null;
    this.rivals.count = 0;
    this.beacon = null;
    if (this.beaconGroup) this.beaconGroup.visible = false;
  }

  update(dt, player, vehicle, driving) {
    this.time += dt;
    for (const { mesh } of this.markerMeshes) {
      mesh.rotation.y += dt * 0.8;
    }
    if (this.beaconGroup?.visible) {
      this.beaconRing.rotation.z += dt * 0.9;
      // Slow vertical bob keeps the column from looking like a static prop.
      this.beaconGroup.position.y += Math.sin(this.time * 1.7) * dt * 0.02;
    }
    if (!this.active) return;
    const run = this.active;
    run.timer += dt;
    const actor = driving && vehicle ? vehicle : player;
    const x = actor.position.x;
    const z = actor.position.z;

    if (run.timer > run.limit) {
      this.fail();
      return;
    }

    if (run.id === 'taxi') {
      if (run.phase === 'pickup') {
        if (Math.hypot(x - run.pickup.x, z - run.pickup.z) < 6.5) {
          run.phase = 'drop';
          const blocks = this.plan.blocks.filter((block) => block.park || block.plaza);
          const rng = this.plan.rng.fork(`taxi-drop-${Math.floor(this.time)}`);
          const target = rng.pick(blocks);
          run.dropoff = { x: target.x, z: target.z };
          run.limit = run.timer + 120;
          this.beaconAt(run.dropoff);
        }
      } else if (Math.hypot(x - run.dropoff.x, z - run.dropoff.z) < 7) {
        this.finish(run.reward);
      }
      return;
    }

    if (run.id === 'race') {
      const checkpoint = run.checkpoints[run.checkpoint];
      if (Math.hypot(x - checkpoint.x, z - checkpoint.z) < 12) {
        run.checkpoint += 1;
        if (run.checkpoint >= run.checkpoints.length) {
          this.finish(run.reward + Math.round(Math.max(0, run.limit - run.timer) * 8));
          return;
        }
        this.beaconAt(run.checkpoints[run.checkpoint]);
      }
      this.updateRivals(dt, run);
      if (run.rivalsDone) this.finish(run.reward);
      return;
    }

    if (run.id === 'stunt') {
      if (driving) {
        if (!vehicle.grounded) run.air += dt;
        else if (run.air > 0.35) {
          run.score += Math.round(run.air * 22);
          run.air = 0;
        }
      }
      if (run.timer > 12 && run.score > 0) this.finish(run.reward + run.score * 10);
      return;
    }
  }

  updateRivals(dt, run) {
    const rng = this.plan.rng.fork('race-rivals');
    let finished = 0;
    for (const rival of this.rivalState) {
      if (rival.finish) {
        finished += 1;
        continue;
      }
      if (!rival.link) continue;
      const speed = 20.5;
      rival.speed = speed;
      rival.s += speed * dt;
      let guard = 0;
      while (rival.link && rival.s > rival.link.len && guard < 4) {
        rival.s -= rival.link.len;
        rival.link = this.lanes.pickNext(rival.link, rng);
        rival.checkpoint = Math.min(run.checkpoints.length - 1, rival.checkpoint + 1);
        guard += 1;
      }
      if (!rival.link) continue;
      const point = this.lanes.pointAt(rival.link, rival.s);
      rival.x = point.x;
      rival.z = point.z;
      rival.heading = this.lanes.heading(rival.link);
      const target = run.checkpoints[rival.checkpoint];
      if (Math.hypot(rival.x - target.x, rival.z - target.z) < 10) {
        rival.checkpoint += 1;
        if (rival.checkpoint >= run.checkpoints.length) rival.finish = 1;
      }
    }
    run.rivalsDone = finished >= RACE_RIVALS;
  }

  finish(reward) {
    const run = this.active;
    if (!run) return;
    if (this.events) this.events.emit('activity:complete', { id: run.id, reward });
    this.active = null;
    this.rivals.count = 0;
    this.beacon = null;
    if (this.beaconGroup) this.beaconGroup.visible = false;
    this.lastReward = reward;
  }

  fail() {
    const run = this.active;
    if (!run) return;
    if (this.events) this.events.emit('activity:fail', { id: run.id });
    this.active = null;
    this.rivals.count = 0;
    this.beacon = null;
    if (this.beaconGroup) this.beaconGroup.visible = false;
  }

  apply() {
    if (!this.active || this.active.id !== 'race') {
      this.rivals.count = 0;
      this.rivals.instanceMatrix.needsUpdate = true;
      return;
    }
    const dummy = this.dummy ?? (this.dummy = new THREE.Object3D());
    this.rivalState.forEach((rival, index) => {
      dummy.position.set(rival.x, this.plan.groundHeight(rival.x, rival.z) + 0.02, rival.z);
      dummy.rotation.set(0, rival.heading, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.rivals.setMatrixAt(index, dummy.matrix);
    });
    this.rivals.instanceMatrix.needsUpdate = true;
  }

  hudState() {
    const run = this.active;
    if (!run) return null;
    const remaining = Math.max(0, Math.round(run.limit - run.timer));
    if (run.id === 'taxi') return { label: `FARE ${remaining}s`, detail: run.phase === 'pickup' ? 'PICK UP THE PASSENGER' : 'RUN THEM ACROSS TOWN' };
    if (run.id === 'race') return { label: `LAP ${run.checkpoint + 1}/${run.checkpoints.length}`, detail: `RACE ${remaining}s` };
    return { label: 'STUNT', detail: `AIR ${run.air.toFixed(2)}s · ${remaining}s` };
  }

  serialize() {
    return { best: this.best };
  }
}
