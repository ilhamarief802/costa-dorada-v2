// Combat: two hitscan weapons with their own cadence and spread, a pooled tracer/flash/hit system
// drawn as cheap points and lines, floating damage numbers, and a target registry that police,
// gang members and pedestrians all populate so a shot can hit any of them.

import { WEAPONS } from '../core/config.js';
import { clamp } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

const TRACERS = 26;
const PUFFS = 48;
const NUMBERS = 12;

function gunGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    parts.push({ geometry });
  };
  add(0.09, 0.12, 0.34, 0, 0, 0.02);
  add(0.06, 0.19, 0.09, 0, -0.13, 0.08);
  add(0.05, 0.05, 0.2, 0, 0.02, -0.24);
  return mergeGeometries(parts);
}

export default class Combat {
  constructor(scene, assets, collision) {
    this.scene = scene;
    this.assets = assets;
    this.collision = collision;
    this.targets = [];
    this.weapon = 'pistol';
    this.ammo = { pistol: 12, smg: 30 };
    this.reserve = { pistol: 96, smg: 210 };
    this.cooldown = 0;
    this.reloading = 0;
    this.recoil = 0;
    this.flash = 0;
    this.shots = 0;
    this.hits = 0;
    this.onHit = null;
    this.onShot = null;
    this.time = 0;

    this.buildEffects();
  }

