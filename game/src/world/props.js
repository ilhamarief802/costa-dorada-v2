// Street furniture: art-deco globe lamps with additive halos, benches, bins, parked cars,
// beach umbrellas, bus shelters and two roadside billboards.

import { CITY, SURFACE, ART } from '../core/config.js';
import { mergeGeometries, makeInstances } from '../core/geom.js';

export default class Props {
  constructor(plan, assets) {
    this.plan = plan;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.buildLamps();
    this.buildBenches();
    this.buildBins();
    this.buildParkedCars();
    this.buildUmbrellas();
    this.buildShelters();
    this.buildBillboards();
    this.setNight(false);
  }

  buildLamps() {
    const poleParts = [];
    const shaft = new THREE.CylinderGeometry(0.075, 0.11, 5.3, 7);
    shaft.translate(0, 2.65, 0);
    poleParts.push({ geometry: shaft });
    const base = new THREE.CylinderGeometry(0.22, 0.3, 0.5, 8);
    base.translate(0, 0.25, 0);
    poleParts.push({ geometry: base });
    const collar = new THREE.CylinderGeometry(0.16, 0.1, 0.28, 8);
    collar.translate(0, 5.35, 0);
    poleParts.push({ geometry: collar });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3a34, roughness: 0.6, metalness: 0.55 });
    const poleGeometry = mergeGeometries(poleParts);
    const placements = this.plan.lamps.map((lamp) => ({
      x: lamp.x,
      y: this.plan.groundHeight(lamp.x, lamp.z),
      z: lamp.z,
    }));
    this.group.add(makeInstances(poleGeometry, poleMaterial, placements, { castShadow: true, receiveShadow: true }));

    const globeGeometry = new THREE.SphereGeometry(0.27, 10, 8);
    this.globeMaterial = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
    const globes = makeInstances(globeGeometry, this.globeMaterial, placements.map((p) => ({ x: p.x, y: p.y + 5.62, z: p.z })), {
      castShadow: false,
      receiveShadow: false,
    });
    this.globes = globes;
    this.group.add(globes);

    const haloPositions = new Float32Array(this.plan.lamps.length * 3);
    placements.forEach((p, i) => {
      haloPositions[i * 3] = p.x;
      haloPositions[i * 3 + 1] = p.y + 5.62;
      haloPositions[i * 3 + 2] = p.z;
    });
    const haloGeometry = new THREE.BufferGeometry();
    haloGeometry.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3));
    this.haloMaterial = new THREE.PointsMaterial({
      map: this.assets.glow(),
      color: 0xffbe7a,
      size: 2.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.add(new THREE.Points(haloGeometry, this.haloMaterial));

    // The pool each lamp throws on the pavement: a ground quad with the radial glow ramp, so the
    // falloff is soft and elliptical rather than a hard disc with a visible rim. Additive, and
    // scaled in X/Z to the lamp's reach, so it lies *on* the ground and never rises up the wall.
    const poolGeometry = new THREE.PlaneGeometry(1, 1);
    poolGeometry.rotateX(-Math.PI / 2);
    this.poolMaterial = new THREE.MeshBasicMaterial({
      map: this.assets.glow(),
      color: 0xffc07a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const pools = makeInstances(poolGeometry, this.poolMaterial, placements.map((p) => ({
      x: p.x,
      y: p.y + 0.045,
      z: p.z,
      scale: [9.5, 1, 7.4],
    })), { receiveShadow: false });
    pools.renderOrder = 3;
    pools.name = 'lamp-pools';
    this.pools = pools;
    this.group.add(pools);
  }

  buildBenches() {
    const parts = [];
    const seat = new THREE.BoxGeometry(2.0, 0.11, 0.55);
    seat.translate(0, 0.46, 0);
    parts.push({ geometry: seat });
    const back = new THREE.BoxGeometry(2.0, 0.5, 0.1);
    back.translate(0, 0.78, -0.24);
    parts.push({ geometry: back });
    for (const x of [-0.8, 0.8]) {
      const leg = new THREE.BoxGeometry(0.1, 0.46, 0.5);
      leg.translate(x, 0.23, 0);
      parts.push({ geometry: leg });
    }
    const geometry = mergeGeometries(parts);
    const material = new THREE.MeshStandardMaterial({ color: 0x6d4a32, roughness: 0.85 });
    const placements = this.plan.benches.map((bench) => ({
      x: bench.x,
      y: this.plan.groundHeight(bench.x, bench.z),
      z: bench.z,
      ry: bench.rot,
    }));
    this.group.add(makeInstances(geometry, material, placements, { castShadow: true, receiveShadow: true }));
  }

  buildBins() {
    const geometry = new THREE.CylinderGeometry(0.32, 0.28, 0.95, 9);
    geometry.translate(0, 0.475, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0x3f5147, roughness: 0.7, metalness: 0.3 });
    const placements = [];
    for (const block of this.plan.blocks) {
      if (block.park || block.plaza) continue;
      const sides = [-1, 1];
      for (const side of sides) {
        placements.push({ x: block.x + side * 21.4, y: CITY.padHeight, z: block.z + 9.5 });
      }
    }
    this.group.add(makeInstances(geometry, material, placements, { castShadow: true, receiveShadow: true }));
  }

  buildParkedCars() {
    const bodyParts = [];
    const body = new THREE.BoxGeometry(1.82, 0.56, 4.05);
    body.translate(0, 0.62, 0);
    bodyParts.push({ geometry: body });
    const cabin = new THREE.BoxGeometry(1.62, 0.5, 1.95);
    cabin.translate(0, 1.12, -0.12);
    bodyParts.push({ geometry: cabin });
    const trunk = new THREE.BoxGeometry(1.72, 0.16, 0.9);
    trunk.translate(0, 0.92, -1.52);
    bodyParts.push({ geometry: trunk });
    const nose = new THREE.BoxGeometry(1.72, 0.2, 0.7);
    nose.translate(0, 0.64, 1.72);
    bodyParts.push({ geometry: nose });
    const bodyGeometry = mergeGeometries(bodyParts);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.35 });
    const bodies = this.plan.parked.map((car) => ({
      x: car.x,
      y: 0.02,
      z: car.z,
      ry: car.rot,
      color: car.color,
    }));
    this.group.add(makeInstances(bodyGeometry, bodyMaterial, bodies, { castShadow: true, receiveShadow: true }));

    const glass = new THREE.BoxGeometry(1.5, 0.38, 1.78);
    glass.translate(0, 1.16, -0.12);
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x17232c, roughness: 0.14, metalness: 0.7 });
    this.group.add(makeInstances(glass, glassMaterial, bodies.map((car) => ({ ...car, ry: car.ry })), { castShadow: false, receiveShadow: false }));

    const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
    wheel.rotateZ(Math.PI / 2);
    const wheelGeometry = wheel;
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const wheels = [];
    for (const car of this.plan.parked) {
      const forward = { x: Math.sin(car.rot), z: Math.cos(car.rot) };
      const right = { x: Math.cos(car.rot), z: -Math.sin(car.rot) };
      for (const side of [-1, 1]) {
        for (const axle of [-1.28, 1.28]) {
          wheels.push({
            x: car.x + right.x * side * 0.86 + forward.x * axle,
            y: 0.36,
            z: car.z + right.z * side * 0.86 + forward.z * axle,
            ry: car.rot,
          });
        }
      }
    }
    this.group.add(makeInstances(wheelGeometry, wheelMaterial, wheels, { castShadow: true, receiveShadow: false }));
  }

  buildUmbrellas() {
    const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6);
    poleGeometry.translate(0, 1.2, 0);
    const coneGeometry = new THREE.ConeGeometry(1.55, 0.55, 10);
    coneGeometry.translate(0, 2.35, 0);
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xcfc2a8, roughness: 0.8 });
    const rng = this.plan.rng.fork('umbrellas');
    const canopies = [];
    const poles = [];
    const palette = [0xd9694f, 0xe8c46a, 0x4f8d84, 0xd7d0bd, 0xc0576b];
    for (let i = 0; i < 16; i += 1) {
      const x = -190 + i * 26 + rng.range(-6, 6);
      const z = 252 + rng.range(-3, 6);
      const y = this.plan.groundHeight(x, z);
      poles.push({ x, y, z });
      canopies.push({ x, y, z, ry: rng.range(0, 6.28), color: rng.pick(palette) });
    }
    this.group.add(makeInstances(poleGeometry, poleMaterial, poles, { castShadow: true, receiveShadow: true }));
    this.group.add(makeInstances(coneGeometry, canopyMaterial, canopies, { castShadow: true, receiveShadow: true }));
  }

  buildShelters() {
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3334, roughness: 0.55, metalness: 0.5 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x9fc3c9,
      roughness: 0.08,
      metalness: 0.2,
      transparent: true,
      opacity: 0.28,
    });
    const spots = [
      { x: 42.5, z: 96 },
      { x: -42.5, z: 172 },
      { x: 104.5, z: 31 },
    ];
    for (const spot of spots) {
      const shelter = new THREE.Group();
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 1.9), frameMaterial);
      roof.position.y = 2.55;
      roof.castShadow = true;
      shelter.add(roof);
      for (const x of [-1.9, 1.9]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.55, 0.12), frameMaterial);
        post.position.set(x, 1.27, 0.8);
        post.castShadow = true;
        shelter.add(post);
      }
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.2), glassMaterial);
      glass.position.set(0, 1.35, -0.8);
      shelter.add(glass);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 0.42), new THREE.MeshStandardMaterial({ color: 0x87603f, roughness: 0.8 }));
      bench.position.set(0, 0.5, -0.45);
      bench.name = 'shelter-bench';
      shelter.add(bench);
      // The bench stands on legs: floating a slab at knee height inside the shelter is a bench
      // nobody can sit on.
      for (const x of [-1.5, 1.5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.36), frameMaterial);
        leg.position.set(x, 0.25, -0.45);
        leg.castShadow = true;
        leg.name = 'shelter-bench-leg';
        shelter.add(leg);
      }
      shelter.position.set(spot.x, this.plan.groundHeight(spot.x, spot.z), spot.z);
      shelter.rotation.y = spot.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(shelter);
    }
  }

  buildBillboards() {
    const boards = [
      { x: -60, z: 229, text: 'COSTA DORADA', rot: Math.PI, w: 15, h: 5.2 },
      { x: 130, z: 229, text: 'EL MIRADOR', rot: Math.PI, w: 12, h: 4.2 },
    ];
    for (const board of boards) {
      const texture = this.assets.billboard(board.text);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(board.w, board.h),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      );
      plane.position.set(board.x, 6.2, board.z - 0.2);
      plane.rotation.y = board.rot;
      this.group.add(plane);
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(board.w + 0.5, board.h + 0.5, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.85 }),
      );
      frame.position.set(board.x, 6.2, board.z);
      frame.castShadow = true;
      this.group.add(frame);
      for (const offset of [-board.w * 0.3, board.w * 0.3]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.22, 6.2, 8),
          new THREE.MeshStandardMaterial({ color: 0x51483f, roughness: 0.8, metalness: 0.3 }),
        );
        leg.position.set(board.x + offset, 3.1, board.z);
        leg.castShadow = true;
        this.group.add(leg);
      }
    }
  }

  setNight(night) {
    this.globeMaterial.color.set(night ? 0xffc271 : 0xf4e4c2);
    this.haloMaterial.opacity = night ? 0.9 : 0.04;
    this.haloMaterial.size = night ? 3.6 : 1.4;
    // A faint pool, not a spotlight: enough that the lamp has a footprint on the pavement and the
    // pavement between two lamps is visibly darker. The mask handles the falloff, so the opacity
    // can be low without the edge ever showing.
    this.poolMaterial.opacity = night ? 0.22 : 0;
  }
}
