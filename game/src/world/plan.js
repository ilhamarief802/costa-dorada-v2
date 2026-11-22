// The city blueprint. Everything spatial is decided once from the seed here: blocks, the road
// grid, building lots, alleys, curbs, palms, lamps, parked cars, water and the mission target.

import { CITY, SURFACE, ART } from '../core/config.js';
import { makeRng } from '../core/rng.js';

const DECO = [0xe8d8b8, 0xdca07a, 0x9fc4b3, 0xb8cfe0, 0xe2b96f, 0xd98a86, 0xcbb9d6, 0xefe4cf];
const TOWER = [0x7e9aa6, 0x6b8b96, 0x90a8ae, 0x7d8f9c, 0x8fa3a0];
const HOTEL = [0xf0dcc0, 0xe9b7a0, 0xbcd2cf, 0xf2c98d, 0xd9c4d8];
const WARE = [0xb2a48b, 0x8f9c94, 0xc2a98a, 0x9aa0a4];

const SIGNS = ['HOTEL SOL', 'CINE LUNA', 'BAR NEGRO', 'CAFE MAR', 'MERCADO', 'MOTEL OLA', 'SALSA', 'LICORES'];

function rect(x, z, w, d) {
  return { x, z, w, d };
}

function inside(rect, x, z, margin = 0) {
  return Math.abs(x - rect.x) <= rect.w / 2 + margin && Math.abs(z - rect.z) <= rect.d / 2 + margin;
}

function split(box, axis, ratio) {
  if (axis === 'x') {
    const a = box.w * ratio;
    const b = box.w - a;
    return [rect(box.x - box.w / 2 + a / 2, box.z, a, box.d), rect(box.x + box.w / 2 - b / 2, box.z, b, box.d)];
  }
  const a = box.d * ratio;
  const b = box.d - a;
  return [rect(box.x, box.z - box.d / 2 + a / 2, box.w, a), rect(box.x, box.z + box.d / 2 - b / 2, box.w, b)];
}

export default class CityPlan {
  constructor(seed) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.columns = CITY.columns;
    this.rows = CITY.rows;
    this.pitch = CITY.pitch;
    this.half = CITY.block / 2;
    this.blocks = [];
    this.lots = [];
    this.colliders = [];
    this.palms = [];
    this.lamps = [];
    this.parked = [];
    this.benches = [];
    this.signs = [];
    this.waterRects = [];
    this.roads = [];
    this.lanes = [];
    this.trafficLoops = [];
    this.pedLoops = [];
    this.piers = [];
    this.boats = [];
    this.propBoxes = [];
    this.bounds = { minX: -232, maxX: 232, minZ: -232, maxZ: 278 };

