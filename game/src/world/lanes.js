// The drivable network: a node at every junction and one directed lane-link per direction of
// travel, so cars can turn instead of orbiting a fixed loop. Downtown crossings carry traffic
// lights; every link knows its speed limit and which lane centre it belongs to.

import { CITY } from '../core/config.js';
import { clamp } from '../core/math.js';

/** Half a carriageway: the lane centre sits this far right of the road's centre line. */
const LANE = 2.6;

export default class Lanes {
  constructor(plan) {
    this.plan = plan;
    this.nodes = [];
    this.links = [];
    this.chains = [];
    this.byKey = new Map();
    this.buildGrid();
    this.buildCoast();
    this.buildLinks();
    this.buildLights();
    this.buildCrossings();
  }

  nodeAt(x, z) {
    const key = `${Math.round(x)},${Math.round(z)}`;
    let node = this.byKey.get(key);
    if (!node) {
      node = { id: this.nodes.length, x, z, out: [], light: null };
      this.byKey.set(key, node);
      this.nodes.push(node);
    }
    return node;
  }

  buildGrid() {
    const verticals = this.plan.roads.filter((road) => road.axis === 'z' && !road.coast);
    const horizontals = this.plan.roads.filter((road) => road.axis === 'x' && !road.coast);

    for (const road of verticals) {
      const zA = road.z - road.d / 2;
      const zB = road.z + road.d / 2;
      const coords = [zA, zB];
      for (const other of horizontals) if (other.z > zA + 1 && other.z < zB - 1) coords.push(other.z);
      coords.sort((a, b) => a - b);
      this.chains.push({
        axis: 'z',
        fixed: road.x,
        coords,
        limit: 13,
        nodes: coords.map((z) => this.nodeAt(road.x, z)),
      });
    }

    for (const road of horizontals) {
      const xA = road.x - road.w / 2;
      const xB = road.x + road.w / 2;
      const coords = [xA, xB];
      for (const other of verticals) if (other.x > xA + 1 && other.x < xB - 1) coords.push(other.x);
      coords.sort((a, b) => a - b);
      this.chains.push({
        axis: 'x',
        fixed: road.z,
        coords,
        limit: 13,
        nodes: coords.map((x) => this.nodeAt(x, road.z)),
      });
    }
  }

  buildCoast() {
    const coast = this.plan.roads.find((road) => road.coast && road.axis === 'x');
    if (!coast) return;
    const xs = this.chains.filter((chain) => chain.axis === 'z').map((chain) => chain.fixed);
    xs.sort((a, b) => a - b);
    const coords = [coast.x - coast.w / 2, ...xs, coast.x + coast.w / 2];
    this.chains.push({
      axis: 'x',
      fixed: coast.z,
      coords,
      limit: 17,
      coast: true,
      nodes: coords.map((x) => this.nodeAt(x, coast.z)),
    });
    this.coastZ = coast.z;
  }

  buildLinks() {
    for (const chain of this.chains) {
      for (let i = 0; i < chain.nodes.length - 1; i += 1) {
        this.pair(chain.nodes[i], chain.nodes[i + 1], chain.limit);
      }
    }
    // The avenues notch into the coastal boulevard with a short promenade ramp.
    if (!this.coastZ) return;
    for (const chain of this.chains) {
      if (chain.axis !== 'z') continue;
      const end = chain.nodes[chain.nodes.length - 1];
      const junction = this.byKey.get(`${Math.round(chain.fixed)},${Math.round(this.coastZ)}`);
      if (junction && junction !== end) this.pair(end, junction, 9);
    }
  }

  pair(a, b, limit) {
    const existing = a.out.find((link) => link.b === b.id);
    if (existing) return existing;
    const dx0 = b.x - a.x;
    const dz0 = b.z - a.z;
    const len = Math.hypot(dx0, dz0);
    if (len < 1) return null;
    const dx = dx0 / len;
    const dz = dz0 / len;
    const rx = -dz;
    const rz = dx;

    const make = (from, to, sign) => {
      const link = {
        id: this.links.length,
        a: from.id,
        b: to.id,
        dx: dx * sign,
        dz: dz * sign,
        len,
        limit,
        axis: Math.abs(dx) > 0.5 ? 'x' : 'z',
        from: { x: from.x + rx * LANE * sign, z: from.z + rz * LANE * sign },
        to: { x: to.x + rx * LANE * sign, z: to.z + rz * LANE * sign },
        reverse: null,
      };
      this.links.push(link);
      // A link leaves the node it starts at; `pickNext` walks `nodes[link.b].out` to find the
      // continuations of a lane, so the departure node is the one that must own the link.
      from.out.push(link);
      return link;
    };

    const forward = make(a, b, 1);
    const back = make(b, a, -1);
    forward.reverse = back;
    back.reverse = forward;
    return forward;
  }

