// Third-person camera: over-the-shoulder on foot, a wide chase while driving. Mouse look feeds
// yaw and pitch, a critically damped spring smooths the rig, and a ray pull-in keeps walls
// from cutting through the lens.

import { CAMERA } from '../core/config.js';
import { clamp, damp, lerp } from '../core/math.js';

export default class FollowCamera {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.yaw = 0.06;
    this.pitch = 0.14;
    this.distance = CAMERA.distance;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.fov = CAMERA.fov;
    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.prevTarget = new THREE.Vector3();
    this.initialized = false;
    this.mode = 'foot';
    this.pivot = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.shoulder = new THREE.Vector3();
  }

  update(dt, actor, mode, input) {
    const look = input ? input.consumeLook() : { x: 0, y: 0 };
    const switched = mode !== this.mode;
    this.mode = mode;

    const target = actor.cameraTarget();
    this.prevPosition.copy(this.position);
    this.prevTarget.copy(this.target);

    if (mode === 'foot') {
      this.yaw -= look.x * CAMERA.sensitivity;
      this.pitch = clamp(this.pitch - look.y * CAMERA.sensitivity, CAMERA.pitchMin, CAMERA.pitchMax);
      this.orbitYaw = damp(this.orbitYaw, 0, 6, dt);
      this.distance = damp(this.distance, CAMERA.distance, switched ? 20 : 8, dt);
      this.pivot.set(target.x, target.y, target.z);
      this.shoulder.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(CAMERA.shoulder);
      this.pivot.add(this.shoulder);
    } else {
      const heading = actor.heading ?? 0;
      this.orbitYaw -= look.x * CAMERA.sensitivity * 0.8;
      this.orbitYaw = clamp(this.orbitYaw, -1.1, 1.1);
      this.orbitPitch = clamp(this.orbitPitch - look.y * CAMERA.sensitivity * 0.6, -0.22, 0.35);
      if (Math.abs(actor.forwardSpeed ?? 0) > 3) this.orbitYaw = damp(this.orbitYaw, 0, 1.6, dt);
      this.yaw = heading + this.orbitYaw;
      this.pitch = damp(this.pitch, CAMERA.chasePitch + this.orbitPitch, 5, dt);
      this.distance = damp(this.distance, CAMERA.chaseDistance, switched ? 10 : 4.5, dt);
      this.pivot.set(target.x, target.y + 0.55, target.z);
    }

    const cosPitch = Math.cos(this.pitch);
    this.direction.set(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    );
    this.desired.copy(this.pivot).addScaledVector(this.direction, this.distance);

    const ray = this.desired.clone().sub(this.pivot);
    const length = ray.length();
    if (length > 0.001) {
      ray.multiplyScalar(1 / length);
      const hit = this.collision.rayHit(this.pivot, ray, length, 2.4);
      if (hit < length) {
        this.desired.copy(this.pivot).addScaledVector(ray, Math.max(0.45, hit - 0.28));
      }
    }

    if (!this.initialized || switched) {
      this.position.copy(this.desired);
      this.target.copy(this.pivot);
      this.initialized = true;
    } else {
      const rate = mode === 'car' ? 9 : CAMERA.spring;
      this.position.lerp(this.desired, 1 - Math.exp(-rate * dt));
      this.target.lerp(this.pivot, 1 - Math.exp(-14 * dt));
    }

    const pull = this.target.clone();
    const back = this.position.clone().sub(pull);
    const backLength = back.length();
    if (backLength > 0.01) {
      back.multiplyScalar(1 / backLength);
      const blocked = this.collision.rayHit(pull, back, backLength, 2.0);
      if (blocked < backLength) {
        this.position.copy(pull).addScaledVector(back, Math.max(0.4, blocked - 0.22));
      }
    }

    const targetFov = mode === 'car' ? 66 : CAMERA.fov;
    this.fov = damp(this.fov, targetFov, 4, dt);
  }

  setPose(position, target, fov = CAMERA.fov) {
    this.position.set(position.x, position.y, position.z);
    this.prevPosition.copy(this.position);
    this.target.set(target.x, target.y, target.z);
    this.prevTarget.copy(this.target);
    this.pivot.copy(this.target);
    this.fov = fov;
    this.initialized = true;
    this.apply(1);
  }

  apply(alpha) {
    this.camera.position.set(
      lerp(this.prevPosition.x, this.position.x, alpha),
      lerp(this.prevPosition.y, this.position.y, alpha),
      lerp(this.prevPosition.z, this.position.z, alpha),
    );
    const tx = lerp(this.prevTarget.x, this.target.x, alpha);
    const ty = lerp(this.prevTarget.y, this.target.y, alpha);
    const tz = lerp(this.prevTarget.z, this.target.z, alpha);
    this.camera.lookAt(tx, ty, tz);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  snapToActor(actor, mode) {
    this.mode = mode;
    const target = actor.cameraTarget();
    this.yaw = mode === 'car' ? (actor.heading ?? 0) : this.yaw;
    this.pitch = mode === 'car' ? CAMERA.chasePitch : 0.14;
    this.distance = mode === 'car' ? CAMERA.chaseDistance : CAMERA.distance;
    this.pivot.set(target.x, target.y, target.z);
    const cosPitch = Math.cos(this.pitch);
    this.direction.set(Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), Math.cos(this.yaw) * cosPitch);
    this.position.copy(this.pivot).addScaledVector(this.direction, this.distance);
    this.prevPosition.copy(this.position);
    this.target.copy(this.pivot);
    this.prevTarget.copy(this.target);
    this.initialized = true;
  }
}