    this.buildGrid();
    this.buildRoads();
    this.buildWater();
    this.buildBlocks();
    this.buildLots();
    this.buildStreetLife();
    this.buildRoutes();
    this.buildColliders();
    this.buildLandmarks();
    this.pickSpawns();
  }

  // ---------------------------------------------------------------- grid

  buildGrid() {
    for (let j = 0; j < this.rows; j += 1) {
      for (let i = 0; i < this.columns; i += 1) {
        const x = (i - 3) * this.pitch;
        const z = (j - 3) * this.pitch;
        const downtown = i >= 2 && i <= 4 && j >= 0 && j <= 2;
        const coast = j === 6;
        const marina = i >= 5 && j >= 4;
        let kind = 'deco';
        if (downtown) kind = 'tower';
        else if (coast) kind = 'hotel';
        else if (marina) kind = 'warehouse';
        if (i === 0 && j === 6) kind = 'park';
        if (i === 2 && j === 1) kind = 'plaza';
        if (i === 6 && j === 5) kind = 'park';

        this.blocks.push({
          i,
          j,
          x,
          z,
          half: this.half,
          kind,
          downtown,
          coast,
          marina,
          sidewalk: CITY.sidewalk,
          index: j * this.columns + i,
          name: `${String.fromCharCode(65 + i)}${j + 1}`,
        });
      }
    }
  }

  buildRoads() {
    const reach = 3 * this.pitch + this.half;
    for (let k = 0; k < this.columns - 1; k += 1) {
      const x = (k - 2) * this.pitch - this.pitch / 2;
      this.roads.push({ x, z: 0, w: CITY.road, d: reach * 2, axis: 'z' });
    }
    for (let k = 0; k < this.rows - 1; k += 1) {
      const z = (k - 2) * this.pitch - this.pitch / 2;
      this.roads.push({ x: 0, z, w: reach * 2, d: CITY.road, axis: 'x' });
    }
    // The coastal boulevard runs the length of the shore in front of the last row.
    this.roads.push({ x: 0, z: 217, w: 460, d: CITY.road, axis: 'x', coast: true });
    // A short marina approach off the coastal boulevard.
    this.roads.push({ x: 236, z: 174, w: CITY.road, d: 94, axis: 'z', coast: true });

    for (const road of this.roads) {
      if (road.axis === 'z') {
        this.lanes.push({ x: road.x - 2.6, z0: road.z - road.d / 2, z1: road.z + road.d / 2, dir: 1, axis: 'z' });
        this.lanes.push({ x: road.x + 2.6, z0: road.z - road.d / 2, z1: road.z + road.d / 2, dir: -1, axis: 'z' });
      } else {
        this.lanes.push({ x0: road.x - road.w / 2, x1: road.x + road.w / 2, z: road.z - 2.6, dir: -1, axis: 'x' });
        this.lanes.push({ x0: road.x - road.w / 2, x1: road.x + road.w / 2, z: road.z + 2.6, dir: 1, axis: 'x' });
      }
    }
  }

  buildWater() {
    this.waterRects.push({ x: 0, z: 700, w: 2200, d: 1000, deep: true });
    this.waterRects.push({
      x: (CITY.marina.x0 + CITY.marina.x1) / 2,
      z: (CITY.marina.z0 + CITY.marina.z1) / 2,
      w: CITY.marina.x1 - CITY.marina.x0,
      d: CITY.marina.z1 - CITY.marina.z0,
      marina: true,
    });
    for (let k = 0; k < 3; k += 1) {
      this.piers.push({ x: 240 + 27, z: 138 + k * 46, w: 54, d: 5.5 });
    }
    this.boats.push(
      { x: 300, z: 146, angle: 0.4, size: 1.15, sail: true },
      { x: 326, z: 206, angle: -0.8, size: 1.4, sail: false },
      { x: 286, z: 246, angle: 0.2, size: 0.95, sail: true },
      { x: 352, z: 168, angle: 1.3, size: 1.6, sail: false },
    );
  }

  // ---------------------------------------------------------------- blocks and buildings

  buildBlocks() {
    for (const block of this.blocks) {
      block.pad = { x: block.x, z: block.z, w: CITY.block, d: CITY.block, h: CITY.padHeight };
      const local = this.rng.fork(`block-${block.index}`);
      block.park = block.kind === 'park';
      block.plaza = block.kind === 'plaza';
      if (block.park) {
        block.grass = rect(block.x, block.z, CITY.block - CITY.sidewalk * 2 - 1.5, CITY.block - CITY.sidewalk * 2 - 1.5);
      }
      block.tint = local.pick([0xb7ab99, 0xc2b6a2, 0xa99d8c, 0xbdb19d]);
    }
  }

  buildLots() {
    for (const block of this.blocks) {
      if (block.park) continue;
      const local = this.rng.fork(`lots-${block.index}`);
      const inset = block.plaza ? 10 : 3.5;
      const area = rect(block.x, block.z, CITY.block - CITY.sidewalk * 2 - inset * 2, CITY.block - CITY.sidewalk * 2 - inset * 2);
      const pieces = [];

      if (block.kind === 'tower') {
        const cut = local.chance(0.55);
        if (cut) {
          const halves = split(area, 'x', local.range(0.4, 0.6));
          for (const half of halves) pieces.push({ ...half, shrink: local.range(1.2, 3.4) });
        } else {
          pieces.push({ ...area, shrink: local.range(2.0, 4.5) });
        }
      } else if (block.kind === 'plaza') {
        pieces.push({ ...area, shrink: 0, plaza: true });
      } else if (block.kind === 'hotel') {
        const parts = split(area, 'x', 0.5);
        for (const part of parts) pieces.push({ ...part, shrink: local.range(0.8, 2.2) });
      } else if (block.kind === 'warehouse') {
        pieces.push({ ...area, shrink: local.range(1.0, 2.0) });
      } else {
        const rows = local.chance(0.5) ? 2 : 1;
        let slices = [area];
        for (let r = 0; r < rows; r += 1) {
          const next = [];
          for (const slice of slices) next.push(...split(slice, r === 0 ? 'x' : 'z', local.range(0.42, 0.58)));
          slices = next;
        }
        for (const slice of slices) pieces.push({ ...slice, shrink: local.range(0.7, 1.6) });
      }

      const blockLots = [];
      pieces.forEach((piece, index) => {
        const w = piece.w - piece.shrink * 2;
        const d = piece.d - piece.shrink * 2;
        if (w < 7 || d < 7) return;
        const lotRng = local.fork(`lot-${index}`);
        const style = block.kind === 'plaza' ? 'plaza' : block.kind;
        let height;
        if (style === 'tower') height = lotRng.range(30, 74);
        else if (style === 'hotel') height = lotRng.range(12, 27);
        else if (style === 'warehouse') height = lotRng.range(5.5, 9.5);
        else if (style === 'plaza') height = 0;
        else height = lotRng.range(8, 21);
        if (style === 'deco' && lotRng.chance(0.18)) height += 5;
        const palette = style === 'tower' ? TOWER : style === 'hotel' ? HOTEL : style === 'warehouse' ? WARE : DECO;
        const color = lotRng.pick(palette);
        const lot = {
          block,
          x: piece.x,
          z: piece.z,
          w,
          d,
          height,
          style,
          color,
          seed: lotRng.seed,
          floors: Math.max(1, Math.round(height / 3.7)),
          cols: Math.max(2, Math.round(w / 3.4)),
          depthCols: Math.max(1, Math.round(d / 3.8)),
          windowsLit: lotRng.range(0.34, 0.68),
          roof: lotRng.chance(style === 'deco' ? 0.35 : 0.15) ? 'tank' : lotRng.chance(0.5) ? 'ac' : 'plain',
          awning: (style === 'deco' || style === 'hotel') && lotRng.chance(0.45),
          awningColor: lotRng.pick([0x9c3a34, 0x2f6159, 0xb98b3e, 0x3c4a6c]),
          tiers: style === 'tower' ? lotRng.int(1, 3) : 1,
        };
        if (style === 'deco' || style === 'hotel' || style === 'warehouse') {
          if (lotRng.chance(0.42)) {
            lot.signText = lotRng.pick(SIGNS);
            lot.signFace = lotRng.pick(['south', 'east', 'west']);
            this.signs.push({ x: lot.x, z: lot.z, w, d, height, text: lot.signText, face: lot.signFace, night: true });
          }
        }
        blockLots.push(lot);
        this.lots.push(lot);
      });
      block.lots = blockLots;
    }
  }

  // ---------------------------------------------------------------- repeated street furniture

  buildStreetLife() {
    const rng = this.rng.fork('streetlife');
    const half = this.half;
    for (const block of this.blocks) {
      if (block.park || block.plaza) {
        const count = block.plaza ? 3 : 5;
        for (let n = 0; n < count; n += 1) {
          const side = n % 2 === 0 ? -1 : 1;
          const x = block.x + side * (half - 3.2);
          const z = block.z + (n / count - 0.5) * 30 + rng.range(-2, 2);
          this.palms.push({ x, z, s: rng.range(0.9, 1.25), rot: rng.range(0, Math.PI * 2) });
        }
        if (block.park) {
          for (let n = 0; n < 3; n += 1) {
            const t = (n + 0.5) / 3;
            this.benches.push({ x: block.x + (t - 0.5) * 18, z: block.z + 10, rot: 0 });
            this.benches.push({ x: block.x + (t - 0.5) * 18, z: block.z - 10, rot: Math.PI });
          }
        }
      }
    }

    // Palms and lamps line every north-south street; z-running traffic gets a rhythm of palms.
    for (let k = 0; k < this.columns - 1; k += 1) {
      const roadX = (k - 2) * this.pitch - this.pitch / 2;
      for (const side of [-1, 1]) {
        const x = roadX + side * (CITY.road / 2 + 1.5);
        for (let n = 0; n < 8; n += 1) {
          const z = -182 + n * 52 + rng.range(-6, 6);
          if (rng.chance(0.66) && this.onSidewalk(x, z)) this.palms.push({ x, z, s: rng.range(0.85, 1.3), rot: rng.range(0, 6.283) });
        }
        for (let n = 0; n < 7; n += 1) {
          const z = -190 + n * 62 + (side > 0 ? 20 : 0);
          if (this.onSidewalk(x + side * 0.3, z)) {
            this.lamps.push({ x: x + side * 0.3, z, angle: side > 0 ? -Math.PI / 2 : Math.PI / 2, coast: false });
          }
        }
        for (let n = 0; n < 5; n += 1) {
          const z = -160 + n * 68 + rng.range(-8, 8);
          if (Math.abs(z - 148) < 18 && roadX === 31) continue;
          if (this.nearIntersection(roadX, z, 4)) continue;
          if (rng.chance(0.72)) {
            this.parked.push({
              x: roadX + side * (CITY.road / 2 - 1.6),
              z,
              rot: side > 0 ? 0 : Math.PI,
              color: rng.pick(ART.vehicles),
            });
          }
        }
      }
    }

    for (let k = 0; k < this.rows - 1; k += 1) {
      const roadZ = (k - 2) * this.pitch - this.pitch / 2;
      for (const side of [-1, 1]) {
        const z = roadZ + side * (CITY.road / 2 + 1.5);
        for (let n = 0; n < 7; n += 1) {
          const x = -182 + n * 52 + rng.range(-6, 6);
          if (rng.chance(0.5) && this.onSidewalk(x, z)) this.palms.push({ x, z, s: rng.range(0.85, 1.25), rot: rng.range(0, 6.283) });
        }
        for (let n = 0; n < 6; n += 1) {
          const x = -186 + n * 64 + (side > 0 ? 18 : 0);
          if (this.onSidewalk(x, z + side * 0.3)) {
            this.lamps.push({ x, z: z + side * 0.3, angle: side > 0 ? Math.PI : 0, coast: false });
          }
        }
      }
    }

    // Beach promenade: a dense palisade of palms and a low balustrade of lamps.
    for (let n = 0; n < 24; n += 1) {
      const x = -220 + n * 19 + rng.range(-4, 4);
      if (x > 244) continue;
      this.palms.push({ x, z: 228 + rng.range(-1.5, 1.5), s: rng.range(1.0, 1.4), rot: rng.range(0, 6.283) });
      this.palms.push({ x: x + 8, z: 242, s: rng.range(0.9, 1.25), rot: rng.range(0, 6.283) });
      this.lamps.push({ x: x + 4, z: 234, angle: 0, coast: true });
      if (n % 3 === 0) this.benches.push({ x: x + 2, z: 238, rot: Math.PI, coast: true });
    }
    for (let n = 0; n < 12; n += 1) {
      const z = 120 + n * 12;
      this.palms.push({ x: 242 + rng.range(-1, 1), z, s: rng.range(0.9, 1.25), rot: rng.range(0, 6.283) });
    }

    this.palms.push({ x: 20, z: 132, s: 1.2, rot: 0.5 });
    this.palms.push({ x: 42, z: 158, s: 1.05, rot: 2.2 });
    this.palms.push({ x: 20, z: 166, s: 1.1, rot: 4.1 });
  }

  buildRoutes() {
    const node = (x, z) => ({ x, z });
    this.trafficLoops.push({
      lane: 3.0,
      points: [node(-155, -155), node(93, -155), node(93, 93), node(-155, 93)],
    });
    this.trafficLoops.push({
      lane: 3.0,
      points: [node(-31, -31), node(31, -31), node(31, 31), node(-31, 31)],
    });
    this.trafficLoops.push({
      lane: 3.2,
      points: [node(-180, 217), node(180, 217), node(180, -217), node(-180, -217)],
      coast: true,
    });
    const loop = (x, z, size) => [node(x - size, z - size), node(x + size, z - size), node(x + size, z + size), node(x - size, z + size)];
    this.pedLoops.push(loop(0, 124, 20.6));
    this.pedLoops.push(loop(62, 0, 20.6));
    this.pedLoops.push(loop(-62, 186, 20.6));
    this.pedLoops.push(loop(124, 62, 20.6));
  }

  buildColliders() {
    for (const lot of this.lots) {
      if (lot.height <= 0) continue;
      const overhang = 0.1;
      this.colliders.push({
        minX: lot.x - lot.w / 2 - overhang,
        maxX: lot.x + lot.w / 2 + overhang,
        minZ: lot.z - lot.d / 2 - overhang,
        maxZ: lot.z + lot.d / 2 + overhang,
        height: lot.height,
        kind: 'building',
      });
    }
    // Curb rings: low blockers for cars, step-ups for people.
    for (const block of this.blocks) {
      const h = block.half;
      const t = 0.32;
      this.colliders.push({ minX: block.x - h, maxX: block.x + h, minZ: block.z - h, maxZ: block.z - h + t, height: CITY.curbHeight, kind: 'curb' });
      this.colliders.push({ minX: block.x - h, maxX: block.x + h, minZ: block.z + h - t, maxZ: block.z + h, height: CITY.curbHeight, kind: 'curb' });
      this.colliders.push({ minX: block.x - h, maxX: block.x - h + t, minZ: block.z - h, maxZ: block.z + h, height: CITY.curbHeight, kind: 'curb' });
      this.colliders.push({ minX: block.x + h - t, maxX: block.x + h, minZ: block.z - h, maxZ: block.z + h, height: CITY.curbHeight, kind: 'curb' });
    }
    // Pier ends and the marina seawall keep the player out of deep water.
    this.colliders.push({ minX: 250, maxX: 252, minZ: 108, maxZ: 300, height: 0.8, kind: 'seawall' });
    this.colliders.push({ minX: -232, maxX: 232, minZ: 276, maxZ: 279, height: 0.6, kind: 'seawall' });
    this.colliders.push({ minX: -234, maxX: -231, minZ: -232, maxZ: 279, height: 2, kind: 'limits' });
    this.colliders.push({ minX: 231, maxX: 234, minZ: -232, maxZ: 108, height: 2, kind: 'limits' });
    this.colliders.push({ minX: -234, maxX: 234, minZ: -235, maxZ: -232, height: 2, kind: 'limits' });
  }

  buildLandmarks() {
    this.landmarks = {
      mirador: { x: -62, z: -124, height: 96 },
      lighthouse: { x: 236, z: 262, height: 26 },
      cinema: { x: 93, z: 62 },
      marinaSign: { x: 248, z: 206 },
    };
    this.highway = { z: -244, y: 9.4, from: -228, to: 228 };
    this.objective = { x: 288, z: 184 };
    this.cover = {
      car: { x: 25.4, z: 143.5, rot: 0 },
      player: { x: 28.2, z: 145.0, rot: 0 },
      camera: { x: 26.6, y: 2.3, z: 150.4, targetX: 28.6, targetY: 2.8, targetZ: 100 },
    };
  }

  pickSpawns() {
    this.spawn = { x: 40.6, z: 150.5, y: CITY.padHeight, rot: Math.PI };
    this.playerStart = { x: 28.2, z: 145.0 };
  }

  // ---------------------------------------------------------------- queries

  blockAt(x, z) {
    for (const block of this.blocks) {
      if (Math.abs(x - block.x) <= block.half && Math.abs(z - block.z) <= block.half) return block;
    }
    return null;
  }

  onSidewalk(x, z) {
    const block = this.blockAt(x, z);
    if (!block) return false;
    const ax = Math.abs(x - block.x);
    const az = Math.abs(z - block.z);
    const outer = block.half;
    const inner = block.half - CITY.sidewalk;
    return (ax >= inner && ax <= outer) || (az >= inner && az <= outer);
  }

  nearIntersection(x, z, margin = 2) {
    for (const road of this.roads) {
      if (road.axis === 'x' && Math.abs(z - road.z) < CITY.road / 2 + margin) return true;
      if (road.axis === 'z' && Math.abs(x - road.x) < CITY.road / 2 + margin) return true;
    }
    return false;
  }

  isWater(x, z) {
    for (const water of this.waterRects) {
      if (Math.abs(x - water.x) <= water.w / 2 && Math.abs(z - water.z) <= water.d / 2) {
        if (water.deep && z < CITY.shoreEnd) continue;
        return true;
      }
    }
    return false;
  }

  groundHeight(x, z) {
    for (const pier of this.piers) {
      if (inside(pier, x, z)) return 0.55;
    }
    if (this.isWater(x, z)) return CITY.waterLevel;
    if (z >= CITY.beachStart && z <= CITY.promenadeEnd && x <= 248 && x >= -228) return 0.3;
    if (z > CITY.promenadeEnd) {
      const t = Math.min(1, (z - CITY.promenadeEnd) / (CITY.shoreEnd - CITY.promenadeEnd));
      return 0.3 - t * 0.62;
    }
    if (z >= 209.5 && z < CITY.beachStart) return 0;
    const block = this.blockAt(x, z);
    if (block) return CITY.padHeight;
    return 0;
  }

  isWalkable(x, z) {
    if (!this.isWater(x, z)) return true;
    for (const pier of this.piers) if (inside(pier, x, z)) return true;
    return false;
  }

  /** Nearest road lane point, used by traffic and by the parked-car spawn. */
  lanePoint(lane, t) {
    if (lane.axis === 'z') {
      return { x: lane.x, z: lane.z0 + (lane.z1 - lane.z0) * t, angle: lane.dir > 0 ? 0 : Math.PI };
    }
    return { x: lane.x0 + (lane.x1 - lane.x0) * t, z: lane.z, angle: lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }

  describe() {
    return {
      seed: this.seed,
      blocks: this.blocks.length,
      lots: this.lots.length,
      palms: this.palms.length,
      lamps: this.lamps.length,
      parked: this.parked.length,
    };
  }
}

export { inside, rect };
