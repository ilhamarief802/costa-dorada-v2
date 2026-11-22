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
    this.buildWindows();
    this.buildShopfronts();
    this.buildAwnings();
    this.buildSigns();
    this.setNight(false);
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
    this.group.add(masses);
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
    this.group.add(makeInstances(geometry, material, placements, { castShadow: true, receiveShadow: true }));
    if (details.length) {
      this.group.add(makeInstances(detailGeometry, detailMaterial, details, { castShadow: true, receiveShadow: true }));
    }
    if (tanks.length) {
      this.group.add(makeInstances(tankGeometry, tankMaterial, tanks, { castShadow: true, receiveShadow: true }));
    }
  }

  buildLedges() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    const placements = [];
    for (const lot of this.plan.lots) {
      if (lot.height <= 0 || lot.style === 'plaza' || lot.style === 'tower') continue;
      const floors = Math.max(2, Math.floor(lot.height / 3.6));
      const y0 = CITY.padHeight;
      for (let f = 1; f <= floors; f += 1) {
        const y = y0 + f * 3.6;
        const tint = new THREE.Color(lot.color).multiplyScalar(1.18).getHex();
        placements.push({ x: lot.x, y, z: lot.z + lot.d / 2 + 0.06, scale: [lot.w + 0.25, 0.17, 0.2], color: tint });
        placements.push({ x: lot.x, y, z: lot.z - lot.d / 2 - 0.06, scale: [lot.w + 0.25, 0.17, 0.2], color: tint });
        placements.push({ x: lot.x + lot.w / 2 + 0.06, y, z: lot.z, scale: [0.2, 0.17, lot.d + 0.25], color: tint });
        placements.push({ x: lot.x - lot.w / 2 - 0.06, y, z: lot.z, scale: [0.2, 0.17, lot.d + 0.25], color: tint });
      }
    }
    this.group.add(makeInstances(geometry, material, placements, { castShadow: false, receiveShadow: true }));
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

      const addFace = (count, width, x, z, ry, span) => {
        if (count < 1) return;
        const step = span / count;
        for (let f = 0; f < floors; f += 1) {
          const y = y0 + f * spacingY;
          if (y + windowH / 2 > CITY.padHeight + lot.height - 0.6) continue;
          for (let c = 0; c < count; c += 1) {
            if (rng.next() > density) continue;
            const offset = -span / 2 + step * (c + 0.5);
            const windowW = tower ? step * 0.82 : Math.min(1.35, step * 0.58);
            this.windowDescriptors.push({
              x: x + (ry === Math.PI / 2 ? 0 : offset),
              z: z + (ry === Math.PI / 2 ? offset : 0),
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

      addFace(lot.cols, lot.w, lot.x, lot.z + lot.d / 2 + 0.06, 0, lot.w * 0.86);
      addFace(lot.cols, lot.w, lot.x, lot.z - lot.d / 2 - 0.06, Math.PI, lot.w * 0.86);
      addFace(lot.depthCols, lot.d, lot.x + lot.w / 2 + 0.06, lot.z, Math.PI / 2, lot.d * 0.86);
      addFace(lot.depthCols, lot.d, lot.x - lot.w / 2 - 0.06, lot.z, -Math.PI / 2, lot.d * 0.86);
    }

    const geometry = new THREE.PlaneGeometry(1, 1);
    this.windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, side: THREE.FrontSide });
    this.windows = new THREE.InstancedMesh(geometry, this.windowMaterial, Math.max(1, this.windowDescriptors.length));
    this.windows.count = this.windowDescriptors.length;
    this.windows.castShadow = false;
    this.windows.receiveShadow = false;
    this.windows.frustumCulled = false;
    const dummy = new THREE.Object3D();
    this.windowDescriptors.forEach((win, index) => {
      dummy.position.set(win.x, win.y, win.z);
      dummy.rotation.set(0, win.ry, 0);
      dummy.scale.set(win.w, win.h, 1);
      dummy.updateMatrix();
      this.windows.setMatrixAt(index, dummy.matrix);
    });
    this.windows.instanceMatrix.needsUpdate = true;
    this.group.add(this.windows);
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
    this.group.add(this.shops);
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
      this.group.add(makeInstances(geometry, material, placements, { castShadow: true, receiveShadow: true }));
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
      this.group.add(mesh);
    }

    if (backings.length) {
      const backingGeometry = new THREE.BoxGeometry(6.7, 1.9, 0.16);
      const backingMaterial = new THREE.MeshStandardMaterial({ color: 0x201a1c, roughness: 0.8 });
      this.group.add(makeInstances(backingGeometry, backingMaterial, backings, { castShadow: true, receiveShadow: true }));
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
  }
}
