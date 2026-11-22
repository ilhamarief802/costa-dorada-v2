// Sky dome, sun and moon, the star field, and the scene's one shadow-casting light.
//
// The dome is a gradient shader with a sun disc, a haze band and a horizon glow. The stars are a
// real point cloud — THREE.Points with a small circular sprite and size attenuation — rather than
// squares computed inside the dome shader, because a shader hash gives axis-aligned cells of
// uniform size, which is exactly what reads as "big white cubes". The moon is a lit sphere with a
// soft halo, placed opposite the sun so a night frame has a subject in the sky.
//
// Everything moves with the camera target, so the dome, the stars and the moon keep their bearings
// no matter where the player is.

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

  // Triangular-PDF dither: +-1/255 of a step, decorrelated per pixel, which breaks the banding
  // a smooth wide gradient shows at 8 bits without visibly graining the sky.
  float dither(vec2 p) {
    return (hash(p) + hash(p + 41.7) - 1.0) / 255.0;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);

    vec3 color = mix(uHorizon, uMid, smoothstep(0.0, 0.14, h));
    color = mix(color, uTop, smoothstep(0.10, 0.58, h));

    float sunAmount = max(dot(d, uSunDir), 0.0);
    float disc = smoothstep(0.99955, 0.9999, sunAmount);
    float halo = pow(sunAmount, 9.0) * 0.55 + pow(sunAmount, 90.0) * 0.8;
    // The sun sinks below the horizon at night; keep its glow from lighting the whole dome.
    color += uSun * (disc * 2.2 + halo) * (uNight > 0.5 ? 0.08 : 1.0);

    // Haze band: a wide, low belt of warm air stacked over the horizon.
    float band = sin(atan(d.z, d.x) * 2.0 + d.y * 26.0) * 0.5 + 0.5;
    color += uHorizon * band * uHaze * smoothstep(0.0, 0.10, h) * (1.0 - smoothstep(0.10, 0.32, h)) * 0.35;
    float horizonGlow = pow(1.0 - smoothstep(0.0, 0.24, abs(h - 0.035)), 2.0);
    color += uHorizon * horizonGlow * (uNight > 0.5 ? 0.16 : 0.42);

    // A faint band of milky light low in the sky, so the night is not one flat colour.
    if (uNight > 0.5) {
      float milky = pow(1.0 - abs(h - 0.22), 8.0) * 0.5;
      color += vec3(0.16, 0.18, 0.30) * milky;
    }

    if (h < 0.0) color = mix(color, uHorizon * 0.55, smoothstep(0.0, -0.18, h));
    color += dither(gl_FragCoord.xy);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starVertexShader = /* glsl */ `
  attribute float starSize;
  attribute vec3 starColor;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = starColor;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    // Size attenuation by hand, so each star can have its own apparent size: a fixed sprite size
    // over an 880 m shell would be a fraction of a pixel, which is why the old shader cubes read
    // as the only stars at all.
    gl_PointSize = clamp(starSize * (uScale / -view.z), 1.4, 7.0);
    gl_Position = projectionMatrix * view;
  }
`;

const starFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    // Circular falloff from the sprite; anything outside the disc is discarded so a point is a
    // round grain of light, never a quad.
    vec4 sprite = texture2D(uMap, gl_PointCoord);
    if (sprite.a < 0.02) discard;
    gl_FragColor = vec4(vColor * sprite.rgb, sprite.a * uOpacity);
  }
