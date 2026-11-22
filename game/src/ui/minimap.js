// The circular minimap: the city plan painted once to an offscreen canvas, then a cheap
// overlay of player arrow, view wedge and objective diamond each frame.

import { CITY } from '../core/config.js';

const SIZE = 512;
const CENTER_X = 80;
const CENTER_Z = 32;
const SCALE = 0.7;

export default class Minimap {
  constructor(plan, canvas) {
    this.plan = plan;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.timer = 0;
    this.pulse = 0;
    this.base = document.createElement('canvas');
    this.base.width = SIZE;
    this.base.height = SIZE;
    this.paintBase(this.base.getContext('2d'));
  }

  toMap(x, z) {
    return { x: SIZE / 2 + (x - CENTER_X) * SCALE, y: SIZE / 2 + (z - CENTER_Z) * SCALE };
  }

  paintBase(ctx) {
    const map = (x, z) => this.toMap(x, z);
    const rect = (x, z, w, d, color) => {
      const p = map(x - w / 2, z - d / 2);
      ctx.fillStyle = color;
      ctx.fillRect(p.x, p.y, w * SCALE, d * SCALE);
    };

    ctx.fillStyle = '#10303a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    rect(0, 25, 500, 510, '#33352f');
    rect(0, 232, 500, 58, '#a08a61');
    rect(0, 252, 500, 28, '#c3a978');
    rect(0, 235, 500, 22, '#6f6555');

    for (const road of this.plan.roads) {
      rect(road.x, road.z, road.w, road.d, '#55524a');
    }

    for (const block of this.plan.blocks) {
      const p = map(block.x - block.half, block.z - block.half);
      ctx.fillStyle = block.park ? '#2c4430' : block.plaza ? '#5c5445' : '#23262a';
      ctx.fillRect(p.x, p.y, block.half * 2 * SCALE, block.half * 2 * SCALE);
      ctx.strokeStyle = 'rgba(238, 220, 186, 0.24)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, block.half * 2 * SCALE - 1, block.half * 2 * SCALE - 1);
    }

    const marina = CITY.marina;
    rect((marina.x0 + marina.x1) / 2, (marina.z0 + marina.z1) / 2, marina.x1 - marina.x0, marina.z1 - marina.z0, '#123c4a');
    for (const pier of this.plan.piers) {
      rect(pier.x, pier.z, pier.w, pier.d, '#9a7c58');
    }

    const hw = this.plan.highway;
    const h1 = map(hw.from, hw.z);
    const h2 = map(hw.to, hw.z);
    ctx.strokeStyle = '#767064';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(h1.x, h1.y);
    ctx.lineTo(h2.x, h2.y);
    ctx.stroke();

    const dots = [
      [this.plan.landmarks.mirador.x, this.plan.landmarks.mirador.z, '#f0dfbb'],
      [this.plan.landmarks.lighthouse.x, this.plan.landmarks.lighthouse.z, '#e8b06a'],
    ];
    for (const [x, z, color] of dots) {
      const p = map(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  update(dt, playerPos, playerHeading, cameraYaw, objective, actors = null) {
    this.timer -= dt;
    this.pulse += dt;
    if (this.timer > 0) return;
    this.timer = 0.08;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.base, 0, 0);

    const player = this.toMap(playerPos.x, playerPos.z);
    const objectivePoint = this.toMap(objective.x, objective.z);

    // Traffic and pedestrians as faint ticks, police as hot dots: the map reads as a city, not
    // a diagram.
    if (actors) {
      if (actors.cars) {
        ctx.fillStyle = 'rgba(238, 224, 196, 0.34)';
        for (const car of actors.cars) {
          const p = this.toMap(car.x, car.z);
          ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
        }
      }
      if (actors.people) {
        ctx.fillStyle = 'rgba(226, 194, 150, 0.22)';
        for (const person of actors.people) {
          const p = this.toMap(person.x, person.z);
          ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
        }
      }
      if (actors.units) {
        for (const unit of actors.units) {
          if (!unit.alive) continue;
          const p = this.toMap(unit.x, unit.z);
          ctx.fillStyle = Math.sin(this.pulse * 9.2) > 0 ? '#ff5a42' : '#5a86ff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (actors.markers) {
        for (const marker of actors.markers) {
          const p = this.toMap(marker.x, marker.z);
          ctx.strokeStyle = 'rgba(120, 226, 200, 0.85)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.save();
    ctx.translate(objectivePoint.x, objectivePoint.y);
    ctx.rotate(Math.PI / 4);
    const size = 7 + Math.sin(this.pulse * 2.4) * 1.4;
    ctx.fillStyle = '#ffc35c';
    ctx.strokeStyle = 'rgba(20, 14, 8, 0.8)';
    ctx.lineWidth = 1.6;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.restore();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(-cameraYaw);
    ctx.fillStyle = 'rgba(255, 240, 210, 0.1)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 30, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(-playerHeading);
    ctx.fillStyle = '#f7ecd6';
    ctx.strokeStyle = 'rgba(10, 12, 14, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