  buildLights() {
    for (const node of this.nodes) {
      const downtown = node.x >= -112 && node.x <= 112 && node.z >= -172 && node.z <= -22;
      const coast = this.coastZ !== undefined && Math.abs(node.z - this.coastZ) < 1 && node.x >= -160 && node.x <= 160;
      if (!downtown && !coast) continue;
      node.light = {
        period: 24,
        split: 10.5,
        allRed: 1.6,
        offset: ((Math.abs(Math.round(node.x)) * 0.37 + Math.abs(Math.round(node.z)) * 0.61) % 24),
      };
    }
  }

  /** Crosswalk strips: a pedestrian route from one kerb to the other across a street. */
  buildCrossings() {
    const spots = [
      { x: -31, z: 93, axis: 'z' },
      { x: 31, z: 93, axis: 'z' },
      { x: -31, z: -31, axis: 'z' },
      { x: 31, z: -31, axis: 'z' },
      { x: -31, z: 93, axis: 'x' },
      { x: 31, z: 93, axis: 'x' },
      { x: -31, z: 155, axis: 'x' },
      { x: 93, z: -31, axis: 'x' },
      { x: -93, z: 31, axis: 'x' },
      { x: 93, z: 93, axis: 'x' },
    ];
    const half = CITY.road / 2 + CITY.sidewalk * 0.5;
    this.crossings = spots.map((spot, index) => {
      const from = spot.axis === 'z'
        ? { x: spot.x - half, z: spot.z + 6 }
        : { x: spot.x + 6, z: spot.z - half };
      const to = spot.axis === 'z'
        ? { x: spot.x + half, z: spot.z + 6 }
        : { x: spot.x + 6, z: spot.z + half };
      return { id: index, axis: spot.axis, from, to };
    });
  }

  lightFor(node, axis, time) {
    if (!node.light) return 'green';
    const phase = (time + node.light.offset) % node.light.period;
    if (axis === 'z') return phase < node.light.split ? 'green' : 'red';
    return phase > node.light.split + node.light.allRed ? 'green' : 'red';
  }

  pointAt(link, s) {
    const t = link.len <= 1e-4 ? 0 : clamp(s / link.len, 0, 1);
    return {
      x: link.from.x + (link.to.x - link.from.x) * t,
      z: link.from.z + (link.to.z - link.from.z) * t,
      dx: link.dx,
      dz: link.dz,
    };
  }

  heading(link) {
    return Math.atan2(-link.dx, -link.dz);
  }

  /** Pick the next link at a junction: straight ahead is strongly preferred. */
  pickNext(link, rng) {
    const node = this.nodes[link.b];
    const options = node.out.filter((candidate) => candidate !== link.reverse);
    if (!options.length) return link.reverse ?? link;
    if (options.length === 1) return options[0];
    const weights = options.map((candidate) => {
      const dot = candidate.dx * link.dx + candidate.dz * link.dz;
      if (dot > 0.9) return 7;
      if (dot < -0.9) return 0.05;
      return 1.6;
    });
    let total = 0;
    for (const weight of weights) total += weight;
    let ticket = rng.next() * total;
    for (let i = 0; i < options.length; i += 1) {
      ticket -= weights[i];
      if (ticket <= 0) return options[i];
    }
    return options[options.length - 1];
  }

  /** Nearest lane centre to a world point, clamped onto the link. */
  nearest(x, z, maxDistance = Infinity) {
    let best = null;
    for (const link of this.links) {
      const s = clamp((x - link.from.x) * link.dx + (z - link.from.z) * link.dz, 0, link.len);
      const px = link.from.x + link.dx * s;
      const pz = link.from.z + link.dz * s;
      const distance = Math.hypot(x - px, z - pz);
      if (distance < maxDistance && (!best || distance < best.distance)) {
        best = { link, s, distance, x: px, z: pz, heading: this.heading(link) };
      }
    }
    return best;
  }

  /** Every link whose lane passes within `radius` of a point. */
  linksNear(x, z, radius) {
    const found = [];
    for (const link of this.links) {
      const s = clamp((x - link.from.x) * link.dx + (z - link.from.z) * link.dz, 0, link.len);
      const px = link.from.x + link.dx * s;
      const pz = link.from.z + link.dz * s;
      if (Math.hypot(x - px, z - pz) <= radius) found.push({ link, s });
    }
    return found;
  }

  /** A point `distance` further along the road after link, used for race checkpoints. */
  advance(link, s, distance, rng = null) {
    let current = link;
    let travel = s + distance;
    while (travel > current.len) {
      travel -= current.len;
      current = rng ? this.pickNext(current, rng) : this.pickNext(current, { next: () => 0.5 });
    }
    const point = this.pointAt(current, travel);
    return { link: current, s: travel, x: point.x, z: point.z, heading: this.heading(current) };
  }
}
