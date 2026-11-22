// The hero coupe: the shared lofted coupe shell, painted teal with a cream coachline, arcade
// physics with grip and drift, a sprung body that rolls and pitches, spinning steering wheels and
// real headlight beams for the night. Same paint, chrome and glass as the traffic, so the hero
// car and the crowd cars read as one art direction.

import { CAR } from '../core/config.js';
import { clamp, damp, lerp } from '../core/math.js';
import { buildCar } from '../core/carkit.js';
import { makeGlassMaterial, setGlassSky } from '../core/materials.js';

export default class Vehicle {
  constructor(scene, plan, assets, collision) {
    this.plan = plan;
    this.collision = collision;
    this.assets = assets;
    const spot = plan.cover.car;
    this.position = { x: spot.x, y: this.plan.groundHeight(spot.x, spot.z), z: spot.z };
    this.prev = { ...this.position };
    this.heading = spot.rot;
    this.prevHeading = spot.rot;
    this.vx = 0;
    this.vz = 0;
    this.forwardSpeed = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.suspension = 0;
    this.suspensionVelocity = 0;
    this.roll = 0;
    this.pitch = 0;
    this.driven = false;
    this.handbrake = false;
    this.night = false;
    this.brakeFade = 0;
    this.build();
    scene.add(this.root);
    this.applyPose(1);
  }

