// Soft contact shadows. One instanced quad per body, with a radial falloff computed in the shader
// rather than sampled from a texture: a car, a pedestrian or a bench reads as touching the ground
// even where the sun's shadow map has run out of resolution. Static props claim a slot once;
// moving bodies rewrite theirs every frame.

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    // Elliptical falloff, squared so the core is dense and the rim is invisible.
    vec2 d = (vUv - 0.5) * 2.0;
    float r = length(d);
    float falloff = 1.0 - smoothstep(0.24, 1.0, r);
    falloff *= falloff;
    float alpha = falloff * uStrength;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export default class Blobs {
  constructor(scene, assets, capacity = 460) {
    void assets;
    this.capacity = capacity;
    this.used = 0;
    this.dirty = false;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x0b0805) },
        uStrength: { value: 0.92 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'contact-shadows';
    this.dummy = new THREE.Object3D();
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i += 1) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  /** Reserve a permanent slot and write it once. */
  claim(x, y, z, size = 1.6, strength = 0.3) {
    const index = this.used;
    if (index >= this.capacity) return -1;
    this.used += 1;
    this.write(index, x, y, z, size, strength);
    return index;
  }

  write(index, x, y, z, size) {
    if (index < 0 || index >= this.capacity) return;
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(size, 1, size);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.dirty = true;
  }

  hide(index) {
    this.write(index, 0, -400, 0, 0.0001);
  }

  setNight(night) {
    this.material.uniforms.uStrength.value = night ? 0.62 : 0.92;
  }

  commit() {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }
}
