// The hero coupe: a low teal fastback built from merged primitives, arcade physics with grip
// and drift, a sprung body, spinning and steering wheels, and headlights for the night.

import { CAR, CITY } from '../core/config.js';
import { clamp, damp, lerp, dampAngle } from '../core/math.js';
import { mergeGeometries } from '../core/geom.js';

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
    this.build();
    scene.add(this.root);
    this.applyPose(1);
  }

  build() {
    this.root = new THREE.Group();
    this.root.name = 'hero-car';
    this.bodyGroup = new THREE.Group();
    this.root.add(this.bodyGroup);

    const teal = 0x238a95;
    const cream = 0xf0e2c2;
    const parts = [];
    const add = (geometry, color, x, y, z) => {
      geometry.translate(x, y, z);
      parts.push({ geometry, color });
    };
    add(new THREE.BoxGeometry(1.88, 0.44, 4.2), teal, 0, 0.65, 0);
    add(new THREE.BoxGeometry(1.78, 0.3, 1.25), teal, 0, 0.84, -1.5);
    add(new THREE.BoxGeometry(1.58, 0.5, 2.0), 0x1a6d76, 0, 1.03, 0.16);
    add(new THREE.BoxGeometry(1.5, 0.08, 1.6), teal, 0, 1.3, -0.12);
    add(new THREE.BoxGeometry(1.9, 0.16, 0.2), 0xc9c4b6, 0, 0.44, -2.1);
    add(new THREE.BoxGeometry(1.9, 0.16, 0.2), 0xc9c4b6, 0, 0.44, 2.1);
    add(new THREE.BoxGeometry(1.52, 0.2, 0.08), 0x1d1f22, 0, 0.6, -2.11);
    add(new THREE.BoxGeometry(1.86, 0.08, 0.16), 0x24282b, 0, 0.42, 0);
    add(new THREE.BoxGeometry(0.15, 0.03, 4.5), cream, -0.2, 0.88, 0);
    add(new THREE.BoxGeometry(0.15, 0.03, 4.5), cream, 0.2, 0.88, 0);
    add(new THREE.BoxGeometry(0.14, 0.03, 1.8), cream, -0.2, 1.345, 0);
    add(new THREE.BoxGeometry(0.14, 0.03, 1.8), cream, 0.2, 1.345, 0);
    add(new THREE.BoxGeometry(1.46, 0.08, 1.0), 0x0d2630, 0, 1.13, -0.82);
    add(new THREE.BoxGeometry(1.46, 0.08, 0.75), 0x0d2630, 0, 1.14, 1.05);
    add(new THREE.BoxGeometry(0.07, 0.34, 1.35), 0x0d2630, -0.8, 1.08, 0.15);
    add(new THREE.BoxGeometry(0.07, 0.34, 1.35), 0x0d2630, 0.8, 1.08, 0.15);
    add(new THREE.BoxGeometry(0.18, 0.07, 0.24), 0x11575f, -0.93, 1.02, -0.55);
    add(new THREE.BoxGeometry(0.18, 0.07, 0.24), 0x11575f, 0.93, 1.02, -0.55);
    add(new THREE.BoxGeometry(0.38, 0.16, 0.06), 0xf6e6bd, 0, 0.55, 2.13);

    const bodyGeometry = mergeGeometries(parts);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.16,
    });
    this.body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.bodyGroup.add(this.body);

    // Sloped glass over the hood and fastback.
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x14323c, roughness: 0.18, metalness: 0.45 });
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.05, 1.05), glassMaterial);
    windshield.position.set(0, 1.16, -0.88);
    windshield.rotation.x = 0.38;
    windshield.castShadow = true;
    this.bodyGroup.add(windshield);
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.05, 0.82), glassMaterial);
    rearGlass.position.set(0, 1.17, 1.08);
    rearGlass.rotation.x = -0.34;
    this.bodyGroup.add(rearGlass);

    this.headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2cf, toneMapped: false });
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.05), this.headlightMaterial);
      lamp.position.set(side * 0.62, 0.73, -2.14);
      this.bodyGroup.add(lamp);
    }
    this.tailMaterial = new THREE.MeshBasicMaterial({ color: 0xd93b2a, toneMapped: false });
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.04), this.tailMaterial);
      lamp.position.set(side * 0.64, 0.78, 2.14);
      this.bodyGroup.add(lamp);
    }

    this.wheels = [];
    const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.35, metalness: 0.8 });
    for (const side of [-1, 1]) {
      for (const axle of [-1, 1]) {
        const group = new THREE.Group();
        group.position.set(side * 0.88, 0.37, axle * 1.36);
        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.26, 16), tyreMaterial);
        tyre.rotation.z = Math.PI / 2;
        tyre.castShadow = true;
        group.add(tyre);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.27, 12), rimMaterial);
        rim.rotation.z = Math.PI / 2;
        group.add(rim);
        this.root.add(group);
        this.wheels.push({ group, tyre, front: axle < 0 });
      }
    }

    this.headlightBeams = [];
    this.glowSprites = [];
    for (const side of [-1, 1]) {
      const light = new THREE.SpotLight(0xffe0b0, 0, 52, 0.5, 0.55, 1.4);
      light.position.set(side * 0.62, 0.8, -2.0);
      const target = new THREE.Object3D();
      target.position.set(side * 0.9, 0.1, -22);
      this.root.add(target);
      light.target = target;
      this.root.add(light);
      this.headlightBeams.push(light);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.assets.glow(),
          color: 0xffe9bd,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.position.set(side * 0.62, 0.73, -2.2);
      glow.scale.setScalar(1.1);
      this.bodyGroup.add(glow);
      this.glowSprites.push(glow);
    }

    this.fillLight = new THREE.PointLight(0xffcf9a, 0, 13, 2);
    this.fillLight.position.set(0, 1.6, 0);
    this.root.add(this.fillLight);

    this.root.traverse((child) => {
      if (child.isMesh) child.receiveShadow = true;
    });
  }

  setNight(night) {
    this.night = night;
    for (const light of this.headlightBeams) light.intensity = night ? 220 : 0;
    if (this.fillLight) this.fillLight.intensity = night ? 26 : 0;
    for (const glow of this.glowSprites) glow.material.opacity = night ? 0.75 : 0.08;
    this.headlightMaterial.color.set(night ? 0xfff4d6 : 0xf2e6c8);
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
    this.wheelSpin += (vForward * dt) / 0.37;

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
        const x = this.position.x + Math.cos(this.heading) * side * 0.88 - Math.sin(this.heading) * axle * 1.36;
        const z = this.position.z - Math.sin(this.heading) * side * 0.88 - Math.cos(this.heading) * axle * 1.36;
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
    this.tailMaterial.color.set(this.forwardSpeed < -0.2 || (this.handbrake && this.forwardSpeed > 1) ? 0xff5533 : 0xb82c20);
  }

  applyPose(alpha) {
    this.root.position.set(
      lerp(this.prev.x, this.position.x, alpha),
      lerp(this.prev.y, this.position.y, alpha),
      lerp(this.prev.z, this.position.z, alpha),
    );
    let delta = ((this.heading - this.prevHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.root.rotation.y = this.prevHeading + delta * alpha;
  }

  cameraTarget() {
    return { x: this.position.x, y: this.position.y + 1.15, z: this.position.z };
  }

  speedKmh() {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  /** Snap every moving part to rest for a captured frame. */
  poseParked(x, z, heading) {
    this.reset(x, z, heading);
    this.suspension = 0;
    this.suspensionVelocity = 0;
    this.roll = 0;
    this.pitch = 0;
    this.bodyGroup.position.y = 0.02;
    this.bodyGroup.rotation.set(0, 0, 0);
    this.tailMaterial.color.set(0x9c2a1e);
    this.applyPose(1);
  }
}
