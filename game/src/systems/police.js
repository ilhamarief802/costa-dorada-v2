// Police and heat. Crimes raise a heat value; heat calls in stars; stars call in cruisers that
// spawn out of sight, chase along the lane graph, ram, and at three stars set a roadblock and put
// officers on foot. At four stars a helicopter joins with a searchlight. Breaking line of sight
// and staying clear of the search radius lets the heat bleed off.

import { WANTED } from '../core/config.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

const MAX_UNITS = 3;

function cruiserGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, color) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    parts.push({ geometry, color });
  };
  add(1.94, 0.5, 4.3, 0, 0.62, 0, 0xffffff);
  add(1.86, 0.18, 1.4, 0, 0.9, -1.5, 0x1c2430);
  add(1.7, 0.54, 2.0, 0, 1.06, 0.12, 0x22303e);
  add(1.9, 0.2, 0.8, 0, 0.96, 1.66, 0xf0f0f0);
  add(1.02, 0.18, 0.34, 0, 1.34, -0.1, 0xf4f4f4);
  add(1.98, 0.12, 0.18, 0, 0.44, -2.15, 0x8a8a8a);
  add(1.98, 0.12, 0.18, 0, 0.44, 2.15, 0x8a8a8a);
  return mergeGeometries(parts);
}

function officerGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, color) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    parts.push({ geometry, color });
  };
  add(0.46, 0.6, 0.28, 0, 1.2, 0, 0x1f2a3a);
  add(0.16, 0.86, 0.2, -0.12, 0.54, 0, 0x18202c);
  add(0.16, 0.86, 0.2, 0.12, 0.54, 0, 0x18202c);
  add(0.16, 0.5, 0.16, -0.3, 1.24, 0, 0x1f2a3a);
  add(0.16, 0.5, 0.16, 0.3, 1.24, 0, 0x1f2a3a);
  add(0.15, 0.06, 0.15, 0, 0.94, 0.2, 0xd9b968);
  return mergeGeometries(parts);
}

export default class Police {
  constructor({ scene, plan, lanes, assets, collision, blobs, combat, pedestrians, traffic }) {
    this.plan = plan;
    this.lanes = lanes;
    this.assets = assets;
    this.collision = collision;
    this.blobs = blobs;
    this.combat = combat;
    this.pedestrians = pedestrians;
    this.traffic = traffic;
    this.time = 0;
    this.heat = 0;
    this.stars = 0;
    this.lastCrime = -99;
    this.calm = 0;
    this.units = [];
    this.officers = [];
    this.roadblock = null;
    this.heli = null;
    this.sirens = { volume: 0, pan: 0 };
    this.events = null;
    this.group = new THREE.Group();
    this.group.name = 'police';
    scene.add(this.group);
    this.build();
    this.playerActor = null;
  }

