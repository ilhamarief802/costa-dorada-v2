// Shared car materials. The glass is a small custom shader: a dark interior tint at grazing cell
// angles mixed toward the sky colour by Fresnel, plus a hard sun glint and a soft sky band across
// the top of the pane, so a windscreen reads as reflecting a sunset instead of as a black slab.
// Everything here is created once and toggled together when the sun goes down.

export const GLASS_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const GLASS_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uSky;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uTintPower;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.6);

    // Sky reflection: the pane picks up the sky it faces, but the tint is what keeps it glass and
    // not a warm slab — a windscreen is mostly dark with a bright band, not uniformly sky.
    float lift = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = uSky * (0.34 + lift * 0.5);

    // Interior: dark, with a hint of the dashboard colour at the bottom of the pane.
    vec3 interior = uTint * (0.34 + 0.4 * uTintPower);

    // Fresnel drives the reflection: at grazing angles the sky wins, head-on the interior does.
    float reflectivity = clamp(fresnel * 1.55, 0.0, 0.86);
    vec3 colour = mix(interior, sky, reflectivity);
    // A horizontal sheen across the upper third of every pane reads as a reflected skyline.
    colour += sky * smoothstep(0.55, 1.0, lift) * 0.16;

    // A warm specular band from the sun, tight enough to read as a highlight across the glass.
    vec3 reflected = reflect(-v, n);
    float glint = pow(max(dot(reflected, uSunDir), 0.0), 62.0);
    colour += uSun * glint * (uNight > 0.5 ? 0.5 : 1.9);

    colour += uSun * pow(max(dot(reflected, uSunDir), 0.0), 8.0) * 0.06;

    gl_FragColor = vec4(colour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const glassMaterials = [];

export function makeGlassMaterial({ tint = 0x0d2028, sky = 0xd9a377, sun = 0xffd2a0, tintPower = 1 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(tint) },
      uSky: { value: new THREE.Color(sky) },
      uSun: { value: new THREE.Color(sun) },
      uSunDir: { value: new THREE.Vector3(0, 0.4, 1).normalize() },
      uNight: { value: 0 },
      uTintPower: { value: tintPower },
    },
    vertexShader: GLASS_VERTEX,
    fragmentShader: GLASS_FRAGMENT,
    fog: false,
  });
  glassMaterials.push(material);
  return material;
}

export function setGlassSky({ sky, sun, sunDir, night }) {
  for (const material of glassMaterials) {
    const uniforms = material.uniforms;
    uniforms.uSky.value.set(sky);
    uniforms.uSun.value.set(sun);
    if (sunDir) uniforms.uSunDir.value.copy(sunDir);
    uniforms.uNight.value = night ? 1 : 0;
    uniforms.uTint.value.set(night ? 0x0a1620 : 0x10202a);
  }
}

/** Chrome and paint. Both are plain standard materials; kept together so the night pass can find them. */
export function makePaintMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.42 });
}

export function makeChromeMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.19, metalness: 0.92 });
}

export function makeTrimDarkMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.35 });
}

export function makeTyreMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.95, metalness: 0.02 });
}

export function makeRimMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xc2bcae, roughness: 0.28, metalness: 0.95 });
}