  buildEffects() {
    this.group = new THREE.Group();
    this.group.name = 'combat-fx';

    // Tracers: a pool of thin lines, alive only for a few frames.
    this.tracers = [];
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      depthWrite: false,
    });
    this.tracerMaterial = lineMaterial;
    for (let i = 0; i < TRACERS; i += 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geometry, lineMaterial.clone());
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.tracers.push({ line, life: 0 });
    }

    // Muzzle flash: a bright quad and a glow sprite at the barrel.
    this.flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.assets.glow(),
        color: 0xffe2a8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.flashSprite.scale.setScalar(1.1);
    this.flashSprite.visible = false;
    this.group.add(this.flashSprite);

    // Blood puffs and impact sparks, one Points cloud each.
    const puffPositions = new Float32Array(PUFFS * 3);
    const puffGeometry = new THREE.BufferGeometry();
    puffGeometry.setAttribute('position', new THREE.BufferAttribute(puffPositions, 3));
    this.puffMaterial = new THREE.PointsMaterial({
      map: this.assets.glow(),
      color: 0x8e2a24,
      size: 0.62,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
    });
    this.puffs = new THREE.Points(puffGeometry, this.puffMaterial);
    this.puffs.frustumCulled = false;
    this.group.add(this.puffs);
    this.puffState = Array.from({ length: PUFFS }, () => ({ life: 0, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0 }));

    const sparkPositions = new Float32Array(PUFFS * 3);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    this.sparkMaterial = new THREE.PointsMaterial({
      map: this.assets.glow(),
      color: 0xffcf7a,
      size: 0.34,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.sparks = new THREE.Points(sparkGeometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    this.sparkState = Array.from({ length: PUFFS }, () => ({ life: 0, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0 }));

    this.scene.add(this.group);

    // The first-person gun is drawn into the world by the player rig; this is the HUD-free
    // world model used when a shot rig freezes the scene.
    this.weaponMesh = new THREE.Mesh(
      gunGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.42, metalness: 0.7 }),
    );
    this.weaponMesh.visible = false;
    this.scene.add(this.weaponMesh);

    this.numberLayer = document.createElement('div');
    this.numberLayer.id = 'damage-numbers';
    document.body.appendChild(this.numberLayer);
    this.numbers = Array.from({ length: NUMBERS }, () => {
      const element = document.createElement('div');
      element.className = 'damage-number';
      element.style.opacity = '0';
      this.numberLayer.appendChild(element);
      return { element, life: 0, x: 0, y: 0, z: 0, value: 0 };
    });
    this.numberCursor = 0;
  }

  register(target) {
    if (!this.targets.includes(target)) this.targets.push(target);
  }

  unregister(target) {
    const index = this.targets.indexOf(target);
    if (index >= 0) this.targets.splice(index, 1);
  }

  definition() {
    return WEAPONS[this.weapon] ?? WEAPONS.pistol;
  }

  select(name) {
    if (!WEAPONS[name] || name === this.weapon) return false;
    this.weapon = name;
    this.cooldown = Math.max(this.cooldown, 0.18);
    return true;
  }

  reload() {
    const def = this.definition();
    if (this.reloading > 0) return false;
    if (this.ammo[this.weapon] >= def.magazine || this.reserve[this.weapon] <= 0) return false;
    this.reloading = def.reload;
    return true;
  }

  hasAmmo() {
    return this.ammo[this.weapon] > 0 || this.reserve[this.weapon] > 0;
  }

  /** Fire along a ray. Returns true when a round left the barrel. */
  fire(origin, direction) {
    const def = this.definition();
    if (this.cooldown > 0 || this.reloading > 0) return false;
    if (this.ammo[this.weapon] <= 0) {
      if (this.reserve[this.weapon] > 0) this.reload();
      return false;
    }
    this.ammo[this.weapon] -= 1;
    this.cooldown = def.cadence;
    this.recoil = Math.min(1, this.recoil + 0.55);
    this.shots += 1;
    if (this.onShot) this.onShot({ weapon: this.weapon, origin, direction });

    const spread = def.spread;
    const jitterX = (this.pseudo() - 0.5) * spread;
    const jitterY = (this.pseudo() - 0.5) * spread;
    const dx = direction.x + jitterX;
    const dy = direction.y + jitterY;
    const dz = direction.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const ray = { x: dx / length, y: dy / length, z: dz / length };

    const worldHit = this.collision
      ? this.collision.rayHit(origin, ray, def.range, 0.4)
      : def.range;

    let hit = null;
    let best = worldHit;
    for (const target of this.targets) {
      if (!target.alive) continue;
      const point = target.hitPoint ? target.hitPoint() : target.position;
      if (!point) continue;
      // Bodies report a ground point; the aim point is their centre of mass above it. A missing
      // y means "on the pavement", not NaN, which would make every ray report a hit.
      const centreY = (Number.isFinite(point.y) ? point.y : 0) + (target.hitHeight ?? 1.0);
      const ox = point.x - origin.x;
      const oy = centreY - origin.y;
      const oz = point.z - origin.z;
      const along = ox * ray.x + oy * ray.y + oz * ray.z;
      if (!Number.isFinite(along) || along <= 0.4 || along > best) continue;
      const px = origin.x + ray.x * along;
      const py = origin.y + ray.y * along;
      const pz = origin.z + ray.z * along;
      const miss = Math.hypot(point.x - px, centreY - py, point.z - pz);
      if (!Number.isFinite(miss) || miss > (target.hitRadius ?? 0.8)) continue;
      best = along;
      hit = target;
    }

    const end = {
      x: origin.x + ray.x * best,
      y: origin.y + ray.y * best,
      z: origin.z + ray.z * best,
    };
    this.spawnTracer(origin, end);
    this.spawnFlash(origin, ray);
    if (hit) {
      this.hits += 1;
      const falloff = 1 - clamp((best - def.falloffStart) / Math.max(1, def.range - def.falloffStart), 0, 0.62);
      const damage = Math.round(def.damage * falloff);
      this.spawnPuff(end, 1);
      this.number(end, damage);
      if (hit.onDamage) hit.onDamage(damage, { weapon: this.weapon, origin, point: end });
      if (this.onHit) this.onHit(hit, damage);
      return true;
    }
    this.spawnPuff(end, 0);
    return true;
  }

  pseudo() {
    this._seed = ((this._seed ?? 24634) * 1664525 + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  spawnTracer(from, to) {
    const tracer = this.tracers.find((entry) => entry.life <= 0) ?? this.tracers[this._tracerCursor = ((this._tracerCursor ?? 0) + 1) % TRACERS];
    const positions = tracer.line.geometry.getAttribute('position');
    positions.setXYZ(0, from.x, from.y - 0.1, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    tracer.line.visible = true;
    tracer.line.material.opacity = 0.85;
    tracer.life = 0.075;
  }

  spawnFlash(origin, ray) {
    this.flashSprite.position.set(origin.x + ray.x * 0.9, origin.y + ray.y * 0.9, origin.z + ray.z * 0.9);
    this.flashSprite.visible = true;
    this.flashSprite.material.opacity = 1;
    this.flashSprite.scale.setScalar(1.5 + this.pseudo() * 0.6);
    this.flash = 0.06;
  }

  spawnPuff(point, blood) {
    const pool = blood ? this.puffState : this.sparkState;
    const slot = pool.find((entry) => entry.life <= 0) ?? pool[0];
    slot.life = blood ? 0.55 : 0.22;
    slot.x = point.x;
    slot.y = point.y;
    slot.z = point.z;
    slot.vx = (this.pseudo() - 0.5) * (blood ? 1.6 : 2.4);
    slot.vy = (blood ? 1.1 : 1.8) + this.pseudo() * 0.9;
    slot.vz = (this.pseudo() - 0.5) * (blood ? 1.6 : 2.4);
  }

  number(point, value) {
    const slot = this.numbers[this.numberCursor % NUMBERS];
    this.numberCursor += 1;
    slot.life = 0.85;
    slot.x = point.x;
    slot.y = point.y + 1.4;
    slot.z = point.z;
    slot.value = value;
    slot.element.textContent = String(value);
    slot.element.style.opacity = '1';
  }

  update(dt, camera) {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 3.2);
    if (this.flash > 0) {
      this.flash -= dt;
      this.flashSprite.material.opacity = Math.max(0, this.flash / 0.06);
      if (this.flash <= 0) this.flashSprite.visible = false;
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const def = this.definition();
        const space = def.magazine - this.ammo[this.weapon];
        const load = Math.min(space, this.reserve[this.weapon]);
        this.ammo[this.weapon] += load;
        this.reserve[this.weapon] -= load;
      }
    }

    for (const tracer of this.tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.075) * 0.85;
      if (tracer.life <= 0) tracer.line.visible = false;
    }

    this.stepPool(this.puffState, this.puffs, dt, true);
    this.stepPool(this.sparkState, this.sparks, dt, false);
    this.stepNumbers(dt, camera);
  }

  stepPool(pool, points, dt, rise) {
    const attribute = points.geometry.getAttribute('position');
    for (let i = 0; i < pool.length; i += 1) {
      const entry = pool[i];
      if (entry.life <= 0) {
        attribute.setXYZ(i, 0, -600, 0);
        continue;
      }
      entry.life -= dt;
      entry.x += entry.vx * dt;
      entry.y += (entry.vy - (rise ? 2.4 : 3.6)) * dt * (rise ? 1 : 1);
      entry.z += entry.vz * dt;
      entry.vx *= Math.exp(-2.4 * dt);
      entry.vz *= Math.exp(-2.4 * dt);
      attribute.setXYZ(i, entry.x, entry.y, entry.z);
    }
    attribute.needsUpdate = true;
  }

  stepNumbers(dt, camera) {
    if (!camera) return;
    const width = 1280;
    const height = 720;
    const projected = new THREE.Vector3();
    for (const slot of this.numbers) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.y += dt * 0.9;
      if (slot.life <= 0) {
        slot.element.style.opacity = '0';
        continue;
      }
      projected.set(slot.x, slot.y, slot.z).project(camera);
      if (projected.z > 1) {
        slot.element.style.opacity = '0';
        continue;
      }
      const px = (projected.x * 0.5 + 0.5) * width;
      const py = (-projected.y * 0.5 + 0.5) * height;
      slot.element.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
      slot.element.style.opacity = String(Math.min(1, slot.life / 0.45));
    }
  }

  hudState() {
    const def = this.definition();
    return {
      weapon: def.label,
      ammo: this.ammo[this.weapon],
      reserve: this.reserve[this.weapon],
      reloading: this.reloading > 0,
      mag: def.magazine,
    };
  }
}