  build() {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.4 });
    const geometry = cruiserGeometry();
    this.cruisers = new THREE.InstancedMesh(geometry, material, MAX_UNITS);
    this.cruisers.castShadow = true;
    this.cruisers.receiveShadow = true;
    this.cruisers.frustumCulled = false;
    this.cruisers.count = 0;
    this.group.add(this.cruisers);

    const glass = new THREE.BoxGeometry(1.56, 0.4, 1.9);
    glass.translate(0, 1.08, 0.1);
    this.glass = new THREE.InstancedMesh(
      glass,
      new THREE.MeshStandardMaterial({ color: 0x0e1a22, roughness: 0.12, metalness: 0.7 }),
      MAX_UNITS,
    );
    this.glass.frustumCulled = false;
    this.glass.count = 0;
    this.group.add(this.glass);

    this.lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const lamp = new THREE.BoxGeometry(0.9, 0.2, 0.3);
    this.bars = new THREE.InstancedMesh(lamp, this.lightMaterial.clone(), MAX_UNITS * 2);
    this.bars.frustumCulled = false;
    this.bars.count = 0;
    this.group.add(this.bars);
    this.barMaterial = this.bars.material;

    // Siren glow spots, additive, one per bar.
    const glow = new THREE.BufferGeometry();
    glow.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_UNITS * 2 * 3), 3));
    this.glowMaterial = new THREE.PointsMaterial({
      map: this.assets.glow(),
      color: 0xff4a3c,
      size: 4.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.glowPoints = new THREE.Points(glow, this.glowMaterial);
    this.glowPoints.frustumCulled = false;
    this.group.add(this.glowPoints);

    const officerMesh = new THREE.InstancedMesh(
      officerGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
      MAX_UNITS * 2,
    );
    officerMesh.castShadow = true;
    officerMesh.frustumCulled = false;
    officerMesh.count = 0;
    this.officerMesh = officerMesh;
    this.group.add(officerMesh);

    // Searchlight on the helicopter.
    const beamGeometry = new THREE.ConeGeometry(3.4, 34, 14, 1, true);
    beamGeometry.translate(0, -17, 0);
    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff1c4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.beam = new THREE.Mesh(beamGeometry, this.beamMaterial);
    this.beam.visible = false;
    this.group.add(this.beam);

    this.searchSpot = new THREE.SpotLight(0xfff0c2, 0, 70, 0.32, 0.4, 1.1);
    this.searchSpot.visible = false;
    this.group.add(this.searchSpot);
    this.searchSpot.target.position.set(0, 0, 0);
    this.group.add(this.searchSpot.target);

    this.heliBody = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.5, 6.0),
      new THREE.MeshStandardMaterial({ color: 0x1c222b, roughness: 0.5, metalness: 0.4 }),
    );
    this.heliBody.add(hull);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.6 }),
    );
    tail.position.set(0, 0.35, 4.4);
    this.heliBody.add(tail);
    const rotor = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 0.08, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.5 }),
    );
    rotor.position.y = 0.95;
    this.rotor = rotor;
    this.heliBody.add(rotor);
    this.heliBody.visible = false;
    this.group.add(this.heliBody);

    this.dummy = new THREE.Object3D();
    this.local = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
    this.tint = new THREE.Color();
    this.hidden = true;
  }

  setPlayer(actor) {
    this.playerActor = actor;
  }

  get starsLabel() {
    return this.stars;
  }

  crime(name, amount = null, point = null) {
    const value = amount ?? WANTED.crimes[name] ?? 1;
    this.heat = Math.min(WANTED.thresholds[WANTED.thresholds.length - 1] + 4, this.heat + value);
    this.lastCrime = this.time;
    this.calm = 0;
    const stars = WANTED.heatToStars(this.heat);
    if (stars > this.stars) {
      this.stars = stars;
      if (this.events) this.events.emit('police:stars', { stars, point });
    }
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    this.calm = 0;
    this.despawnAll();
  }

  despawnAll() {
    for (const unit of this.units) {
      unit.dead = true;
      unit.alive = false;
      if (this.combat) this.combat.unregister(unit);
      if (unit.blob !== undefined && this.blobs) this.blobs.hide(unit.blob);
    }
    for (const officer of this.officers) {
      officer.alive = false;
      if (this.combat) this.combat.unregister(officer);
    }
    this.units.length = 0;
    this.officers.length = 0;
    this.roadblock = null;
    this.heli = null;
    this.cruisers.count = 0;
    this.glass.count = 0;
    this.bars.count = 0;
    this.glowMaterial.opacity = 0;
    this.glowPoints.visible = false;
    this.heliBody.visible = false;
    this.searchSpot.visible = false;
    this.beam.visible = false;
    this.officerMesh.count = 0;
  }

  /** Find a lane point 90-220 m from the player, preferring somewhere out of view. */
  spawnPoint(player, min = 95, max = 230) {
    const candidates = [];
    for (const link of this.lanes.links) {
      if (link.len < 24) continue;
      for (const s of [link.len * 0.2, link.len * 0.5, link.len * 0.8]) {
        const point = this.lanes.pointAt(link, s);
        const distance = Math.hypot(point.x - player.position.x, point.z - player.position.z);
        if (distance < min || distance > max) continue;
        candidates.push({ link, s, distance, x: point.x, z: point.z });
      }
    }
    if (!candidates.length) return null;
    const rng = this.plan.rng.fork(`police-spawn-${Math.floor(this.time * 3)}`);
    const behind = candidates.filter((candidate) => {
      const heading = this.lanes.heading(candidate.link);
      const toX = candidate.x - player.position.x;
      const toZ = candidate.z - player.position.z;
      return (-Math.sin(heading)) * toX + (-Math.cos(heading)) * toZ < 0;
    });
    const pool = behind.length ? behind : candidates;
    return rng.pick(pool);
  }

  spawnUnit(player, roadblock = false) {
    // The cap counts cruisers that are actually hunting; a parked roadblock must not eat the
    // pursuit budget or three stars would send a single car.
    const live = this.units.filter((unit) => unit.alive && !unit.roadblock).length;
    if (live >= MAX_UNITS) return null;
    const spot = this.spawnPoint(player, roadblock ? 42 : 95, roadblock ? 70 : 230);
    if (!spot) return null;
    const unit = {
      index: this.units.length,
      link: spot.link,
      nextLink: null,
      s: spot.s,
      x: spot.x,
      z: spot.z,
      prevX: spot.x,
      prevZ: spot.z,
      heading: this.lanes.heading(spot.link),
      prevHeading: this.lanes.heading(spot.link),
      speed: roadblock ? 0 : 14,
      steer: 0,
      wheelSpin: 0,
      brake: 0,
      roadblock,
      parked: roadblock,
      deployed: 0,
      alive: true,
      dead: false,
      stuck: 0,
      spawnFade: 0,
      position: { x: spot.x, z: spot.z },
      health: 220,
      hitHeight: 0.9,
      hitRadius: 1.5,
    };
    unit.hitPoint = () => ({ x: unit.x, z: unit.z });
    unit.onDamage = (damage, payload) => this.unitHit(unit, damage, payload);
    this.units.push(unit);
    if (this.combat) this.combat.register(unit);
    return unit;
  }

  unitHit(unit, damage, payload) {
    if (!unit.alive) return false;
    unit.health -= damage;
    if (payload && payload.point && this.combat) this.combat.spawnPuff(payload.point, 0);
    if (unit.health <= 0) {
      unit.alive = false;
      if (this.combat) this.combat.unregister(unit);
      if (this.events) this.events.emit('police:unitDown', { unit });
      this.crime('killOfficer', 0.9);
    }
    return unit.alive;
  }

  deployOfficers(unit) {
    const count = this.officers.filter((officer) => officer.unit === unit).length;
    if (count >= 2) return;
    for (const side of [-1, 1]) {
      if (this.officers.length >= MAX_UNITS * 2) return;
      const x = unit.x + Math.cos(unit.heading) * side * 2.2;
      const z = unit.z - Math.sin(unit.heading) * side * 2.2;
      const officer = {
        unit,
        x,
        z,
        prevX: x,
        prevZ: z,
        heading: unit.heading,
        prevHeading: unit.heading,
        alive: true,
        hitHeight: 1.1,
        hitRadius: 0.62,
        health: 90,
        fireCooldown: 0.6 + (this.time * 0.37 % 1),
        phase: 0,
        position: { x, z },
      };
      officer.hitPoint = () => ({ x: officer.x, z: officer.z });
      officer.onDamage = (damage, payload) => this.officerHit(officer, damage, payload);
      this.officers.push(officer);
      if (this.combat) this.combat.register(officer);
    }
  }

  roadblockNear(x, z) {
    if (!this.roadblock) return false;
    for (const unit of this.roadblock.units) {
      if (Math.hypot(unit.x - x, unit.z - z) < 8) return true;
    }
    return false;
  }

  buildRoadblock(player) {
    if (this.roadblock) return;
    const nearest = this.lanes.nearest(player.position.x, player.position.z, 60);
    if (!nearest) return;
    const point = this.lanes.advance(nearest.link, nearest.s, 96 + Math.min(60, player.speed ?? 0), this.plan.rng.fork('block'));
    const link = point.link;
    // Park the pair nose-to-nose across the carriageway: offset laterally, both facing the
    // oncoming lane, so the two cruisers and their light bars read as a wall.
    const rx = -link.dz;
    const rz = link.dx;
    const units = [];
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      const x = point.x + rx * side * 3.1;
      const z = point.z + rz * side * 3.1;
      const heading = this.lanes.heading(link) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const unit = {
        index: this.units.length,
        link,
        nextLink: null,
        s: point.s,
        x,
        z,
        prevX: x,
        prevZ: z,
        heading,
        prevHeading: heading,
        speed: 0,
        steer: 0,
        wheelSpin: 0,
        brake: 1,
        roadblock: true,
        parked: true,
        deployed: 0,
        alive: true,
        dead: false,
        stuck: 0,
        spawnFade: 0,
        health: 220,
        hitHeight: 0.9,
        hitRadius: 1.5,
      };
      unit.hitPoint = () => ({ x: unit.x, z: unit.z });
      unit.onDamage = (damage, payload) => this.unitHit(unit, damage, payload);
      this.units.push(unit);
      if (this.combat) this.combat.register(unit);
      units.push(unit);
    }
    this.roadblock = { link, s: point.s, units, age: 0 };
  }

  update(dt, player, camera, input) {
    this.time += dt;
    this.playerActor = player;
    const target = player;

    // Heat decay: nothing happens for a while, then it bleeds away — faster once they lose you.
    const wanted = this.stars > 0;
    if (wanted) {
      const seen = this.anyUnitCanSee(player);
      if (seen) {
        this.calm = 0;
        this.lastCrime = Math.max(this.lastCrime, this.time - 2);
      } else {
        this.calm += dt;
      }
      if (this.calm > 3.2) {
        this.heat = Math.max(0, this.heat - WANTED.decayPerSecond * dt * (1 + Math.min(1.4, this.calm * 0.2)));
        const stars = WANTED.heatToStars(this.heat);
        if (stars < this.stars) {
          this.stars = stars;
          if (this.events) this.events.emit('police:stars', { stars });
        }
      }
    }

    // Keep the cruiser count in step with the stars.
    const desired = this.stars === 0 ? 0 : this.stars <= 1 ? 1 : this.stars === 2 ? 2 : MAX_UNITS;
    const live = this.units.filter((unit) => unit.alive && !unit.roadblock);
    if (live.length < desired && this.time - (this._lastSpawn ?? -9) > 2.4) {
      this._lastSpawn = this.time;
      this.spawnUnit(player);
    }
    for (const unit of this.units) {
      if (unit.roadblock || !unit.alive) continue;
      this.driveUnit(unit, dt, target);
    }

    // Roadblock at three stars, refreshed when the player slips past.
    if (this.stars >= 3 && !this.roadblock && this.time - (this._lastBlock ?? -20) > 16) {
      this._lastBlock = this.time;
      this.buildRoadblock(player);
    }
    if (this.roadblock) {
      this.roadblock.age += dt;
      if (this.roadblock.age > 34) this.roadblock = null;
    }

    // Officers dismount from stopped cruisers at three stars and up.
    if (this.stars >= 3) {
      for (const unit of this.units) {
        if (unit.roadblock || !unit.alive || unit.speed > 2.6) continue;
        const distance = Math.hypot(unit.x - player.position.x, unit.z - player.position.z);
        if (distance < 46 && this.officers.length < MAX_UNITS * 2) this.deployOfficers(unit);
      }
    }
    for (const officer of this.officers) {
      if (!officer.alive) continue;
      officer.prevX = officer.x;
      officer.prevZ = officer.z;
      officer.prevHeading = officer.heading;
      const dx = player.position.x - officer.x;
      const dz = player.position.z - officer.z;
      const distance = Math.hypot(dx, dz) || 1;
      officer.heading = dampAngle(officer.heading, Math.atan2(-dx / distance, -dz / distance), 8, dt);
      if (distance > 13) {
        officer.x += (dx / distance) * dt * 3.0;
        officer.z += (dz / distance) * dt * 3.0;
      }
      officer.phase += dt * 6;
      officer.fireCooldown -= dt;
      const canSee = distance < 34 && !player.hidden;
      if (canSee && officer.fireCooldown <= 0 && player.onDamage) {
        officer.fireCooldown = 1.15 + this.fract(officer.x * 13.7) * 0.7;
        if (this.fract(officer.z * 7.3) > 0.34) {
          player.onDamage(7, { source: 'officer', point: { x: officer.x, y: 1.2, z: officer.z } });
          if (this.combat) {
            this.combat.spawnTracer(
              { x: officer.x, y: 1.35, z: officer.z },
              { x: player.position.x, y: player.position.y + 1.0, z: player.position.z },
            );
            this.combat.spawnFlash({ x: officer.x, y: 1.35, z: officer.z }, { x: (dx / distance), y: 0, z: (dz / distance) });
          }
        }
      }
    }
    if (this.officers.length === 0) this.officerMesh.count = 0;

    this.updateHeli(dt, player);
    this.applyAll(dt);
  }

  fract(value) {
    return value - Math.floor(value);
  }

  anyUnitCanSee(player) {
    for (const unit of this.units) {
      if (!unit.alive) continue;
      if (Math.hypot(unit.x - player.position.x, unit.z - player.position.z) < 78) return true;
    }
    for (const officer of this.officers) {
      if (!officer.alive) continue;
      if (Math.hypot(officer.x - player.position.x, officer.z - player.position.z) < 52) return true;
    }
    return false;
  }

  driveUnit(unit, dt, player) {
    unit.prevX = unit.x;
    unit.prevZ = unit.z;
    unit.prevHeading = unit.heading;
    if (unit.parked) {
      unit.speed = 0;
      return;
    }

    const px = player.position.x;
    const pz = player.position.z;
    const lane = this.lanes.pointAt(unit.link, unit.s);
    const distance = Math.hypot(px - lane.x, pz - lane.z);

    // Greedy lane navigation: pick the junction exit that closes the distance fastest, with
    // hysteresis so a cruiser does not flicker between two exits at a junction.
    if (!unit.nextLink) unit.nextLink = this.pickPursuitLink(unit.link, px, pz);
    if (unit.link.len - unit.s < 14) {
      const candidate = this.pickPursuitLink(unit.link, px, pz);
      if (candidate && candidate !== unit.nextLink) {
        const end = this.lanes.nodes[candidate.b];
        const current = unit.nextLink ? this.lanes.nodes[unit.nextLink.b] : null;
        const gain = current ? Math.hypot(current.x - px, current.z - pz) - Math.hypot(end.x - px, end.z - pz) : 99;
        if (gain > 14) unit.nextLink = candidate;
      }
    }

    // Close on the actor, then hold: a cruiser that has you boxed in stops and dismounts rather
    // than driving through you and turning around forever.
    let targetSpeed = unit.speed > 26 ? 26 : 24;
    if (distance < 30) targetSpeed = Math.min(targetSpeed, 6 + distance * 0.7);
    if (distance < 9) {
      targetSpeed = 0;
      if (!unit.holding) unit.holding = 0;
      unit.holding += dt;
    } else {
      unit.holding = 0;
    }
    // Do not bulldoze the traffic; slow behind a car ahead.
    const traffic = this.traffic;
    if (traffic && targetSpeed > 2) {
      for (const car of traffic.cars) {
        if (car.driven) continue;
        if (car.link !== unit.link) continue;
        if (car.s > unit.s && car.s - unit.s < 9) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, car.speed - 0.5));
        }
      }
    }
    unit.brake = targetSpeed < unit.speed - 2 ? 1 : 0;
    unit.speed = damp(unit.speed, targetSpeed, targetSpeed < unit.speed ? 5.6 : 1.9, dt);
    unit.s += unit.speed * dt;

    let guard = 0;
    while (unit.s > unit.link.len && guard < 4) {
      unit.s -= unit.link.len;
      unit.link = unit.nextLink ?? this.pickPursuitLink(unit.link, px, pz);
      unit.nextLink = this.pickPursuitLink(unit.link, px, pz);
      guard += 1;
    }

    const point = this.lanes.pointAt(unit.link, unit.s);
    unit.x = point.x;
    unit.z = point.z;
    const headingTarget = this.lanes.heading(unit.link);
    unit.heading = dampAngle(unit.heading, headingTarget, 6.4, dt);
    unit.steer = clamp(wrapAngle(headingTarget - unit.heading) * 1.5, -0.5, 0.5);
    unit.wheelSpin += (unit.speed * dt) / 0.34;
  }

  pickPursuitLink(link, px, pz) {
    const node = this.lanes.nodes[link.b];
    const options = node.out.filter((candidate) => candidate !== link.reverse);
    if (!options.length) return link.reverse ?? link;
    let best = options[0];
    let bestScore = Infinity;
    for (const option of options) {
      const end = this.lanes.nodes[option.b];
      const score = Math.hypot(end.x - px, end.z - pz) + (option.axis === link.axis ? 0 : 16);
      if (score < bestScore) {
        bestScore = score;
        best = option;
      }
    }
    return best;
  }

  updateHeli(dt, player) {
    const want = this.stars >= 4;
    if (want && !this.heli) {
      this.heli = { angle: this.fract(this.time * 0.07) * Math.PI * 2, x: 0, y: 44, z: 0, fade: 0 };
    }
    if (!want || !this.heli) {
      if (this.heli) {
        this.heli.fade = Math.max(0, this.heli.fade - dt);
        if (this.heli.fade <= 0) {
          this.heli = null;
          this.heliBody.visible = false;
          this.searchSpot.visible = false;
          this.beam.visible = false;
        }
      }
      return;
    }
    const heli = this.heli;
    heli.fade = Math.min(1, heli.fade + dt * 0.8);
    heli.angle += dt * 0.42;
    const radius = 42;
    heli.x = player.position.x + Math.cos(heli.angle) * radius;
    heli.z = player.position.z + Math.sin(heli.angle) * radius;
    heli.y = 46 + Math.sin(heli.angle * 1.6) * 3;
    this.heliBody.visible = true;
    this.heliBody.position.set(heli.x, heli.y, heli.z);
    this.heliBody.rotation.y = -heli.angle + Math.PI / 2;
    this.rotor.rotation.y += dt * 22;

    const ground = player.position;
    this.searchSpot.visible = heli.fade > 0.2;
    this.searchSpot.intensity = 260 * heli.fade;
    this.searchSpot.position.set(heli.x, heli.y - 1.4, heli.z);
    this.searchSpot.target.position.set(ground.x, 0, ground.z);
    this.searchSpot.target.updateMatrixWorld();
    this.beam.visible = heli.fade > 0.1;
    this.beam.position.set(heli.x, heli.y - 1.4, heli.z);
    const dx = ground.x - heli.x;
    const dz = ground.z - heli.z;
    const dy = -heli.y;
    const length = Math.hypot(dx, dy, dz);
    this.beam.lookAt(ground.x, 0.4, ground.z);
    this.beam.rotateX(Math.PI / 2);
    this.beamMaterial.opacity = 0.16 * heli.fade * (1 - Math.min(1, length / 90));
  }

  officerHit(officer, damage, payload) {
    officer.health -= damage;
    if (this.combat && payload && payload.point) this.combat.spawnPuff(payload.point, 1);
    if (officer.health <= 0 && officer.alive) {
      officer.alive = false;
      this.crime('killOfficer', 1.2);
      if (this.events) this.events.emit('police:officerDown', { officer });
    }
    return officer.alive;
  }

  /** Damage a cruiser's crew; enough hits disables the unit. */
  registerUnitsAsTargets() {
    return this.units;
  }

  applyAll(dt) {
    let count = 0;
    let barCount = 0;
    const barPositions = this.glowPoints.geometry.getAttribute('position');
    const strobe = Math.sin(this.time * 9.2) > 0;

    for (const unit of this.units) {
      if (!unit.alive) continue;
      this.dummy.position.set(unit.x, this.plan.groundHeight(unit.x, unit.z) + 0.02, unit.z);
      this.dummy.rotation.set(0, unit.heading, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.cruisers.setMatrixAt(count, this.dummy.matrix);
      this.glass.setMatrixAt(count, this.dummy.matrix);

      this.local.position.set(0, 1.44, -0.1);
      this.local.rotation.set(0, 0, 0);
      this.local.updateMatrix();
      this.matrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
      this.bars.setMatrixAt(barCount, this.matrix);
      this.tint.set(strobe ? 0xff3a2c : 0x2c4a78);
      this.bars.setColorAt(barCount, this.tint);
      barPositions.setXYZ(barCount, unit.x, this.dummy.position.y + 1.5, unit.z);
      barCount += 1;

      if (this.strobeSecond !== false) {
        this.local.position.set(0, 1.44, 0.9);
        this.local.updateMatrix();
        this.matrix.multiplyMatrices(this.dummy.matrix, this.local.matrix);
        this.bars.setMatrixAt(barCount, this.matrix);
        this.tint.set(strobe ? 0x2c4a78 : 0xff3a2c);
        this.bars.setColorAt(barCount, this.tint);
        barPositions.setXYZ(barCount, unit.x, this.dummy.position.y + 1.5, unit.z);
        barCount += 1;
      }

      if (this.blobs) this.blobs.write(unit.blob ?? (unit.blob = this.blobs.claim(0, -400, 0, 0.0001)), unit.x, this.dummy.position.y + 0.03, unit.z, 4.6, 0.4);
      count += 1;
    }
    this.cruisers.count = count;
    this.glass.count = count;
    this.bars.count = barCount;
    this.cruisers.instanceMatrix.needsUpdate = true;
    this.glass.instanceMatrix.needsUpdate = true;
    this.bars.instanceMatrix.needsUpdate = true;
    if (this.bars.instanceColor) this.bars.instanceColor.needsUpdate = true;
    barPositions.needsUpdate = true;
    this.glowPoints.visible = count > 0;
    this.glowMaterial.opacity = count > 0 ? 0.9 : 0;
    this.glowMaterial.color.set(strobe ? 0xff4a3c : 0x4a7ac2);
    this.glowMaterial.size = 3.4 + Math.sin(this.time * 9.2) * 1.1;
    this.strobeSecond = strobe;

    // Officers.
    let officerCount = 0;
    for (const officer of this.officers) {
      if (!officer.alive) continue;
      this.dummy.position.set(officer.x, this.plan.groundHeight(officer.x, officer.z), officer.z);
      this.dummy.rotation.set(0, officer.heading, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.officerMesh.setMatrixAt(officerCount, this.dummy.matrix);
      officerCount += 1;
    }
    this.officerMesh.count = officerCount;
    this.officerMesh.instanceMatrix.needsUpdate = true;

    // Sirens: louder and higher when the nearest unit is close to the camera focus.
    let nearest = Infinity;
    for (const unit of this.units) {
      if (!unit.alive) continue;
      nearest = Math.min(nearest, Math.hypot(unit.x - (this.playerActor?.position.x ?? 0), unit.z - (this.playerActor?.position.z ?? 0)));
    }
    const loud = nearest < 20 ? 1 : nearest < 60 ? 0.55 : nearest < 140 ? 0.22 : 0;
    this.sirens.volume = loud;
    if (this.blobs) this.blobs.commit();
  }

  hudState() {
    return {
      stars: this.stars,
      heat: this.heat,
      pursuing: this.stars > 0 && this.calm < 3.2,
      siren: this.sirens.volume,
    };
  }
}
