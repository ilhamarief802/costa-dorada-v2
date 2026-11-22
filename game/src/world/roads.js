// The road network: asphalt drawn as one textured mesh with world-space UVs (so junctions never
// double-draw), a second wear sheet over the same quads for grain, then lane dashes, centre lines,
// stop bars, crosswalks, kerb stones and a dark gutter strip along every kerb as instances.
//
// The surface is layered the way a real carriageway is: binder, aggregate, then paint. Each layer
// is one mesh, so the whole street costs three draws rather than three per block, and the paint
// sits 3-5 cm proud of the asphalt with a polygon offset so it never z-fights at a distance.

import { CITY, SURFACE } from '../core/config.js';
import { mergeGeometries, makeInstances } from '../core/geom.js';

function roadQuad(x0, x1, z0, z1, scale = 9) {
  const positions = new Float32Array([
    x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1,
  ]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([
    x0 / scale, z0 / scale, x1 / scale, z0 / scale, x1 / scale, z1 / scale, x0 / scale, z1 / scale,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
}

export default class Roads {
  constructor(plan, assets) {
    this.plan = plan;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    this.buildSurface(assets);
    this.buildMarkings();
    this.buildCurbs();
  }

  /** Every carriageway quad, cut at the junction edges so a crossing never double-draws. */
  quads(scale) {
    const parts = [];
    for (const road of this.plan.roads) {
      if (road.axis !== 'x') continue;
      const z0 = road.z - road.d / 2;
      const z1 = road.z + road.d / 2;
      const x0 = road.x - road.w / 2;
      const x1 = road.x + road.w / 2;
      parts.push({ geometry: roadQuad(x0, x1, z0, z1, scale) });
    }
    for (const road of this.plan.roads) {
      if (road.axis !== 'z') continue;
      const x0 = road.x - road.w / 2;
      const x1 = road.x + road.w / 2;
      let z0 = road.z - road.d / 2;
      const z1 = road.z + road.d / 2;
      const cuts = [];
      for (const other of this.plan.roads) {
        if (other.axis === 'x') cuts.push([other.z - other.d / 2, other.z + other.d / 2]);
      }
      cuts.sort((a, b) => a[0] - b[0]);
      for (const cut of cuts) {
        const end = Math.min(cut[0], z1);
        if (end > z0 + 0.1) parts.push({ geometry: roadQuad(x0, x1, z0, end, scale) });
        z0 = Math.max(z0, cut[1]);
      }
      if (z1 > z0 + 0.1) parts.push({ geometry: roadQuad(x0, x1, z0, z1, scale) });
    }
    return parts;
  }

  buildSurface(assets) {
    // Binder: the tinted asphalt sheet, at a 9 m tile.
    const binder = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: assets.asphalt(),
      roughness: 0.72,
      metalness: 0.03,
    });
    const surface = new THREE.Mesh(mergeGeometries(this.quads(9)), binder);
    surface.position.y = 0.02;
    surface.receiveShadow = true;
    surface.name = 'asphalt';
    this.group.add(surface);

    // Aggregate: the grain sheet, over the same quads at a 2.6 m tile, so the two repeats never
    // beat against each other into a visible grid. Additive over the binder with a low opacity, it
    // is what gives the road a surface rather than a colour at 480 px.
    const grain = new THREE.MeshStandardMaterial({
      map: assets.grain(),
      transparent: true,
      opacity: 0.55,
      roughness: 0.95,
      metalness: 0.02,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    grain.map.repeat.set(1, 1);
    const wear = new THREE.Mesh(mergeGeometries(this.quads(2.6)), grain);
    wear.position.y = 0.026;
    wear.receiveShadow = false;
    wear.name = 'asphalt-grain';
    wear.renderOrder = 1;
    this.group.add(wear);
    this.grain = grain;

    // A faint wet sheen: the same quads again, a puddle mask multiplied additively into the
    // surface, only visible after dark when the streetlamps catch it. Off by day (opacity 0) so it
    // costs nothing in the golden-hour frames beyond the one draw.
    const wet = new THREE.MeshStandardMaterial({
      map: assets.wetness(),
      transparent: true,
      opacity: 0,
      roughness: 0.04,
      metalness: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const sheen = new THREE.Mesh(mergeGeometries(this.quads(5.5)), wet);
    sheen.position.y = 0.031;
    sheen.receiveShadow = false;
    sheen.name = 'asphalt-wet';
    sheen.renderOrder = 2;
    this.group.add(sheen);
    this.wet = wet;
    this.surface = surface;
  }

  buildMarkings() {
    const markings = { x: [], z: [] };
    const centres = { x: [], z: [] };
    const stops = { x: [], z: [] };
    const verticals = this.plan.roads.filter((road) => road.axis === 'z').map((road) => road.x);
    const horizontals = this.plan.roads.filter((road) => road.axis === 'x').map((road) => road.z);
    const near = (value, list, margin) => list.some((point) => Math.abs(value - point) < margin);

    for (const road of this.plan.roads) {
      if (road.axis === 'z') {
        for (let z = road.z - road.d / 2 + 5; z < road.z + road.d / 2 - 5; z += 9) {
          if (near(z, horizontals, 11)) continue;
          markings.z.push({ x: road.x, z, w: 0.22, d: 3.9 });
        }
        // A solid centre line down the middle of the carriageway, broken only at junctions.
        for (let z = road.z - road.d / 2; z < road.z + road.d / 2; z += 18) {
          const end = Math.min(z + 16, road.z + road.d / 2);
          if (near((z + end) / 2, horizontals, 12)) continue;
          centres.z.push({ x: road.x, z: (z + end) / 2, w: 0.13, d: end - z });
        }
        // Stop bar on the approach to every junction, on the near side of the crossing.
        for (const at of horizontals) {
          if (Math.abs(at - road.z) > road.d / 2 - 6) continue;
          stops.z.push({ x: road.x, z: at - road.d / 2 - 2.9, w: road.w * 0.46, d: 0.4 });
        }
      } else {
        for (let x = road.x - road.w / 2 + 5; x < road.x + road.w / 2 - 5; x += 9) {
          if (near(x, verticals, 11)) continue;
          markings.x.push({ x, z: road.z, w: 3.9, d: 0.22 });
        }
        for (let x = road.x - road.w / 2; x < road.x + road.w / 2; x += 18) {
          const end = Math.min(x + 16, road.x + road.w / 2);
          if (near((x + end) / 2, verticals, 12)) continue;
          centres.x.push({ x: (x + end) / 2, z: road.z, w: end - x, d: 0.13 });
        }
        for (const at of verticals) {
          if (Math.abs(at - road.x) > road.w / 2 - 6) continue;
          stops.x.push({ x: at - road.w / 2 - 2.9, z: road.z, w: 0.4, d: road.d * 0.46 });
        }
      }
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    // Paint is warm off-white, slightly worn: a plain white stripe on a warm road reads as tape.
    const material = new THREE.MeshStandardMaterial({
      color: 0xe8dcc0,
      roughness: 0.68,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const placements = [
      ...markings.z.map((m) => ({ x: m.x, y: 0.05, z: m.z, scale: [m.w, 1, m.d] })),
      ...markings.x.map((m) => ({ x: m.x, y: 0.05, z: m.z, scale: [m.w, 1, m.d] })),
    ];
    const dashes = makeInstances(geometry, material, placements, { receiveShadow: true });
    dashes.name = 'lane-dashes';
    dashes.renderOrder = 3;
    this.group.add(dashes);

    // The centre line is a shade warmer and a shade dirtier than the lane dashes.
    if (centres.z.length || centres.x.length) {
      const centreMaterial = material.clone();
      centreMaterial.color.set(0xd6bf72);
      const centrePlacements = [
        ...centres.z.map((m) => ({ x: m.x, y: 0.048, z: m.z, scale: [m.w, 1, m.d] })),
        ...centres.x.map((m) => ({ x: m.x, y: 0.048, z: m.z, scale: [m.w, 1, m.d] })),
      ];
      const line = makeInstances(geometry, centreMaterial, centrePlacements, { receiveShadow: true });
      line.name = 'centre-line';
      line.renderOrder = 3;
      this.group.add(line);
    }

    // Stop bars: a wide, slightly worn band across the approach lane.
    if (stops.x.length || stops.z.length) {
      const stopMaterial = material.clone();
      stopMaterial.color.set(0xe0d3b6);
      const stopsPlacements = [
        ...stops.z.map((m) => ({ x: m.x, y: 0.05, z: m.z, scale: [m.w, 1, m.d] })),
        ...stops.x.map((m) => ({ x: m.x, y: 0.05, z: m.z, scale: [m.w, 1, m.d] })),
      ];
      const bars = makeInstances(geometry, stopMaterial, stopsPlacements, { receiveShadow: true });
      bars.name = 'stop-bars';
      bars.renderOrder = 3;
      this.group.add(bars);
    }

    // Crosswalks: five thick stripes per approach, gathered into one instanced mesh.
    const stripes = [];
    for (const road of this.plan.roads.filter((r) => r.axis === 'z')) {
      const zMin = road.z - road.d / 2;
      const zMax = road.z + road.d / 2;
      for (const other of this.plan.roads.filter((r) => r.axis === 'x')) {
        if (other.z < zMin || other.z > zMax) continue;
        const half = other.d / 2;
        for (const side of [-1, 1]) {
          for (let n = 0; n < 5; n += 1) {
            stripes.push({
              x: road.x,
              y: 0.055,
              z: other.z + side * (half + 1.4 + n * 0.95),
              scale: [CITY.road - 1.5, 1, 0.42],
            });
          }
        }
      }
    }
    const crosswalks = makeInstances(geometry, material, stripes, { receiveShadow: true });
    crosswalks.name = 'crosswalks';
    crosswalks.renderOrder = 3;
    this.group.add(crosswalks);

    // Gutters: a darker, dirtier strip where the kerb meets the asphalt, so the road does not end
    // in a clean line under a stone edge. Drawn as a narrow band inside each kerb run.
    const gutter = [];
    for (const block of this.plan.blocks) {
      const h = block.half;
      const w = CITY.block;
      const inset = CITY.road / 2 - 0.35;
      for (const side of [-1, 1]) {
        gutter.push({ x: block.x, y: 0.034, z: block.z + side * (h + inset), scale: [w, 1, 0.7] });
        gutter.push({ x: block.x + side * (h + inset), y: 0.034, z: block.z, scale: [0.7, 1, w] });
      }
    }
    if (gutter.length) {
      const gutterMaterial = new THREE.MeshBasicMaterial({
        color: 0x241f1b,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const gutters = makeInstances(geometry, gutterMaterial, gutter, { receiveShadow: false });
      gutters.renderOrder = 2;
      this.group.add(gutters);
    }
  }

  buildCurbs() {
    // The kerb is a different material from the road and the pavement: pale, rough stone with a
    // slightly darker top face, so the edge of the carriageway reads at a distance.
    const geometry = new THREE.BoxGeometry(1, CITY.curbHeight, 0.34);
    geometry.translate(0, CITY.curbHeight / 2, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xd2c6b2, roughness: 0.86, metalness: 0 });
    const placements = [];
    for (const block of this.plan.blocks) {
      const h = block.half;
      const w = CITY.block;
      placements.push({ x: block.x, y: 0, z: block.z - h + 0.17, scale: [w, 1, 1] });
      placements.push({ x: block.x, y: 0, z: block.z + h - 0.17, scale: [w, 1, 1] });
      placements.push({ x: block.x - h + 0.17, y: 0, z: block.z, ry: Math.PI / 2, scale: [w, 1, 1] });
      placements.push({ x: block.x + h - 0.17, y: 0, z: block.z, ry: Math.PI / 2, scale: [w, 1, 1] });
    }
    const curbs = makeInstances(geometry, material, placements, { castShadow: false, receiveShadow: true });
    curbs.name = 'kerbs';
    this.kerbs = curbs;
    this.group.add(curbs);
  }

  /** After dark the asphalt takes a slightly wet specular and the paint picks up a little glow. */
  setNight(night) {
    if (this.wet) this.wet.opacity = night ? 0.26 : 0;
    if (this.grain) this.grain.opacity = night ? 0.42 : 0.55;
    if (this.surface) this.surface.material.roughness = night ? 0.42 : 0.72;
  }
}
