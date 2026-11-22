// The heads-up display: mission card, money and clock, circular minimap, health and armour,
// weapon slot, and the contextual enter/exit prompt.

import { HUD } from '../core/config.js';
import { formatMoney, formatClock } from '../core/math.js';
import Minimap from './minimap.js';

export default class Hud {
  constructor(plan) {
    this.plan = plan;
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="mission-card">
        <div class="mission-eyebrow">${HUD.mission.eyebrow}</div>
        <div class="mission-title">${HUD.mission.title}</div>
        <div class="mission-detail">${HUD.mission.detail}</div>
        <div class="mission-meta"><span class="distance">-- M</span><span>PRIMARY</span></div>
      </div>
      <div class="top-right">
        <div class="money">${formatMoney(HUD.money)}</div>
        <div class="clock">17:21</div>
        <div class="minimap-wrap">
          <canvas width="512" height="512"></canvas>
          <div class="minimap-north">N</div>
          <div class="minimap-ring"></div>
        </div>
      </div>
      <div class="bottom-left">
        <div class="status-bars">
          <div class="status-row"><span class="status-label">HEALTH</span><div class="bar health"><span style="width:${HUD.health}%"></span></div></div>
          <div class="status-row"><span class="status-label">ARMOUR</span><div class="bar armour"><span style="width:${HUD.armour}%"></span></div></div>
        </div>
        <div class="weapon-slot">
          <div class="weapon-mark">${HUD.weapon}</div>
          <div class="weapon-ammo">${HUD.ammo}<small> / ${HUD.reserve}</small></div>
        </div>
      </div>
      <div class="prompt"></div>
    `;
    document.body.appendChild(this.root);

    const vignette = document.createElement('div');
    vignette.id = 'vignette';
    document.body.appendChild(vignette);

    this.distance = this.root.querySelector('.distance');
    this.clock = this.root.querySelector('.clock');
    this.prompt = this.root.querySelector('.prompt');
    this.minimap = new Minimap(plan, this.root.querySelector('.minimap-wrap canvas'));
    this.lastDistance = '';
    this.lastClock = '';
    this.visible = false;
  }

  show(visible) {
    this.visible = visible;
    this.root.classList.toggle('visible', visible);
  }

  setPrompt(text) {
    if (!text) {
      this.prompt.classList.remove('visible');
      this.prompt.innerHTML = '';
      return;
    }
    if (this.prompt.dataset.text !== text) {
      this.prompt.dataset.text = text;
      this.prompt.innerHTML = text;
    }
    this.prompt.classList.add('visible');
  }

  update(dt, state) {
    const clock = formatClock(state.hour);
    if (clock !== this.lastClock) {
      this.clock.textContent = clock;
      this.lastClock = clock;
    }
    const dx = state.position.x - HUD.objective.x;
    const dz = state.position.z - HUD.objective.z;
    const meters = `${Math.max(0, Math.round(Math.hypot(dx, dz)))} M`;
    if (meters !== this.lastDistance) {
      this.distance.textContent = meters;
      this.lastDistance = meters;
    }
    this.minimap.update(dt, state.position, state.heading, state.cameraYaw, HUD.objective);
  }
}