  build() {
    this.root = new THREE.Group();
    this.root.name = 'hero-car';
    this.bodyGroup = new THREE.Group();
    this.root.add(this.bodyGroup);

    const kit = buildCar('coupe');
    this.spec = kit.spec;
    // The rocker panel sits at the shell's lowest section, not a separately declared number.
    this.spec.sill = Math.min(...this.spec.stations.map((s) => s.cy - s.down));
    const teal = new THREE.Color(0x1e8894);

    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.55 });
    this.body = new THREE.Mesh(kit.body, paint);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    // Per-vertex tint: the shell's own shading times the paint colour.
    this.paintBody(kit.body, teal);
    this.bodyGroup.add(this.body);

    const chrome = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.96 });
    const chromeMesh = new THREE.Mesh(kit.trim, chrome);
    chromeMesh.castShadow = true;
    this.bodyGroup.add(chromeMesh);

    const dark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
    const darkMesh = new THREE.Mesh(kit.dark, dark);
    darkMesh.castShadow = true;
    this.bodyGroup.add(darkMesh);

    this.glassMaterial = makeGlassMaterial({ tint: 0x0a1c24, tintPower: 1.1 });
    const glass = new THREE.Mesh(kit.glass, this.glassMaterial);
    this.bodyGroup.add(glass);

    // A cream coachline down each flank and over the roof, so the coupe is recognisable at 480 px.
    // The flank bands are lofted from the same station table, so they follow the taper of the
    // body instead of poking out past the tail.
    const stripes = [];
    const band = coachline(this.spec.stations, this.spec.canopy.yBottom - 0.06, 0.028, 0.05, 0xf2e8cc);
    stripes.push({ geometry: band });
    const roofBand = new THREE.BoxGeometry(0.22, 0.018, 1.0);
    roofBand.translate(0, this.spec.canopy.yTop + 0.004, (this.spec.canopy.roofZ0 + this.spec.canopy.roofZ1) / 2);
    stripes.push({ geometry: roofBand, color: 0xf2e8cc });
    this.stripeMesh = new THREE.Mesh(
      mergeParts(stripes),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.2 }),
    );
    this.bodyGroup.add(this.stripeMesh);

    this.headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2cf, toneMapped: false });
    const head = new THREE.Mesh(kit.head, this.headlightMaterial);
    this.bodyGroup.add(head);
    this.tailMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const tail = new THREE.Mesh(kit.tail, this.tailMaterial);
    this.bodyGroup.add(tail);
    this.setTail(0);

    // Wheels: tyre plus rim, spun from the physics state, front pair steers.
    this.wheels = [];
    const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.95 });
    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.24, metalness: 0.95 });
    const hubMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 });
    for (const side of [-1, 1]) {
      for (const axle of [-1, 1]) {
        const group = new THREE.Group();
        group.position.set(side * this.spec.width * 0.42, this.spec.wheelRadius, axle * this.spec.wheelBase);
        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(this.spec.wheelRadius, this.spec.wheelRadius, 0.23, 14), tyreMaterial);
        tyre.rotation.z = Math.PI / 2;
        tyre.castShadow = true;
        group.add(tyre);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(this.spec.wheelRadius * 0.56, this.spec.wheelRadius * 0.56, 0.245, 12), rimMaterial);
        rim.rotation.z = Math.PI / 2;
        group.add(rim);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(this.spec.wheelRadius * 0.2, this.spec.wheelRadius * 0.2, 0.26, 8), hubMaterial);
        hub.rotation.z = Math.PI / 2;
        group.add(hub);
        this.root.add(group);
        this.wheels.push({ group, tyre, front: axle < 0 });
      }
    }

    // Headlight beams: narrow cones, so a beam is a pool ahead of the car and never a shaft
    // hanging in mid-air where a car in front of it would sit.
    this.headlightBeams = [];
    this.glowSprites = [];
    for (const side of [-1, 1]) {
      const light = new THREE.SpotLight(0xffe2b4, 0, 26, 0.42, 0.62, 1.6);
      light.position.set(side * this.spec.width * 0.32, this.spec.lamps.headY, -1.95);
      const target = new THREE.Object3D();
      target.position.set(side * this.spec.width * 0.42, 0.05, -9.5);
      this.root.add(target);
      light.target = target;
      this.root.add(light);
      this.headlightBeams.push(light);

      const glow = new THREE.Sprite(
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
      glow.position.set(side * this.spec.width * 0.33, this.spec.lamps.headY, this.spec.lamps.headZ - 0.04);
      glow.scale.set(3.0, 1.8, 1);
      this.bodyGroup.add(glow);
      this.glowSprites.push(glow);
    }

    this.fillLight = new THREE.PointLight(0xffcf9a, 0, 10, 2);
    this.fillLight.position.set(0, 1.5, 0);
    this.root.add(this.fillLight);

    this.root.traverse((child) => {
      if (child.isMesh) child.receiveShadow = true;
    });
  }

  /** Multiply the shell's baked shading by the paint colour so the paint keeps its form. */
  paintBody(geometry, colour) {
    const colors = geometry.getAttribute('color');
    const array = colors.array;
    for (let i = 0; i < colors.count; i += 1) {
      const shade = array[i * 3];
      array[i * 3] = shade * colour.r;
      array[i * 3 + 1] = shade * colour.g;
      array[i * 3 + 2] = shade * colour.b;
    }
    colors.needsUpdate = true;
  }

  setTail(level) {
    this.tailMaterial.color.setRGB(level, level * 0.1, level * 0.05);
  }

  setNight(night) {
    this.night = night;
    for (const light of this.headlightBeams) light.intensity = night ? 15 : 0;
    if (this.fillLight) this.fillLight.intensity = night ? 9 : 0;
    for (const glow of this.glowSprites) glow.material.opacity = night ? 0.78 : 0.18;
    this.headlightMaterial.color.set(night ? 0xfff6df : 0xf6ead0);
  }

  setSky(skyInfo) {
    setGlassSky(skyInfo);
  }

  reset(x, z, heading) {
    this.position.x = x;
    this.position.z = z;
    this.position.y = this.plan.groundHeight(x, z);
    this.prev = { ...this.position };
    this.heading = heading;
    this.prevHeading = heading;
    this.vx = 0;
    this.vz = 0;
    this.forwardSpeed = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.suspension = 0;
    this.suspensionVelocity = 0;
    this.roll = 0;
    this.pitch = 0;
    this.applyPose(1);
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
    const previousForward = vForward;

    const throttle = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    this.handbrake = input.isDown('handbrake') && vForward > 2;

    if (throttle > 0) {
      vForward += CAR.engineForce * dt;
    } else if (throttle < 0) {
      if (vForward > 0.4) vForward -= CAR.brakeForce * dt;
      else vForward -= CAR.reverseForce * dt;
    } else {
      vForward -= Math.sign(vForward) * Math.min(Math.abs(vForward), CAR.rollResist * dt);
    }
    if (this.handbrake) {
      vForward -= Math.sign(vForward) * Math.min(Math.abs(vForward), CAR.brakeForce * 0.72 * dt);
    }
    vForward -= vForward * CAR.drag * dt;
    vForward = clamp(vForward, -12, CAR.topSpeed);

    const steerInput = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
    const steerLimit = CAR.maxSteer * (0.32 + 0.68 / (1 + Math.abs(vForward) * 0.05));
    this.steer = damp(this.steer, steerInput * steerLimit, 8, dt);
    if (Math.abs(vForward) > 0.15) {
      const turn = (vForward / CAR.wheelBase) * Math.tan(this.steer) * 0.56;
      this.heading += turn * dt;
    }

    const grip = this.handbrake ? CAR.driftGrip : CAR.grip;
    vLateral *= Math.exp(-grip * dt);

    const newForwardX = -Math.sin(this.heading);
    const newForwardZ = -Math.cos(this.heading);
    const newRightX = Math.cos(this.heading);
    const newRightZ = -Math.sin(this.heading);
    this.vx = newForwardX * vForward + newRightX * vLateral;
    this.vz = newForwardZ * vForward + newRightZ * vLateral;
    this.forwardSpeed = vForward;

    this.position.x += this.vx * dt;
    this.position.z += this.vz * dt;

    const hit = this.resolveCollisions();
    if (hit) {
      const vn = this.vx * hit.x + this.vz * hit.z;
      if (vn < 0) {
        this.vx -= hit.x * vn * 1.32;
        this.vz -= hit.z * vn * 1.32;
        this.vx *= 0.86;
        this.vz *= 0.86;
        this.forwardSpeed *= 0.6;
      }
    }

    const ground = this.groundUnderCar();
    this.position.y = damp(this.position.y, ground, 18, dt);

    const accel = (vForward - previousForward) / Math.max(dt, 1e-4);
    this.suspensionVelocity += (-CAR.suspension * this.suspension - CAR.damping * this.suspensionVelocity - accel * 0.0025) * dt;
    this.suspension += this.suspensionVelocity * dt;
    this.suspension = clamp(this.suspension, -0.09, 0.09);
    this.roll = damp(this.roll, clamp(-vLateral * 0.012 - this.steer * Math.min(1, Math.abs(vForward) / 8) * 0.045, -0.09, 0.09), 7, dt);
    this.pitch = damp(this.pitch, clamp(accel * 0.0018, -0.05, 0.05), 6, dt);
    this.wheelSpin += (vForward * dt) / this.spec.wheelRadius;
    this.brakeFade = throttle < 0 ? 1 : Math.max(0, this.brakeFade - dt * 3.2);

    this.animate(dt);
    this.applyPose(1);
  }

  resolveCollisions() {
    const forwardX = -Math.sin(this.heading);
    const forwardZ = -Math.cos(this.heading);
    let contact = null;
    for (const offset of [-1.35, 0, 1.35]) {
      const sample = {
        x: this.position.x + forwardX * offset,
        z: this.position.z + forwardZ * offset,
      };
      const hit = this.collision.resolve(sample, 0.88, { maxStep: 0.05, kinds: null });
      if (hit) {
        this.position.x += sample.x - (this.position.x + forwardX * offset);
        this.position.z += sample.z - (this.position.z + forwardZ * offset);
        contact = hit;
      }
    }
    return contact;
  }

  groundUnderCar() {
    let height = -Infinity;
    for (const side of [-1, 1]) {
      for (const axle of [-1, 1]) {
        const x = this.position.x + Math.cos(this.heading) * side * this.spec.width * 0.48 - Math.sin(this.heading) * axle * this.spec.wheelBase;
        const z = this.position.z - Math.sin(this.heading) * side * this.spec.width * 0.48 - Math.cos(this.heading) * axle * this.spec.wheelBase;
        height = Math.max(height, this.plan.groundHeight(x, z));
      }
    }
    return height;
  }

  animate(dt) {
    this.bodyGroup.position.y = 0.02 + this.suspension;
    this.bodyGroup.rotation.z = damp(this.bodyGroup.rotation.z, this.roll, 10, dt);
    this.bodyGroup.rotation.x = damp(this.bodyGroup.rotation.x, this.pitch, 8, dt);
    for (const wheel of this.wheels) {
      wheel.tyre.rotation.x = this.wheelSpin;
      wheel.group.rotation.y = wheel.front ? this.steer * 0.9 : 0;
    }
    const braking = this.forwardSpeed < -0.2 || this.handbrake || this.brakeFade > 0.05;
    this.setTail(braking ? 1 : 0.3);
  }

  applyPose(alpha) {
    this.root.position.set(
      lerp(this.prev.x, this.position.x, alpha),
      lerp(this.prev.y, this.position.y, alpha),
      lerp(this.prev.z, this.position.z, alpha),
    );
    const delta = ((this.heading - this.prevHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.root.rotation.y = this.prevHeading + delta * alpha;
  }

  cameraTarget() {
    return { x: this.position.x, y: this.position.y + 1.15, z: this.position.z };
  }

  speedKmh() {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  poseParked(x, z, heading) {
    this.reset(x, z, heading);
    this.suspension = 0;
    this.suspensionVelocity = 0;
    this.roll = 0;
    this.pitch = 0;
    this.bodyGroup.position.y = 0.02;
    this.bodyGroup.rotation.set(0, 0, 0);
    this.setTail(0.3);
    this.applyPose(1);
  }
}

/** Local merge for the coachline strips, which carry per-part colours only. */
function coachline(stations, y, height, thickness, color) {
  const positions = [];
  const colors = [];
  const tint = new THREE.Color(color);
  const quad = (a, b, c, d) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i += 1) colors.push(tint.r, tint.g, tint.b);
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < stations.length - 1; i += 1) {
      const a = stations[i];
      const b = stations[i + 1];
      const xa = side * (a.w - 0.012);
      const xb = side * (b.w - 0.012);
      quad([xa, y, a.z], [xb, y, b.z], [xb, y + height, b.z], [xa, y + height, a.z]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mergeParts(parts) {
  let total = 0;
  const prepared = [];
  for (const part of parts) {
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    prepared.push({ source, count: source.getAttribute('position').count, color: part.color });
    total += prepared[prepared.length - 1].count;
  }
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  let offset = 0;
  for (const { source, count, color: tint } of prepared) {
    position.set(source.getAttribute('position').array, offset * 3);
    const nrm = source.getAttribute('normal');
    if (nrm) normal.set(nrm.array, offset * 3);
    const c = new THREE.Color(tint ?? 0xffffff);
    for (let i = 0; i < count; i += 1) {
      color[(offset + i) * 3] = c.r;
      color[(offset + i) * 3 + 1] = c.g;
      color[(offset + i) * 3 + 2] = c.b;
    }
    offset += count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.computeBoundingSphere();
  return merged;
}
