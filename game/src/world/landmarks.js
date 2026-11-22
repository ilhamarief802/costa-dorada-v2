// Landmarks that give the skyline a memory: the Mirador tower, the marina lighthouse, a cinema
// marquee, the marina arch, the elevated highway and the boats. Also the mission marker.

import { CITY } from '../core/config.js';
import { mergeGeometries, makeInstances } from '../core/geom.js';

function sailGeometry(width, height) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0, height, 0, width, height * 0.16, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 2));
  geometry.computeVertexNormals();
  return geometry;
}

export default class Landmarks {
  constructor(plan, assets) {
    this.plan = plan;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    this.nightMaterials = [];
    this.marker = null;
    this.buildMirador();
    this.buildLighthouse();
    this.buildCinema();
    this.buildMarinaSign();
    this.buildHighway();
    this.buildPiersAndBoats();
    this.buildBladeSigns();
    this.buildObjective();
    this.setNight(false);
  }

  buildMirador() {
    const { x, z } = this.plan.landmarks.mirador;
    const baseY = CITY.padHeight;
    const tower = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.82, metalness: 0.02 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2f6d70, roughness: 0.35, metalness: 0.5 });

    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(13, 14, 2.2, 24), stone);
    plinth.position.y = 1.1;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    tower.add(plinth);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 9.2, 66, 20), stone);
    shaft.position.y = 2.2 + 33;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    tower.add(shaft);

    this.glassMaterial = new THREE.MeshBasicMaterial({ color: 0x2a6b78, toneMapped: true });
    for (let i = 0; i < 4; i += 1) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(8.32, 8.32, 1.4, 20), this.glassMaterial);
      band.position.y = 14 + i * 13.5;
      tower.add(band);
    }

    const deck = new THREE.Mesh(new THREE.CylinderGeometry(10.2, 8.6, 2.4, 24), stone);
    deck.position.y = 69.6;
    deck.castShadow = true;
    tower.add(deck);
    const glassHall = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 3.6, 20), this.glassMaterial);
    glassHall.position.y = 72;
    tower.add(glassHall);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 9.1, 1.2, 24), accent);
    crown.position.y = 74.3;
    crown.castShadow = true;
    tower.add(crown);
    for (let i = 0; i < 8; i += 1) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 1.6), stone);
      const angle = (i / 8) * Math.PI * 2;
      fin.position.set(Math.cos(angle) * 8.1, 76.6, Math.sin(angle) * 8.1);
      fin.rotation.y = -angle;
      tower.add(fin);
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.5, 15, 10), accent);
    spire.position.y = 84.5;
    spire.castShadow = true;
    tower.add(spire);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 6), new THREE.MeshStandardMaterial({ color: 0x2a2e30 }));
    mast.position.y = 96;
    tower.add(mast);

    const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffc16a, toneMapped: false });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), beaconMaterial);
    beacon.position.y = 100.5;
    tower.add(beacon);
    this.nightMaterials.push({ material: beaconMaterial, day: 0xffd9a8, night: 0xffb04a });
    this.nightMaterials.push({ material: this.glassMaterial, day: 0x2a6b78, night: 0x56c7cc });

    const signTexture = this.assets.sign('EL MIRADOR', { background: '#101820', ink: '#f5debc', border: '#e0a55c' });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 2.4),
      new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false, transparent: true }),
    );
    sign.position.set(0, 10.5, 9.4);
    sign.rotation.y = Math.PI * 0.04;
    tower.add(sign);

    tower.position.set(x, baseY, z);
    this.group.add(tower);
    this.plan.colliders.push({
      minX: x - 11,
      maxX: x + 11,
      minZ: z - 11,
      maxZ: z + 11,
      height: 70,
      kind: 'building',
    });
  }

  buildLighthouse() {
    const { x, z } = this.plan.landmarks.lighthouse;
    const baseY = this.plan.groundHeight(x, z);
    const lighthouse = new THREE.Group();
    const cream = new THREE.MeshStandardMaterial({ color: 0xf3e6cf, roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb9432f, roughness: 0.75 });
    let y = 0;
    for (let i = 0; i < 5; i += 1) {
      const radiusBottom = 3.1 - i * 0.34;
      const radiusTop = 3.1 - (i + 1) * 0.34;
      const section = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, 4.2, 14), i % 2 ? red : cream);
      section.position.y = y + 2.1;
      section.castShadow = true;
      section.receiveShadow = true;
      lighthouse.add(section);
      y += 4.2;
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.4, 14), red);
    gallery.position.y = y + 0.2;
    lighthouse.add(gallery);
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: 0xffe3a4, toneMapped: false });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.3, 12), this.lanternMaterial);
    lantern.position.y = y + 1.55;
    lighthouse.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.9, 14), red);
    roof.position.y = y + 3.6;
    roof.castShadow = true;
    lighthouse.add(roof);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), cream);
    tip.position.y = y + 4.7;
    lighthouse.add(tip);
    this.nightMaterials.push({ material: this.lanternMaterial, day: 0xe8d9b4, night: 0xfff0bc });

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.assets.glow(),
        color: 0xffd27a,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.scale.setScalar(12);
    glow.position.y = y + 1.6;
    glow.userData.nightScale = 22;
    lighthouse.add(glow);
    this.lighthouseGlow = glow;

    lighthouse.position.set(x, baseY, z);
    this.group.add(lighthouse);
    this.plan.colliders.push({ minX: x - 3.2, maxX: x + 3.2, minZ: z - 3.2, maxZ: z + 3.2, height: 26, kind: 'building' });
  }

  buildCinema() {
    const base = { x: 78, z: 78 };
    const y = CITY.padHeight;
    const tower = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.5 });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10.5, 0.6), steel);
    pole.position.y = 5.25;
    pole.castShadow = true;
    tower.add(pole);
    const panels = ['CINE LUNA', 'ESTRENO', 'MEDIANOCHE'];
    panels.forEach((text, index) => {
      const texture = this.assets.sign(text, { background: '#191020', ink: index === 0 ? '#ffe3a6' : '#ff9f5a', border: '#ff7a3c' });
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 1.4),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }),
      );
      panel.position.set(0, 9.2 - index * 1.9, 0.32);
      tower.add(panel);
      const box = new THREE.Mesh(new THREE.BoxGeometry(5.9, 1.7, 0.16), steel);
      box.position.set(0, 9.2 - index * 1.9, 0.22);
      tower.add(box);
    });
    tower.position.set(base.x, y, base.z);
    tower.rotation.y = -Math.PI / 2;
    this.group.add(tower);
    this.plan.colliders.push({ minX: base.x - 0.6, maxX: base.x + 0.6, minZ: base.z - 0.6, maxZ: base.z + 0.6, height: 11, kind: 'pole' });
  }

  buildMarinaSign() {
    const texture = this.assets.billboard('MARINA DORADA', { background: '#0e1b26', ink: '#f4dfb4' });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x51483c, roughness: 0.8, metalness: 0.2 });
    for (const z of [186, 210]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 8, 8), postMaterial);
      post.position.set(243, 4, z);
      post.castShadow = true;
      this.group.add(post);
    }
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 3.4, 15),
      new THREE.MeshStandardMaterial({ color: 0x242a2e, roughness: 0.8 }),
    );
    board.position.set(243, 7.4, 198);
    board.castShadow = true;
    this.group.add(board);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(14.4, 3.0),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    face.position.set(242.8, 7.4, 198);
    face.rotation.y = -Math.PI / 2;
    this.group.add(face);
  }

  buildHighway() {
    const { z, y, from, to } = this.plan.highway;
    const length = to - from;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9b948a, roughness: 0.9, metalness: 0.02 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(length, 0.75, 14.5), concrete);
    deck.position.set((from + to) / 2, y, z);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.group.add(deck);
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0xc0b8aa, roughness: 0.75 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.85, 0.28), railMaterial);
      rail.position.set((from + to) / 2, y + 0.8, z + side * 7);
      rail.castShadow = true;
      this.group.add(rail);
    }
    const pillarGeometry = new THREE.BoxGeometry(1.9, 9, 1.9);
    pillarGeometry.translate(0, 4.5, 0);
    const pillars = [];
    for (let x = from + 12; x < to; x += 30) {
      pillars.push({ x, y: 0, z, scale: [1, 1, 1] });
    }
    this.group.add(makeInstances(pillarGeometry, concrete, pillars, { castShadow: true, receiveShadow: true }));
    const beamGeometry = new THREE.BoxGeometry(4.6, 0.6, 9.5);
    this.group.add(
      makeInstances(beamGeometry, concrete, pillars.map((p) => ({ x: p.x, y: 8.7, z: p.z })), { castShadow: true, receiveShadow: false }),
    );
    for (const pillar of pillars) {
      this.plan.colliders.push({
        minX: pillar.x - 1.1,
        maxX: pillar.x + 1.1,
        minZ: z - 1.1,
        maxZ: z + 1.1,
        height: 9,
        kind: 'building',
      });
    }
  }

  buildPiersAndBoats() {
    const parts = [];
    for (const pier of this.plan.piers) {
      parts.push({
        geometry: new THREE.BoxGeometry(pier.w, 0.22, pier.d),
        matrix: new THREE.Matrix4().makeTranslation(pier.x, 0.44, pier.z),
        color: 0x9a7c58,
      });
      for (const side of [-1, 1]) {
        parts.push({
          geometry: new THREE.BoxGeometry(pier.w, 0.16, 0.18),
          matrix: new THREE.Matrix4().makeTranslation(pier.x, 1.05, pier.z + side * (pier.d / 2 - 0.12)),
          color: 0x8a6d4c,
        });
      }
    }
    for (const pier of this.plan.piers) {
      for (let i = 0; i < 5; i += 1) {
        parts.push({
          geometry: new THREE.CylinderGeometry(0.2, 0.2, 1.3, 7),
          matrix: new THREE.Matrix4().makeTranslation(pier.x - pier.w / 2 + 3 + i * 11, 0.65, pier.z + pier.d / 2 - 0.3),
          color: 0x4e4238,
        });
      }
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92 });
    const mesh = new THREE.Mesh(mergeGeometries(parts), wood);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    for (const boat of this.plan.boats) {
      const boatGroup = new THREE.Group();
      const hullMaterial = new THREE.MeshStandardMaterial({ color: boat.sail ? 0xe8e0ce : 0x2f4a5a, roughness: 0.45, metalness: 0.2 });
      const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 1.15, 2.5), hullMaterial);
      hull.position.y = 0.1;
      hull.castShadow = true;
      boatGroup.add(hull);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.1, 4), hullMaterial);
      bow.rotation.x = Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      bow.position.set(3.9, 0.1, 0);
      boatGroup.add(bow);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 1.15, 1.8),
        new THREE.MeshStandardMaterial({ color: 0xd9cfb4, roughness: 0.5 }),
      );
      cabin.position.set(-0.6, 1.15, 0);
      boatGroup.add(cabin);
      if (boat.sail) {
        const mast = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.1, 7.5, 6),
          new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.6 }),
        );
        mast.position.set(0.4, 4.1, 0);
        boatGroup.add(mast);
        const sail = new THREE.Mesh(
          sailGeometry(2.9, 5.4),
          new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.9, side: THREE.DoubleSide }),
        );
        sail.position.set(0.45, 1.4, 0);
        boatGroup.add(sail);
      }
      boatGroup.scale.setScalar(boat.size);
      boatGroup.position.set(boat.x, CITY.waterLevel, boat.z);
      boatGroup.rotation.y = boat.angle;
      this.group.add(boatGroup);
    }
  }

  buildBladeSigns() {
    const specs = [
      { x: 23.15, z: 133, ry: Math.PI / 2, text: 'HOTEL SOL' },
      { x: 23.15, z: 96, ry: Math.PI / 2, text: 'BAR NEGRO' },
      { x: 38.85, z: 119, ry: -Math.PI / 2, text: 'CINE LUNA' },
      { x: 38.85, z: 155, ry: -Math.PI / 2, text: 'MERCADO' },
    ];
    const steel = new THREE.MeshStandardMaterial({ color: 0x24282b, roughness: 0.6, metalness: 0.4 });
    for (const spec of specs) {
      const texture = this.assets.sign(spec.text, { background: '#120e16', ink: '#ffe0a8', border: '#ff8a44' });
      const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), material);
      panel.position.set(spec.x, 5.4, spec.z);
      panel.rotation.y = spec.ry;
      this.group.add(panel);
      this.nightMaterials.push({ material, day: 0xcac0b4, night: 0xffffff });
      const backing = new THREE.Mesh(new THREE.BoxGeometry(4.7, 1.35, 0.14), steel);
      backing.position.copy(panel.position);
      backing.rotation.y = spec.ry;
      backing.translateZ(-0.08);
      backing.castShadow = true;
      this.group.add(backing);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.assets.glow(),
          color: 0xff9d55,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      glow.position.set(spec.x + (spec.ry > 0 ? 0.6 : -0.6), 5.4, spec.z);
      glow.scale.setScalar(5.5);
      glow.userData.nightOpacity = 0.55;
      this.group.add(glow);
      this.nightMaterials.push({ material: glow.material, day: null, night: null, glow: true, dayOpacity: 0.04, nightOpacity: 0.5 });
    }
  }

  buildObjective() {
    const { x, z } = this.plan.objective;
    const marker = new THREE.Group();
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc35c, toneMapped: false }),
    );
    diamond.position.y = 2.4;
    marker.add(diamond);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc35c, transparent: true, opacity: 0.5, toneMapped: false }),
    );
    stem.position.y = 1.2;
    marker.add(stem);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.05, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xffc35c, transparent: true, opacity: 0.7, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.62;
    marker.add(ring);
    marker.position.set(x, 0.55, z);
    this.objectiveDiamond = diamond;
    this.objectiveRing = ring;
    this.marker = marker;
    this.group.add(marker);
  }

  setNight(night) {
    for (const entry of this.nightMaterials) {
      if (entry.glow) {
        entry.material.opacity = night ? entry.nightOpacity : entry.dayOpacity;
      } else {
        entry.material.color.set(night ? entry.night : entry.day);
      }
    }
    if (this.lighthouseGlow) this.lighthouseGlow.material.opacity = night ? 0.95 : 0.2;
  }

  update(dt, time) {
    if (!this.marker) return;
    this.objectiveDiamond.position.y = 2.4 + Math.sin(time * 2.1) * 0.16;
    this.objectiveDiamond.rotation.y = time * 1.4;
    this.objectiveRing.rotation.z = time * 0.45;
  }
}