`;

/** A tiny round sprite: a white core that fades to nothing by the rim of its 32 px cell. */
function starTexture() {
  const size = 32;
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const ctx = element.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.58, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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

    this.starField = this.buildStars();
    scene.add(this.starField);

    this.moon = this.buildMoon();
    scene.add(this.moon);

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
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.camera.left = -38;
    this.sun.shadow.camera.right = 38;
    this.sun.shadow.camera.top = 38;
    this.sun.shadow.camera.bottom = -38;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.00022;
    this.sun.shadow.normalBias = 0.05;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun);
    scene.add(this.sun.target);

    // A fill from the opposite side, cool and weak: this is the rim that keeps the hero's shaded
    // flank from going to flat black.
    this.rim = new THREE.DirectionalLight(0xffe2b8, 0.5);
    this.rim.position.set(80, 26, -150);
    this.rim.castShadow = false;
    scene.add(this.rim);
    this.rim.target.position.set(0, 1, 0);
    scene.add(this.rim.target);

    this.hemi = new THREE.HemisphereLight(0xffd6b0, 0x5c4234, 0.62);
    scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0x7794c6, 0.22);
    this.fill.position.set(120, 80, 150);
    scene.add(this.fill);

    this.sunDir = new THREE.Vector3(-0.8, 0.2, 0.3).normalize();
    // The moon sits over the north-east shoulder of the boulevard, high enough to clear every
    // rooftop and clear of the hero — a night frame with no subject in the sky reads as a bug.
    this.moonDir = new THREE.Vector3(0.44, 0.26, -0.86).normalize();
    this.night = false;
  }

  /**
   * The star field. Points are distributed on an upper hemisphere shell with a random radius so
   * they do not read as a sphere, sized in the sprite rather than in the geometry, and given
   * per-star brightness so a few read bright and most are faint. `sizeAttenuation` keeps them
   * sub-pixel at the dome distance, which is what stops them becoming cubes again.
   */
  buildStars() {
    const count = 2600;
    const radius = 880;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    // Deterministic: the same seed always paints the same sky.
    let state = 0x2f6d70;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < count; i += 1) {
      // Cosine-weighted over the hemisphere: a dense zenith, thinning toward the horizon.
      const u = rand();
      const y = Math.pow(u, 0.62);
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const reach = radius * (0.92 + rand() * 0.16);
      positions[i * 3] = Math.cos(phi) * r * reach;
      positions[i * 3 + 1] = y * reach;
      positions[i * 3 + 2] = Math.sin(phi) * r * reach;
      // Most stars are faint and slightly warm; a handful are bright and blue-white.
      const bright = rand();
      const warm = 0.82 + rand() * 0.18;
      const level = bright > 0.94 ? 1.0 : bright > 0.72 ? 0.62 : 0.3;
      colors[i * 3] = level * warm;
      colors[i * 3 + 1] = level * (0.94 + rand() * 0.06);
      colors[i * 3 + 2] = level;
      sizes[i] = bright > 0.94 ? 3.1 : bright > 0.72 ? 2.3 : 1.7;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: starTexture() },
        uOpacity: { value: 0 },
        uScale: { value: 1750 },
      },
      vertexShader: starVertexShader,
      fragmentShader: starFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -8;
    points.name = 'stars';
    this.starMaterial = material;
    this.starSizes = sizes;
    return points;
  }

  /** A moon disc: a lit sphere with a soft halo, on the opposite side of the sky to the sun. */
  buildMoon() {
    const group = new THREE.Group();
    group.name = 'moon';
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(26, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xf4ecd8, toneMapped: false, fog: false }),
    );
    group.add(globe);
    const scale = new THREE.Mesh(
      new THREE.SphereGeometry(26.3, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xd8ceb6, transparent: true, opacity: 0.28, toneMapped: false, fog: false }),
    );
    scale.scale.set(0.86, 0.72, 0.86);
    scale.position.set(4, 3, -3);
    group.add(scale);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.assetsGlow(),
        color: 0xd6e2ff,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    );
    halo.scale.setScalar(260);
    group.add(halo);
    group.visible = false;
    group.frustumCulled = false;
    this.moonGlobe = globe;
    this.moonHalo = halo;
    return group;
  }

  /** The glow sprite used for the moon halo; built lazily because the constructor order varies. */
  assetsGlow() {
    if (!this._glow) {
      const size = 128;
      const element = document.createElement('canvas');
      element.width = size;
      element.height = size;
      const ctx = element.getContext('2d');
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(230,240,255,0.85)');
      gradient.addColorStop(0.3, 'rgba(200,215,255,0.32)');
      gradient.addColorStop(0.7, 'rgba(170,190,255,0.08)');
      gradient.addColorStop(1, 'rgba(160,180,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      this._glow = new THREE.CanvasTexture(element);
      this._glow.colorSpace = THREE.SRGBColorSpace;
    }
    return this._glow;
  }

  apply(palette, night) {
    this.night = night;
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

    // The stars and the moon only exist after dark, and come up rather than snapping on.
    this.starMaterial.uniforms.uOpacity.value = night ? 0.95 : 0.0;
    this.starField.visible = night;
    this.moon.visible = night;
    this.moonHalo.material.opacity = night ? 0.34 : 0;
  }

  /** Keep the dome, the star field, the moon and the shadow frustum around the player. */
  follow(target) {
    this.sun.target.position.copy(target);
    this.sun.target.position.y = 0;
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 170);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.dome.position.set(target.x, 0, target.z);
    this.starField.position.set(target.x, 0, target.z);
    this.starField.rotation.y = 0;
    this.moon.position.set(target.x + this.moonDir.x * 700, 0 + this.moonDir.y * 700, target.z + this.moonDir.z * 700);
    this.sunSprite.position.set(target.x, 0, target.z).addScaledVector(this.sunDir, 760);
    // The rim light sits opposite the sun, low, so it grazes the hero's far side.
    this.rim.position.set(target.x - this.sunDir.x * 120, 26, target.z - this.sunDir.z * 120 + 40);
    this.rim.target.position.copy(target);
    this.rim.target.position.y = 1;
    this.rim.target.updateMatrixWorld();
  }

  update(dt, target) {
    this.follow(target);
  }
}
