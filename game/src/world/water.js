// Ocean and marina water: one cheap shader with a horizon gradient, rolling bands and a warm
// specular path toward the sun. No textures, no reflections, no draw-call per wave.

import { CITY } from '../core/config.js';

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uNight;
  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
  }

  void main() {
    vec2 p = vWorld.xz;
    float wave = sin(p.x * 0.11 + uTime * 1.1) * 0.5
               + sin(p.y * 0.07 - uTime * 0.8 + p.x * 0.03) * 0.35
               + sin((p.x + p.y) * 0.045 + uTime * 0.6) * 0.25;
    float crest = smoothstep(0.35, 1.05, wave);

    vec3 normal = normalize(vec3(
      cos(p.x * 0.11 + uTime * 1.1) * 0.07,
      1.0,
      cos(p.y * 0.07 - uTime * 0.8) * 0.06
    ));

    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.2);
    vec3 color = mix(uDeep, uShallow, 0.25 + crest * 0.5);
    color = mix(color, uSky, fresnel * 0.55);

    vec3 reflected = reflect(-uSunDir, normal);
    float spec = pow(max(dot(reflected, viewDir), 0.0), 120.0);
    float glitter = pow(max(dot(reflected, viewDir), 0.0), 18.0) * 0.22;
    color += uSun * (spec * (1.5 - uNight * 0.8) + glitter);

    float sparkle = step(0.982, hash(floor(p * 2.6) + floor(uTime * 1.4)));
    color += uSun * sparkle * crest * 0.35 * (1.0 - uNight * 0.6);

    float dist = length(cameraPosition - vWorld);
    float fog = smoothstep(uFogNear, uFogFar, dist);
    color = mix(color, uFog, fog);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default class Water {
  constructor() {
    this.time = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x0b2f3d) },
        uShallow: { value: new THREE.Color(0x2a7380) },
        uSky: { value: new THREE.Color(0xd9a377) },
        uSun: { value: new THREE.Color(0xffd2a0) },
        uSunDir: { value: new THREE.Vector3(-0.8, 0.2, 0.3).normalize() },
        uFog: { value: new THREE.Color(0xdcae8c) },
        uFogNear: { value: 80 },
        uFogFar: { value: 780 },
        uNight: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      fog: false,
    });
    this.group = new THREE.Group();
    this.group.name = 'water';

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1400), this.material);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, CITY.waterLevel, 970);
    ocean.receiveShadow = false;
    this.group.add(ocean);

    const basin = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY.marina.x1 - CITY.marina.x0, CITY.marina.z1 - CITY.marina.z0),
      this.material,
    );
    basin.rotation.x = -Math.PI / 2;
    basin.position.set(
      (CITY.marina.x0 + CITY.marina.x1) / 2,
      CITY.waterLevel + 0.014,
      (CITY.marina.z0 + CITY.marina.z1) / 2,
    );
    this.group.add(basin);
  }

  apply(palette, night) {
    const uniforms = this.material.uniforms;
    uniforms.uDeep.value.set(night ? 0x04131d : 0x0b2f3d);
    uniforms.uShallow.value.set(night ? 0x11394b : 0x2d7f8a);
    uniforms.uSky.value.set(palette.fog);
    uniforms.uSun.value.set(palette.sun);
    uniforms.uFog.value.set(palette.fog);
    uniforms.uFogNear.value = palette.fogNear;
    uniforms.uFogFar.value = palette.fogFar;
    uniforms.uNight.value = night ? 1 : 0;
  }

  setSunDirection(direction) {
    this.material.uniforms.uSunDir.value.copy(direction);
  }

  update(dt) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }
}
