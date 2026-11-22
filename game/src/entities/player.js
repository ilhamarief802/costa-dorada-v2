// The player: a compact procedural humanoid with a two-part walk/run cycle, camera-relative
// movement, sprint, crouch, jump, and collision against the city's boxes.

import { PLAYER, ART } from '../core/config.js';
import { clamp, damp, dampAngle, lerp } from '../core/math.js';

function material(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export default class Player {
  constructor(scene, plan, rng, collision) {
    this.plan = plan;
    this.collision = collision;
    this.position = { x: plan.playerStart.x, y: plan.groundHeight(plan.playerStart.x, plan.playerStart.z), z: plan.playerStart.z };
    this.prev = { ...this.position };
    this.velocity = { x: 0, z: 0 };
    this.verticalSpeed = 0;
    this.grounded = true;
    this.heading = 0;
    this.prevHeading = 0;
    this.phase = 0;
    this.amplitude = 0;
    this.crouchAmount = 0;
    this.crouching = false;
    this.sprinting = false;
    this.speed = 0;
    this.hidden = false;

    this.build(rng);
    scene.add(this.root);
    this.applyPose(1);
  }

  build(rng) {
    const skin = material(rng.pick(ART.skin), 0.72);
    const shirt = material(rng.pick(ART.shirt), 0.9);
    const trousers = material(rng.pick(ART.trousers), 0.94);
    const hair = material(rng.pick(ART.hair), 0.96);
    const shoe = material(0x22201d, 0.8);
    const accent = material(0xd2b06a, 0.5, 0.3);

    this.root = new THREE.Group();
    this.root.name = 'player';
    this.rig = new THREE.Group();
    this.root.add(this.rig);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.27), shirt);
    torso.position.y = 1.18;
    torso.castShadow = true;
    this.rig.add(torso);

    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.3), material(0x2f5a55, 0.85));
    jacket.position.set(0, 1.26, -0.005);
    jacket.castShadow = true;
    this.rig.add(jacket);
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.31), shirt);
    lapel.position.set(0, 1.24, 0.002);
    this.rig.add(lapel);

    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.28), material(0x2b241f, 0.7));
    belt.position.y = 0.9;
    this.rig.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), accent);
    buckle.position.set(0, 0.9, 0.15);
    this.rig.add(buckle);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 8), skin);
    neck.position.y = 1.53;
    this.rig.add(neck);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.148, 14, 12), skin);
    this.head.position.y = 1.66;
    this.head.scale.set(0.94, 1.04, 0.96);
    this.head.castShadow = true;
    this.rig.add(this.head);

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.153, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    hairCap.position.set(0, 1.675, -0.012);
    hairCap.scale.set(1, 0.92, 1);
    hairCap.castShadow = true;
    this.rig.add(hairCap);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.05), skin);
    nose.position.set(0, 1.65, 0.145);
    this.rig.add(nose);

    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.29, 1.42, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.5, 0.13), material(0x2f5a55, 0.85));
      upper.position.y = -0.25;
      upper.castShadow = true;
      pivot.add(upper);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), skin);
      hand.position.y = -0.53;
      pivot.add(hand);
      this.rig.add(pivot);
      this.arms.push({ pivot, side });
    }

    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 0.92, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.82, 0.19), trousers);
      leg.position.y = -0.41;
      leg.castShadow = true;
      pivot.add(leg);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.3), shoe);
      boot.position.set(0, -0.85, 0.05);
      boot.castShadow = true;
      pivot.add(boot);
      this.rig.add(pivot);
      this.legs.push({ pivot, side });
    }

    this.rig.traverse((child) => {
      if (child.isMesh) child.receiveShadow = true;
    });
  }

  reset(x, z, heading = 0) {
    this.position.x = x;
    this.position.z = z;
    this.position.y = this.plan.groundHeight(x, z);
    this.prev = { ...this.position };
    this.heading = heading;
    this.prevHeading = heading;
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.verticalSpeed = 0;
    this.grounded = true;
    this.velocity.x = 0;
    this.applyPose(1);
  }

  update(dt, input, cameraYaw) {
    this.prev = { ...this.position };
    this.prevHeading = this.heading;

    const wantsCrouch = input.isDown('crouch');
    if (wantsCrouch !== this.crouching) this.crouching = wantsCrouch;
    this.crouchAmount = damp(this.crouchAmount, this.crouching ? 1 : 0, 10, dt);

    const yaw = cameraYaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    let moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    let moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    const moving = moveX !== 0 || moveZ !== 0;
    if (moving) {
      const length = Math.hypot(moveX, moveZ);
      moveX /= length;
      moveZ /= length;
    }

    this.sprinting = input.isDown('sprint') && !this.crouching;
    let maxSpeed = this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    if (!moving) maxSpeed = 0;
    const targetX = (forwardX * moveZ + rightX * moveX) * maxSpeed;
    const targetZ = (forwardZ * moveZ + rightZ * moveX) * maxSpeed;
    const rate = moving ? 12 : 16;
    this.velocity.x = damp(this.velocity.x, targetX, rate, dt);
    this.velocity.z = damp(this.velocity.z, targetZ, rate, dt);
    if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
    if (Math.abs(this.velocity.z) < 0.01) this.velocity.z = 0;

    const oldX = this.position.x;
    const oldZ = this.position.z;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const contact = this.collision.resolve(this.position, PLAYER.radius, { maxStep: 0.28 });
    if (contact) {
      const into = this.velocity.x * contact.x + this.velocity.z * contact.z;
      if (into < 0) {
        this.velocity.x -= contact.x * into * 1.05;
        this.velocity.z -= contact.z * into * 1.05;
      }
    }

    if (this.plan.isWater(this.position.x, this.position.z)) {
      this.position.x = oldX;
      this.position.z = oldZ;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    const ground = this.plan.groundHeight(this.position.x, this.position.z);
    if (this.grounded) {
      if (ground > this.position.y && ground - this.position.y <= 0.36) {
        this.position.y = ground;
      } else if (ground < this.position.y - 0.06) {
        if (this.position.y - ground <= 0.38) {
          this.position.y = ground;
        } else {
          this.grounded = false;
        }
      }
    }

    if (input.pressed('jump') && this.grounded && !this.crouching) {
      this.verticalSpeed = PLAYER.jumpSpeed;
      this.grounded = false;
    }

    if (!this.grounded) {
      this.verticalSpeed -= PLAYER.gravity * dt;
      this.position.y += this.verticalSpeed * dt;
      if (this.position.y <= ground) {
        this.position.y = ground;
        this.verticalSpeed = 0;
        this.grounded = true;
      }
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.speed > 0.35) {
      const target = Math.atan2(-this.velocity.x, -this.velocity.z);
      this.heading = dampAngle(this.heading, target, this.grounded ? 13 : 6, dt);
    }

    this.animate(dt);
    this.applyPose(1);
  }

  animate(dt) {
    const speedFactor = clamp(this.speed / PLAYER.sprintSpeed, 0, 1);
    const targetAmp = this.grounded ? clamp(this.speed / 2.6, 0, 1) * 0.95 : 0.25;
    this.amplitude = damp(this.amplitude, targetAmp, 9, dt);
    this.phase += this.speed * dt * 2.35;
    if (this.phase > Math.PI * 200) this.phase -= Math.PI * 200;

    const swing = Math.sin(this.phase) * this.amplitude;
    const swingOpp = Math.sin(this.phase + Math.PI) * this.amplitude;
    if (this.grounded) {
      this.legs[0].pivot.rotation.x = swing * 0.85;
      this.legs[1].pivot.rotation.x = swingOpp * 0.85;
      this.arms[0].pivot.rotation.x = swingOpp * 0.6;
      this.arms[1].pivot.rotation.x = swing * 0.6;
    } else {
      this.legs[0].pivot.rotation.x = damp(this.legs[0].pivot.rotation.x, 0.5, 10, dt);
      this.legs[1].pivot.rotation.x = damp(this.legs[1].pivot.rotation.x, -0.25, 10, dt);
      this.arms[0].pivot.rotation.x = damp(this.arms[0].pivot.rotation.x, -0.6, 10, dt);
      this.arms[1].pivot.rotation.x = damp(this.arms[1].pivot.rotation.x, -0.6, 10, dt);
    }

    this.arms[0].pivot.rotation.z = 0.08 + this.crouchAmount * 0.1;
    this.arms[1].pivot.rotation.z = -0.08 - this.crouchAmount * 0.1;

    const bob = Math.abs(Math.sin(this.phase)) * 0.045 * this.amplitude;
    this.rig.position.y = bob - this.crouchAmount * 0.12;
    this.rig.rotation.x = damp(this.rig.rotation.x, speedFactor * 0.09 + this.crouchAmount * 0.08, 8, dt);
    this.rig.scale.y = lerp(1, 0.86, this.crouchAmount);
  }

  applyPose(alpha) {
    const px = lerp(this.prev.x, this.position.x, alpha);
    const py = lerp(this.prev.y, this.position.y, alpha);
    const pz = lerp(this.prev.z, this.position.z, alpha);
    this.root.position.set(px, py, pz);
    let delta = ((this.heading - this.prevHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.root.rotation.y = this.prevHeading + delta * alpha;
  }

  eyeHeight() {
    return lerp(PLAYER.eyeHeight, 1.22, this.crouchAmount);
  }

  cameraTarget() {
    return { x: this.position.x, y: this.position.y + this.eyeHeight(), z: this.position.z };
  }

  cameraYaw() {
    return this.heading;
  }

  setVisible(visible) {
    this.root.visible = visible;
    this.hidden = !visible;
  }

  /** A neutral, mid-stride stance for authored shots. */
  poseIdle(heading, phase = 0.6) {
    this.prevHeading = heading;
    this.heading = heading;
    this.phase = phase;
    this.amplitude = 0;
    this.crouchAmount = 0;
    this.rig.rotation.x = 0;
    this.rig.scale.y = 1;
    this.legs[0].pivot.rotation.x = 0.04;
    this.legs[1].pivot.rotation.x = -0.04;
    this.arms[0].pivot.rotation.x = 0;
    this.arms[1].pivot.rotation.x = 0;
    this.rig.position.y = 0;
    this.applyPose(1);
  }
}
