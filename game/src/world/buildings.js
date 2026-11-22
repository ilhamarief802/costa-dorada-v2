// Every building in the city, drawn as a handful of instanced meshes: masses, roof caps,
// facade ledges, window grids, shopfronts, awnings, rooftop tanks and neon signs.

import { CITY } from '../core/config.js';
import { makeInstances, mergeGeometries } from '../core/geom.js';

const WINDOW_DAY = new THREE.Color(0x35505f);
const WINDOW_NIGHT_DARK = new THREE.Color(0x101a28);
const WINDOW_NIGHT_LIT = new THREE.Color(0xffc274);
const SHOP_DAY = new THREE.Color(0x23343c);
const SHOP_NIGHT = new THREE.Color(0xffd59a);

export default class Buildings {
  constructor(plan, assets) {
    this.plan = plan;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    this.windowDescriptors = [];
    this.shopDescriptors = [];
    this.bannerMaterials = [];

    this.buildMasses();
    this.buildRoofs();
    this.buildLedges();
    this.buildContactStrips();
    this.buildWindows();
    this.buildShopfronts();
    this.buildAwnings();
    this.buildBalconies();
    this.buildRoofPlant();
    this.buildSigns();
    this.buildBladeSigns();
    this.setNight(false);
  }

  /**
   * Dark contact strips at every building base: a narrow band of grime and shadow where the wall
   * meets the pavement. Without it a facade is a rectangle dropping onto the ground with a hard,
   * impossibly clean edge, which is the single strongest "this is a card" cue in a low-poly city.
   * The strip is drawn as four thin quads hugging the footprint, slightly proud of the wall so it
   * cannot z-fight with it.
   */
  buildContactStrips() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0x2a231c,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: true,
    });
    const placements = [];
    const band = 0.55;
    for (const lot of this.plan.lots) {
      if (lot.height <= 0) continue;
      const y = CITY.padHeight + 0.006;
      // North and south faces.
      for (const side of [-1, 1]) {
        placements.push({
          x: lot.x,
          y,
          z: lot.z + side * (lot.d / 2 + band / 2 - 0.02),
          scale: [lot.w + band, 1, band],
        });
      }
      // East and west faces.
      for (const side of [-1, 1]) {
        placements.push({
          x: lot.x + side * (lot.w / 2 + band / 2 - 0.02),
          y,
          z: lot.z,
          scale: [band, 1, lot.d + band],
        });
      }
    }
    if (!placements.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    const dummy = new THREE.Object3D();
    placements.forEach((placement, index) => {
      dummy.position.set(placement.x, placement.y, placement.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(placement.scale[0], 1, placement.scale[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.addNamed('contact-strips', mesh, false);
  }

  /** Add a part under the buildings group and remember what it is, so the floating-geometry
   *  audit can tell a window from a wall without guessing at material colours. */
  addNamed(name, mesh, structural = true) {
    mesh.name = name;
    mesh.userData.structural = structural;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Balconies: a slab and a balustrade under a run of windows, at the same floor heights the
   * ledges use. They give the facades a second plane to cast shadows onto, which is what stops a
   * tall wall reading as a flat painted card.
   */
  buildBalconies() {
    const slabGeometry = new THREE.BoxGeometry(1, 0.12, 0.9);
    const railGeometry = new THREE.BoxGeometry(1, 0.36, 0.06);
    const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.02 });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.5, metalness: 0.55 });
    const slabs = [];
    const rails = [];
    for (const lot of this.plan.lots) {
      if (lot.height <= 0 || lot.style === 'plaza' || lot.style === 'warehouse') continue;
      const rng = this.plan.rng.fork(`balcony-${lot.seed}`);
      const floors = Math.max(1, Math.floor((lot.height - 2) / 3.6));
      for (let f = 1; f <= floors; f += 1) {
        if (!rng.chance(0.3)) continue;
        const y = CITY.padHeight + f * 3.6;
        const side = rng.pick([0, 1, 2, 3]);
        const along = rng.range(0.3, 0.7);
        const width = Math.min(3.4, (side % 2 === 0 ? lot.w : lot.d) * 0.3);
        if (side === 0 || side === 1) {
          const z = lot.z + (side === 0 ? 1 : -1) * (lot.d / 2 + 0.5);
          const x = lot.x + (along - 0.5) * lot.w * 0.7;
          slabs.push({ x, y, z, scale: [width, 1, 1], color: lot.color });
          rails.push({ x, y: y + 0.24, z: z + (side === 0 ? 0.42 : -0.42), scale: [width, 1, 1] });
        } else {
          const x = lot.x + (side === 2 ? 1 : -1) * (lot.w / 2 + 0.5);
          const z = lot.z + (along - 0.5) * lot.d * 0.7;
          slabs.push({ x, y, z, ry: Math.PI / 2, scale: [width, 1, 1], color: lot.color });
          rails.push({ x: x + (side === 2 ? 0.42 : -0.42), y: y + 0.24, z, ry: Math.PI / 2, scale: [width, 1, 1] });
        }
      }
    }
    if (slabs.length) {
      this.addNamed('balcony-slabs', makeInstances(slabGeometry, stoneMaterial, slabs, { castShadow: true, receiveShadow: true }), false);
      this.addNamed('balcony-rails', makeInstances(railGeometry, railMaterial, rails, { castShadow: true, receiveShadow: true }), false);
    }
  }

  /**
   * Roof plant: air-conditioning boxes, vent stacks, water tanks on legs, and a railing round the
   * parapet of every taller roof. All of it is placed from the lot's own footprint and top, so
   * nothing can hover beside a building instead of on it.
   */
  buildRoofPlant() {
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const tankGeometry = new THREE.CylinderGeometry(1, 1, 1.6, 10);
    const ductMaterial = new THREE.MeshStandardMaterial({ color: 0x8e8a80, roughness: 0.8, metalness: 0.25 });
    const tankMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.86 });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x3c3830, roughness: 0.62, metalness: 0.4 });
    const boxes = [];
    const tanks = [];
    const rails = [];
    const rng = this.plan.rng.fork('roof-plant');
    for (const lot of this.plan.lots) {
      if (lot.height <= 0) continue;
      const top = CITY.padHeight + lot.height + 0.32;
      // Parapet railing, inset from the roof edge.
      if (lot.height > 9) {
        const inset = 0.6;
        for (const side of [-1, 1]) {
          rails.push({ x: lot.x, y: top + 0.04, z: lot.z + side * (lot.d / 2 - inset), scale: [lot.w - inset * 2, 1, 1] });
          rails.push({ x: lot.x + side * (lot.w / 2 - inset), y: top + 0.04, z: lot.z, ry: Math.PI / 2, scale: [lot.d - inset * 2, 1, 1] });
        }
      }
      // AC plant: two or three units on the roof, each with a fan grille.
      const units = rng.int(1, 3);
      for (let i = 0; i < units; i += 1) {
        const x = lot.x + rng.range(-lot.w * 0.3, lot.w * 0.3);
        const z = lot.z + rng.range(-lot.d * 0.3, lot.d * 0.3);
        boxes.push({ x, y: top + 0.45, z, scale: [rng.range(1.0, 1.9), 0.9, rng.range(0.9, 1.6)], ry: rng.range(0, 3.1) });
      }
      if (lot.roof === 'tank') {
        tanks.push({ x: lot.x + lot.w * 0.18, y: top + 1.9, z: lot.z - lot.d * 0.2, scale: [1.0, 1, 1.0] });
      }
      if (lot.style === 'tower') {
        // Lift overrun and a mast: the silhouette of a tower block.
        boxes.push({ x: lot.x, y: top + 0.9, z: lot.z, scale: [lot.w * 0.34, 1.8, lot.d * 0.34] });
      }
    }
    if (boxes.length) this.addNamed('roof-plant', makeInstances(boxGeometry, ductMaterial, boxes, { castShadow: true, receiveShadow: true }), false);
    if (tanks.length) this.addNamed('roof-tanks', makeInstances(tankGeometry, tankMaterial, tanks, { castShadow: true, receiveShadow: true }), false);
    if (rails.length) this.addNamed('parapet-rails', makeInstances(new THREE.BoxGeometry(1, 0.9, 0.07), railMaterial, rails, { castShadow: true, receiveShadow: false }), false);
  }

  buildMasses() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.04 });
    const placements = [];
    for (const lot of this.plan.lots) {
      if (lot.height <= 0) continue;
      placements.push({
        x: lot.x,
        y: CITY.padHeight,
        z: lot.z,
        scale: [lot.w, lot.height, lot.d],
        color: lot.color,
      });
      if (lot.style === 'tower' && lot.tiers > 1) {
        for (let tier = 1; tier < lot.tiers; tier += 1) {
          const shrink = tier * 1.55;
          const tierHeight = lot.height * (0.12 + tier * 0.05);
          placements.push({
            x: lot.x,
            y: CITY.padHeight + lot.height,
            z: lot.z,
            scale: [Math.max(6, lot.w - shrink * 2), tierHeight, Math.max(6, lot.d - shrink * 2)],
            color: lot.color,
          });
        }
      }
    }
    const masses = makeInstances(geometry, material, placements, { castShadow: true, receiveShadow: true });
    this.addNamed('masses', masses, true);
  }

  buildRoofs() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const placements = [];
    const detailGeometry = new THREE.BoxGeometry(1, 1, 1);
    detailGeometry.translate(0, 0.5, 0);
    const detailMaterial = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.9 });
    const details = [];
    const tankGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
    tankGeometry.translate(0, 0.5, 0);
    const tankMaterial = new THREE.MeshStandardMaterial({ color: 0x6d5b46, roughness: 0.85 });
    const tanks = [];
    const rng = this.plan.rng.fork('roofs');
    for (const lot of this.plan.lots) {
      if (lot.height <= 0) continue;
      const top = CITY.padHeight + lot.height;
      placements.push({
        x: lot.x,
        y: top,
        z: lot.z,
        scale: [lot.w + 0.55, 0.32, lot.d + 0.55],
        color: lot.style === 'tower' ? 0x5d666c : 0x8d8274,
      });
      if (lot.style === 'tower') {
        details.push({ x: lot.x + lot.w * 0.2, y: top + 0.32, z: lot.z - lot.d * 0.15, scale: [4, 2.6, 4] });
        details.push({ x: lot.x - lot.w * 0.18, y: top + 0.32, z: lot.z + lot.d * 0.2, scale: [3, 1.4, 3.6] });
      } else if (lot.roof === 'tank') {
        tanks.push({ x: lot.x + lot.w * 0.2, y: top + 0.3, z: lot.z - lot.d * 0.2, scale: [1.15, 2.1, 1.15] });
      } else if (lot.roof === 'ac') {
        details.push({ x: lot.x - lot.w * 0.2, y: top + 0.3, z: lot.z - lot.d * 0.1, scale: [1.8, 0.9, 1.4] });
        details.push({ x: lot.x + lot.w * 0.15, y: top + 0.3, z: lot.z + lot.d * 0.2, scale: [1.2, 0.7, 1.1] });
      }
      if (lot.style === 'deco' && rng.chance(0.4)) {
        // A small art-deco finial: a tapered slab at the front of the roof.
        details.push({ x: lot.x, y: top + 0.32, z: lot.z + lot.d * 0.3, scale: [lot.w * 0.28, 2.2, 0.5] });
      }
    }
    this.addNamed('roof-caps', makeInstances(geometry, material, placements, { castShadow: true, receiveShadow: true }), true);
    if (details.length) {
      this.addNamed('roof-details', makeInstances(detailGeometry, detailMaterial, details, { castShadow: true, receiveShadow: true }), false);
    }
    if (tanks.length) {
      this.addNamed('roof-tanks-low', makeInstances(tankGeometry, tankMaterial, tanks, { castShadow: true, receiveShadow: true }), false);
    }
  }

  buildLedges() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    const placements = [];
    for (const lot of this.plan.lots) {
      if (lot.height <= 0 || lot.style === 'plaza') continue;
      // Ledges stop below the parapet: a floor line that pokes out above its own roof is the
      // single most common way a facade part ends up looking like it floats.
      const floors = Math.max(1, Math.min(16, Math.floor((lot.height - 1.2) / 3.6)));
      const y0 = CITY.padHeight;
      for (let f = 1; f <= floors; f += 1) {
        const y = y0 + f * 3.6;
        if (y > y0 + lot.height - 0.7) continue;
        const tint = new THREE.Color(lot.color).multiplyScalar(1.18).getHex();
        placements.push({ x: lot.x, y, z: lot.z + lot.d / 2 + 0.06, scale: [lot.w + 0.25, 0.17, 0.2], color: tint });
        placements.push({ x: lot.x, y, z: lot.z - lot.d / 2 - 0.06, scale: [lot.w + 0.25, 0.17, 0.2], color: tint });
        placements.push({ x: lot.x + lot.w / 2 + 0.06, y, z: lot.z, scale: [0.2, 0.17, lot.d + 0.25], color: tint });
        placements.push({ x: lot.x - lot.w / 2 - 0.06, y, z: lot.z, scale: [0.2, 0.17, lot.d + 0.25], color: tint });
      }
    }
    this.addNamed('ledges', makeInstances(geometry, material, placements, { castShadow: false, receiveShadow: true }), true);
  }

  buildWindows() {
    const density = 0.92;
    for (const lot of this.plan.lots) {
      if (lot.height <= 0) continue;
      const rng = this.plan.rng.fork(`windows-${lot.seed}`);
      const floors = Math.max(1, Math.floor(lot.height / 3.55));
      const tower = lot.style === 'tower';
      const windowH = tower ? 2.15 : 1.75;
      const spacingY = tower ? 3.45 : 3.55;
      const y0 = CITY.padHeight + (tower ? 4.2 : 4.4);

      // Which way a face runs is an axis question, not an angle comparison: the east face is
      // +PI/2 and the west face is -PI/2, and testing for equality with +PI/2 slid every west
      // face's columns sideways along X instead of along Z — windows floating in mid-air.
      const addFace = (count, x, z, ry, span) => {
        if (count < 1) return;
        const step = span / count;
        const alongZ = Math.abs(Math.abs(ry) - Math.PI / 2) < 1e-6;
        for (let f = 0; f < floors; f += 1) {
          const y = y0 + f * spacingY;
          if (y + windowH / 2 > CITY.padHeight + lot.height - 0.6) continue;
          for (let c = 0; c < count; c += 1) {
            if (rng.next() > density) continue;
            const offset = -span / 2 + step * (c + 0.5);
            const windowW = tower ? step * 0.82 : Math.min(1.35, step * 0.58);
            this.windowDescriptors.push({
              x: x + (alongZ ? 0 : offset),
              z: z + (alongZ ? offset : 0),
              y,
              ry,
              w: windowW,
              h: windowH,
              lit: rng.next() < lot.windowsLit,
              warm: rng.range(0.72, 1),
              cool: rng.next() < 0.14,
            });
          }
        }
      };

      addFace(lot.cols, lot.x, lot.z + lot.d / 2 + 0.06, 0, lot.w * 0.86);
      addFace(lot.cols, lot.x, lot.z - lot.d / 2 - 0.06, Math.PI, lot.w * 0.86);
      addFace(lot.depthCols, lot.x + lot.w / 2 + 0.06, lot.z, Math.PI / 2, lot.d * 0.86);
      addFace(lot.depthCols, lot.x - lot.w / 2 - 0.06, lot.z, -Math.PI / 2, lot.d * 0.86);
    }

    // Each window is a recess, not a decal: a frame (the surround, in the facade's own stone), a
    // glass pane inset behind it, a sill under it and a mullion splitting it. Four instanced
    // meshes for the whole city, and at 480 px the grid reads as punched openings with depth
    // rather than as flat blue rectangles.
    const unit = new THREE.PlaneGeometry(1, 1);
    this.windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, side: THREE.FrontSide });
    this.windows = new THREE.InstancedMesh(unit, this.windowMaterial, Math.max(1, this.windowDescriptors.length));
    this.windows.count = this.windowDescriptors.length;
    this.windows.castShadow = false;
    this.windows.receiveShadow = false;
    this.windows.frustumCulled = false;

    // Frame: a slightly larger quad behind the glass, tinted the facade's stone, so every window
    // has a visible reveal on all four sides.
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.02 });
    this.windowFrames = new THREE.InstancedMesh(unit, frameMaterial, Math.max(1, this.windowDescriptors.length));
    this.windowFrames.castShadow = false;
    this.windowFrames.receiveShadow = true;
    this.windowFrames.frustumCulled = false;

    // Sill: a shallow ledge under each window, catching the low sun. One quad rather than a box:
    // nine thousand window boxes is a hundred and ten thousand triangles for a ledge whose top and
    // underside can never be seen from a camera at 3 m. The ledge is the plane plus the frame's own
    // lip below it.
    const sillGeometry = new THREE.PlaneGeometry(1, 1);
    this.windowSills = new THREE.InstancedMesh(sillGeometry, frameMaterial, Math.max(1, this.windowDescriptors.length));
    this.windowSills.castShadow = false;
    this.windowSills.receiveShadow = true;
    this.windowSills.frustumCulled = false;

    // Mullion: the vertical divider, in the same stone.
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    this.windowDescriptors.forEach((win, index) => {
      const nx = Math.sin(win.ry);
      const nz = Math.cos(win.ry);
      dummy.position.set(win.x, win.y, win.z);
      dummy.rotation.set(0, win.ry, 0);
      dummy.scale.set(win.w, win.h, 1);
      dummy.updateMatrix();
      this.windows.setMatrixAt(index, dummy.matrix);

      // Reveal: 16 cm of stone on every side, 8 cm behind the glass plane.
      dummy.position.set(win.x - nx * 0.08, win.y, win.z - nz * 0.08);
      dummy.scale.set(win.w + 0.16, win.h + 0.16, 1);
      dummy.updateMatrix();
      this.windowFrames.setMatrixAt(index, dummy.matrix);
      frameMaterial.color.set(0xffffff);

      // Sill: a 20 cm ledge proud of the wall, lying flat under the opening and catching the sun.
      // A quad laid horizontal (a quarter turn about X) and then yawed onto the facade (Y first in
      // YXZ order), so the ledge's long axis runs along the wall and its depth juts out.
      dummy.position.set(win.x + nx * 0.05, win.y - win.h / 2 - 0.05, win.z + nz * 0.05);
      dummy.rotation.set(-Math.PI / 2, win.ry, 0, 'YXZ');
      dummy.scale.set(win.w + 0.24, 0.24, 1);
      dummy.updateMatrix();
      this.windowSills.setMatrixAt(index, dummy.matrix);
    });

    // Frame and sill colours follow the wall they are cut into.
    this.windowDescriptors.forEach((win, index) => {
      const lot = this.plan.lots.find(
        (candidate) =>
          Math.abs((win.x + win.z) - (candidate.x + candidate.z)) < 60 &&
          Math.abs(win.x - candidate.x) <= candidate.w / 2 + 0.5 &&
          Math.abs(win.z - candidate.z) <= candidate.d / 2 + 0.5,
      );
      colour.set(lot ? lot.color : 0xc9bda9).multiplyScalar(1.12);
      this.windowFrames.setColorAt(index, colour);
      this.windowSills.setColorAt(index, colour);
    });
    if (this.windowFrames.instanceColor) this.windowFrames.instanceColor.needsUpdate = true;
    if (this.windowSills.instanceColor) this.windowSills.instanceColor.needsUpdate = true;

    this.windows.instanceMatrix.needsUpdate = true;
    this.windowFrames.instanceMatrix.needsUpdate = true;
    this.windowSills.instanceMatrix.needsUpdate = true;
    this.addNamed('window-frames', this.windowFrames, false);
    this.addNamed('windows', this.windows, false);
    this.addNamed('window-sills', this.windowSills, false);
  }

  buildShopfronts() {
    for (const lot of this.plan.lots) {
      if (lot.height <= 0) continue;
      const rng = this.plan.rng.fork(`shop-${lot.seed}`);
      const h = Math.min(2.5, lot.height * 0.3);
      const faces = [
        { x: lot.x, z: lot.z + lot.d / 2 + 0.05, ry: 0, span: lot.w * 0.78 },
        { x: lot.x, z: lot.z - lot.d / 2 - 0.05, ry: Math.PI, span: lot.w * 0.78 },
        { x: lot.x + lot.w / 2 + 0.05, z: lot.z, ry: Math.PI / 2, span: lot.d * 0.78 },
        { x: lot.x - lot.w / 2 - 0.05, z: lot.z, ry: -Math.PI / 2, span: lot.d * 0.78 },
      ];
      for (const face of faces) {
        if (rng.next() < 0.18) continue;
        this.shopDescriptors.push({
          x: face.x,
          z: face.z,
          y: CITY.padHeight + 0.35 + h / 2,
          ry: face.ry,
          w: face.span,
          h,
          lit: rng.chance(0.62),
          warm: rng.range(0.75, 1),
        });
      }
    }
    const geometry = new THREE.BoxGeometry(1, 1, 0.12);
    this.shopMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
    this.shops = new THREE.InstancedMesh(geometry, this.shopMaterial, Math.max(1, this.shopDescriptors.length));
    this.shops.count = this.shopDescriptors.length;
    this.shops.castShadow = false;
    this.shops.frustumCulled = false;
    const dummy = new THREE.Object3D();
    this.shopDescriptors.forEach((shop, index) => {
      dummy.position.set(shop.x, shop.y, shop.z);
      dummy.rotation.set(0, shop.ry, 0);
      dummy.scale.set(shop.w, shop.h, 1);
      dummy.updateMatrix();
      this.shops.setMatrixAt(index, dummy.matrix);
    });
    this.shops.instanceMatrix.needsUpdate = true;
    this.addNamed('shopfronts', this.shops, false);
  }

  buildAwnings() {
    const geometry = new THREE.BoxGeometry(1, 0.12, 1.15);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    const placements = [];
    for (const lot of this.plan.lots) {
      if (!lot.awning) continue;
      const y = CITY.padHeight + 3.15;
      const faces = [
        { x: lot.x, z: lot.z + lot.d / 2 + 0.58, ry: 0, span: lot.w * 0.7 },
        { x: lot.x, z: lot.z - lot.d / 2 - 0.58, ry: 0, span: lot.w * 0.7 },
        { x: lot.x + lot.w / 2 + 0.58, z: lot.z, ry: Math.PI / 2, span: lot.d * 0.7 },
        { x: lot.x - lot.w / 2 - 0.58, z: lot.z, ry: Math.PI / 2, span: lot.d * 0.7 },
      ];
      for (const face of faces) {
        placements.push({ x: face.x, y, z: face.z, ry: face.ry, scale: [face.span, 1, 1], color: lot.awningColor });
      }
    }
    if (placements.length) {
      this.addNamed('awnings', makeInstances(geometry, material, placements, { castShadow: true, receiveShadow: true }), false);
    }
  }

  buildSigns() {
    const groups = new Map();
    const backings = [];
    const glowPoints = [];
    for (const sign of this.plan.signs) {
      const lot = this.plan.lots.find(
        (candidate) => candidate.signText === sign.text && Math.abs(candidate.x - sign.x) < 0.01 && Math.abs(candidate.z - sign.z) < 0.01,
      );
      if (!lot) continue;
      const y = CITY.padHeight + Math.min(6.2, lot.height * 0.55);
      let x = lot.x;
      let z = lot.z;
      let ry = 0;
      if (sign.face === 'south') {
        z = lot.z + lot.d / 2 + 0.2;
      } else if (sign.face === 'east') {
        x = lot.x + lot.w / 2 + 0.2;
        ry = Math.PI / 2;
      } else {
        x = lot.x - lot.w / 2 - 0.2;
        ry = -Math.PI / 2;
      }

      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      const panel = new THREE.PlaneGeometry(6.4, 1.6);
      panel.applyMatrix4(matrix);
      if (!groups.has(sign.text)) groups.set(sign.text, []);
      groups.get(sign.text).push({ geometry: panel });

      const normalX = Math.sin(ry);
      const normalZ = Math.cos(ry);
      backings.push({ x: x - normalX * 0.09, y, z: z - normalZ * 0.09, ry, scale: [1, 1, 1] });
      glowPoints.push(x + normalX * 0.35, y, z + normalZ * 0.35);
    }

    for (const [text, parts] of groups) {
      const texture = this.assets.sign(text, { background: '#151019', ink: '#ffdba6', border: '#ff9a4a' });
      const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(mergeGeometries(parts), material);
      mesh.renderOrder = 1;
      this.bannerMaterials.push(material);
      this.addNamed('sign-panels', mesh, false);
    }

    if (backings.length) {
      const backingGeometry = new THREE.BoxGeometry(6.7, 1.9, 0.16);
      const backingMaterial = new THREE.MeshStandardMaterial({ color: 0x201a1c, roughness: 0.8 });
      this.addNamed('sign-backings', makeInstances(backingGeometry, backingMaterial, backings, { castShadow: true, receiveShadow: true }), false);
    }

    if (glowPoints.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(glowPoints, 3));
      this.signGlowMaterial = new THREE.PointsMaterial({
        map: this.assets.glow(),
        color: 0xffa95c,
        size: 7,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.group.add(new THREE.Points(geometry, this.signGlowMaterial));
    }
  }

  /**
   * Neon blade signs: the vertical shop sign that hangs off a facade at right angles to it, its
   * face square to the street so a driver reads it side-on. One per a handful of lots, on the
   * ground-to-fourth floor band. The blade is a thin box so it has a lit edge as well as a lit
   * face, and it is drawn twice: a standard tube for the unlit frame by day, and a bright emissive
   * face after dark, when the sign is the thing that says "this street is open".
   */
  buildBladeSigns() {
    const blades = [];
    const glow = [];
    const rng = this.plan.rng.fork('blade-signs');
    const words = ['HOTEL', 'BAR', 'CAFE', 'MARISOL', 'REEF', 'SOL', 'PLAYA', 'NORTE', 'VELA'];
    for (const lot of this.plan.lots) {
      if (lot.height < 7 || lot.style === 'plaza' || lot.style === 'warehouse') continue;
      if (!rng.chance(0.42)) continue;
      // Facing the street on one of the two long faces, hung just proud of the wall.
      const face = rng.pick(['south', 'east']);
      const y = CITY.padHeight + Math.min(7.4, 3.4 + lot.height * 0.14);
      const word = rng.pick(words);
      if (face === 'south') {
        blades.push({ x: lot.x - lot.w * 0.32, y, z: lot.z + lot.d / 2 + 0.75, ry: 0, word, tall: true });
      } else {
        blades.push({ x: lot.x + lot.w / 2 + 0.75, y, z: lot.z + lot.d * 0.3, ry: Math.PI / 2, word, tall: true });
      }
    }
    if (!blades.length) return;

    // Frame: a slim dark box the panel is mounted in, so the sign is a fitting, not a decal.
    const frameGeometry = new THREE.BoxGeometry(1.05, 2.5, 0.16);
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1a1e, roughness: 0.7, metalness: 0.4 });
    const frames = makeInstances(frameGeometry, frameMaterial, blades.map((b) => ({ x: b.x, y: b.y, z: b.z, ry: b.ry })), { castShadow: true, receiveShadow: true });
    this.addNamed('blade-frames', frames, true);

    // Face: one plane per word, all of them merging into one mesh per word so the nine possible
    // blades cost nine draws and not one per building.
    const byWord = new Map();
    for (const blade of blades) {
      if (!byWord.has(blade.word)) byWord.set(blade.word, []);
      const panel = new THREE.PlaneGeometry(0.92, 2.35);
      panel.rotateZ(-Math.PI / 2);
      panel.rotateY(blade.ry + Math.PI / 2);
      panel.translate(blade.x, blade.y, blade.z);
      byWord.get(blade.word).push({ geometry: panel });
      glow.push(blade.x, blade.y, blade.z);
    }
    this.bladeMaterials = [];
    for (const [word, parts] of byWord) {
      const texture = this.assets.sign(word, { background: '#120c14', ink: '#ffe6b8', border: '#ff6a2e', font: 700 });
      const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(mergeGeometries(parts), material);
      mesh.renderOrder = 2;
      this.bladeMaterials.push(material);
      this.addNamed('blade-signs', mesh, false);
    }

    // The light the blade throws on its own wall and on the pavement below it.
    if (glow.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(glow, 3));
      this.bladeGlowMaterial = new THREE.PointsMaterial({
        map: this.assets.glow(),
        color: 0xff8a4a,
        size: 5.4,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.group.add(new THREE.Points(geometry, this.bladeGlowMaterial));
    }
  }

  setNight(night) {
    const color = new THREE.Color();
    this.windowDescriptors.forEach((win, index) => {
      if (night) {
        if (win.lit) color.copy(WINDOW_NIGHT_LIT).multiplyScalar(win.cool ? 0.72 : win.warm);
        else color.copy(WINDOW_NIGHT_DARK).multiplyScalar(win.cool ? 1.5 : 1);
      } else {
        color.copy(WINDOW_DAY).multiplyScalar(win.cool ? 0.72 : 0.9 + win.warm * 0.16);
      }
      this.windows.setColorAt(index, color);
    });
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;

    this.shopDescriptors.forEach((shop, index) => {
      if (night && shop.lit) color.copy(SHOP_NIGHT).multiplyScalar(shop.warm);
      else if (night) color.copy(WINDOW_NIGHT_DARK).multiplyScalar(1.1);
      else color.copy(SHOP_DAY).multiplyScalar(0.9 + shop.warm * 0.1);
      this.shops.setColorAt(index, color);
    });
    if (this.shops.instanceColor) this.shops.instanceColor.needsUpdate = true;

    this.windowMaterial.toneMapped = !night;
    this.windowMaterial.needsUpdate = true;
    this.shopMaterial.toneMapped = !night;
    this.shopMaterial.needsUpdate = true;
    if (this.signGlowMaterial) this.signGlowMaterial.opacity = night ? 0.72 : 0.0;

    for (const material of this.bannerMaterials) {
      material.color.set(night ? 0xffffff : 0xbdb0a2);
    }
    // Blade signs: by day a dead panel of painted steel, after dark the neon in the street.
    if (this.bladeMaterials) {
      for (const material of this.bladeMaterials) {
        material.color.set(night ? 0xffffff : 0x9c9086);
      }
    }
    if (this.bladeGlowMaterial) this.bladeGlowMaterial.opacity = night ? 0.85 : 0.0;
  }
}
