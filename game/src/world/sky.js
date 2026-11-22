// Sky dome, sun glow and the scene's one shadow-casting light. The dome is a gradient shader
// with a sun disc, haze and procedural stars, so the horizon reads at any exposure.

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uHaze;
  varying vec3 vDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);

    vec3 color = mix(uHorizon, uMid, smoothstep(0.0, 0.14, h));
    color = mix(color, uTop, smoothstep(0.10, 0.58, h));

    float sunAmount = max(dot(d, uSunDir), 0.0);
    float disc = smoothstep(0.99955, 0.9999, sunAmount);
    float halo = pow(sunAmount, 9.0) * 0.55 + pow(sunAmount, 90.0) * 0.8;
    color += uSun * (disc * 2.2 + halo);

    float band = sin(atan(d.z, d.x) * 2.0 + d.y * 26.0) * 0.5 + 0.5;
    color += uHorizon * band * uHaze * smoothstep(0.0, 0.10, h) * (1.0 - smoothstep(0.10, 0.32, h)) * 0.35;
    float horizonGlow = pow(1.0 - smoothstep(0.0, 0.24, abs(h - 0.035)), 2.0);
    color += uHorizon * horizonGlow * (uNight > 0.5 ? 0.16 : 0.42);

    if (uNight > 0.5 && h > 0.02) {
      vec2 grid = floor(vec2(atan(d.z, d.x) * 90.0, d.y * 120.0));
      float seed = hash(grid);
      float star = step(0.986, seed) * smoothstep(0.02, 0.25, h);
      float twinkle = 0.65 + 0.35 * hash(grid + 7.0);
      color += vec3(0.85, 0.9, 1.0) * star * twinkle * 1.2;
    }

    if (h < 0.0) color = mix(color, uHorizon * 0.55, smoothstep(0.0, -0.18, h));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default class Sky {
  constructor(scene, assets) {
    this.scene = scene;
    this.uniforms = {
      uTop: { value: new THREE.Color(0x24466f) },
      uMid: { value: new THREE.Color(0x8d7f9c) },
      uHorizon: { value: new THREE.Color(0xffb27a) },
      uSun: { value: new THREE.Color(0xffd0a0) },
      uSunDir: { value: new THREE.Vector3(-0.8, 0.2, 0.3).normalize() },
      uNight: { value: 0 },
      uHaze: { value: 1 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 32, 18),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: assets.glow(),
        color: 0xffd6a0,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sunSprite.scale.setScalar(190);
    this.sunSprite.renderOrder = -9;
    scene.add(this.sunSprite);

    this.sun = new THREE.DirectionalLight(0xffb070, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -52;
    this.sun.shadow.camera.right = 52;
    this.sun.shadow.camera.top = 52;
    this.sun.shadow.camera.bottom = -52;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.035;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffd6b0, 0x5c4234, 0.62);
    scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0x7794c6, 0.22);
    this.fill.position.set(120, 80, 150);
    scene.add(this.fill);

    this.sunDir = new THREE.Vector3(-0.8, 0.2, 0.3).normalize();
  }

  apply(palette, night) {
    const uniforms = this.uniforms;
    uniforms.uTop.value.set(palette.skyTop);
    uniforms.uMid.value.set(palette.skyMid);
    uniforms.uHorizon.value.set(palette.horizon);
    uniforms.uSun.value.set(palette.sunDisc);
    uniforms.uNight.value = night ? 1 : 0;
    uniforms.uHaze.value = night ? 0.55 : 1;

    this.sun.color.set(palette.sun);
    this.sun.intensity = palette.sunIntensity;
    this.hemi.color.set(palette.hemiSky);
    this.hemi.groundColor.set(palette.hemiGround);
    this.hemi.intensity = palette.hemiIntensity;
    this.fill.color.set(palette.fill);
    this.fill.intensity = palette.fillIntensity;

    this.sunDir.set(0.0, night ? 0.62 : 0.36, night ? -0.34 : 1.0).normalize();
    uniforms.uSunDir.value.copy(this.sunDir);
    this.sunSprite.material.color.set(palette.sunDisc);
    this.sunSprite.material.opacity = night ? 0.35 : 0.9;
    this.sunSprite.scale.setScalar(night ? 70 : 190);
    this.sunSprite.visible = true;
  }

  /** Keep the shadow frustum around the player, never the whole city. */
  follow(target) {
    this.sun.target.position.copy(target);
    this.sun.target.position.y = 0;
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 170);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.dome.position.set(target.x, 0, target.z);
    this.sunSprite.position.set(target.x, 0, target.z).addScaledVector(this.sunDir, 760);
  }

  update(dt, target, sunDir) {
    this.follow(target);
  }
}
