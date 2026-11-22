// Soft elliptical contact shadows: a transparent ground quad per body, carrying the radial-gradient
// canvas texture `assets.blob()` paints, written from the body's own pose every frame.
//
// A car or a pedestrian that meets the road on a hard edge reads as a sticker pasted onto the
// asphalt, whatever the paint looks like. The sun's shadow map cannot fix that: at 2048 px across
// a 84 m frustum one texel is ~4 cm, so the contact under a tyre is a stair-step and the ambient
// shadow that should anchor the body is simply missing.
//
// So every body writes its own quad: flat on the road, turned to the body's heading (an ellipse,
// longer along a car than across it), sampled from the radial ramp and multiplied down to shade.
// A tyre-dark core quad sits inside the outer one, so the four contact patches are the darkest
// part of the shadow — a car rests on its tyres, not on a soap bubble.
//
// One InstancedMesh for the whole street: one draw call, one texture, no per-frame allocation.
// Darkness is a per-instance attribute rather than instanceColor, because instanceColor multiplies
// the *colour* and this overlay's colour is black — the strength has to reach the alpha.

const vertexShader = /* glsl */ `
  attribute float aDark;
  varying vec2 vUv;
  varying float vDark;
  void main() {
    vUv = uv;
    vDark = aDark;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vDark;
  void main() {
    // The texture is a radial ramp: 1 at the centre, 0 at the rim, so the quad has no edge. The
    // ramp is used directly rather than squared, because squaring it shrinks the dark core to
    // about a third of the quad and the shadow then reads as one narrow smudge under the sills
    // instead of a body sitting on the road.
    float falloff = texture2D(uMap, vUv).a;
    float alpha = falloff * vDark * uOpacity;
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export default class Blobs {
  constructor(scene, assets, capacity = 720) {
    this.assets = assets;
    this.capacity = capacity;
    this.used = 0;
    this.dirty = false;
    this.night = false;

    // A plane whose own scale is the ellipse: one geometry serves a 4.6 m car and a 0.9 m
    // pedestrian without rebuilding anything.
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);

    this.dark = new Float32Array(capacity);
    const attribute = new THREE.InstancedBufferAttribute(this.dark, 1);
    attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aDark', attribute);
    this.darkAttribute = attribute;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: assets.blob() },
        uOpacity: { value: 1.5 },
        uColor: { value: new THREE.Color(0x05040a) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'contact-shadows';
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;

    this.dummy = new THREE.Object3D();
    this.dummy.position.set(0, -400, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i += 1) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.dark[i] = 0;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.darkAttribute.needsUpdate = true;
    scene.add(this.mesh);
  }

  /**
   * A shadow plane parented to one entity: a transparent quad carrying the radial-gradient canvas
   * texture, lying flat in the entity's own local frame, so it inherits the body's position *and*
   * its heading without a line of code per frame. Used for the two bodies that have a scene node
   * of their own (the hero coupe, the player on foot); the crowd is drawn through the instanced
   * mesh above, which is the same quad in the same material, batched.
   */
  attachPlane(parent, { width = 4.2, depth = 5.4, y = 0.07, strength = 0.9 } = {}) {
    const geometry = new THREE.PlaneGeometry(width, depth);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: this.assets.blob(),
      color: 0x080604,
      transparent: true,
      opacity: strength,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: true,
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = 'contact-shadow';
    plane.position.y = y;
    plane.renderOrder = 1;
    plane.receiveShadow = false;
    plane.castShadow = false;
    // The entity's own root is rotated to its heading, so the ellipse turns with it, and its
    // state is read by the audit: this is a plane, under the body, on the ground.
    plane.userData.contactShadow = true;
    parent.add(plane);
    this.planes = this.planes ?? [];
    this.planes.push({ plane, strength });
    return plane;
  }

  /** Reserve a permanent slot; the caller writes its pose from then on. */
  claim(x, y, z, size = 1.6, strength = 0.3) {
    const index = this.used;
    if (index >= this.capacity) return -1;
    this.used += 1;
    this.write(index, x, y, z, size, strength);
    return index;
  }

  /**
   * Place one shadow. `size` is the ellipse's across-the-body diameter, `heading` turns it to
   * follow the body, `aspect` stretches it along the heading (a car's shadow is longer than it is
   * wide) and `strength` is how dark this quad is allowed to get, 0..1.
   */
  write(index, x, y, z, size, strength = 0.4, heading = 0, aspect = 1) {
    if (index < 0 || index >= this.capacity) return;
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, heading, 0);
    this.dummy.scale.set(size, 1, size * aspect);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.dark[index] = Math.min(1, Math.max(0, strength));
    this.dirty = true;
  }

  hide(index) {
    if (index < 0 || index >= this.capacity) return;
    this.dummy.position.set(0, -400, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.dark[index] = 0;
    this.dirty = true;
  }

  setNight(night) {
    this.night = night;
    // After dark the sky fill is weaker but the streetlamp is directly overhead, so the contact
    // shadow softens and cools rather than disappearing: the eye still expects the anchor.
    this.material.uniforms.uOpacity.value = night ? 1.2 : 1.5;
    this.material.uniforms.uColor.value.set(night ? 0x04060c : 0x05040a);
    for (const entry of this.planes ?? []) {
      entry.plane.material.opacity = entry.strength * (night ? 0.78 : 1);
      entry.plane.material.color.set(night ? 0x060a12 : 0x080604);
    }
  }

  commit() {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.darkAttribute.needsUpdate = true;
    this.dirty = false;
  }
}
